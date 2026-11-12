"use server";

import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { evaluateLineAutomationOwnerAccess } from "@/lib/line/automations/rules";
import { LINE_AUTOMATION_SEND_OPEN } from "@/lib/line/automations/production-safe-flags";
import {
  parseLineDeliveryClaimedTask,
  runLineDeliveryMockWorkerTick,
  LINE_DELIVERY_WORKER_MAX_TICKS,
} from "@/lib/line/delivery/delivery-worker";
import {
  mapLineDeliveryRecords,
  type LineDeliveryRecord,
} from "@/lib/line/delivery/delivery-records";
import {
  CLAIM_NEXT_LINE_DELIVERY_TASK_RPC,
  COMPLETE_LINE_DELIVERY_TASK_RPC,
  READ_LINE_DELIVERY_TASKS_RPC,
} from "@/lib/line/delivery/delivery-store";
import { LINE_BROADCAST_SEND_OPEN, LINE_TEST_PUSH_OPEN } from "@/lib/line/line-flag";
import {
  resolveVerifiedLineOrganizationId,
  type LineActor,
} from "@/lib/line/line-command";
import type { LineDecisionReason } from "@/lib/line/line-types";
import { createClient } from "@/lib/supabase/server";

export type LineDeliveryActionResult<T = undefined> =
  | { ok: true; message: string; sentLine: false; data?: T }
  | { ok: false; reason: LineDecisionReason | "invalid_input"; message: string; sentLine: false };

function actorFromResolved(
  resolved: Awaited<ReturnType<typeof getAuthenticatedStaffMembership>>,
  authUserId: string | null,
): LineActor {
  return {
    authUserId,
    role: resolved.status === "ok" ? resolved.membership.role : null,
    isActive: resolved.status === "ok" ? resolved.membership.isActive : false,
    organizationId: resolved.status === "ok" ? resolved.membership.organizationId : null,
    userId: resolved.status === "ok" ? resolved.membership.userId : null,
  };
}

function sendClosedGuard(): LineDeliveryActionResult<never> | null {
  if (
    LINE_AUTOMATION_SEND_OPEN !== false ||
    LINE_BROADCAST_SEND_OPEN !== false ||
    LINE_TEST_PUSH_OPEN !== false
  ) {
    return {
      ok: false,
      reason: "send_closed",
      message: "發送開關異常，已停止 Mock Worker",
      sentLine: false,
    };
  }
  return null;
}

async function loadVerifiedDeliveryOwner(requestedOrganizationId?: string | null) {
  const user = await getServerStaffAuthUser();
  const resolved = await getAuthenticatedStaffMembership({
    organizationId: requestedOrganizationId ?? undefined,
  });
  const actor = actorFromResolved(resolved, user?.id ?? null);
  const verified = resolveVerifiedLineOrganizationId({
    requestedOrganizationId,
    actor,
  });
  if (!verified.ok) return { ...verified, sentLine: false as const };
  const access = evaluateLineAutomationOwnerAccess({
    organizationId: verified.organizationId,
    actor,
  });
  if (!access.ok) return { ...access, sentLine: false as const };
  return { ok: true as const, actor, organizationId: verified.organizationId };
}

export async function loadLineDeliveryRecordsAction(
  organizationId: string,
): Promise<LineDeliveryActionResult<{ records: LineDeliveryRecord[] }>> {
  try {
    const closed = sendClosedGuard();
    if (closed) return closed;
    const verified = await loadVerifiedDeliveryOwner(organizationId);
    if (!verified.ok) return verified;
    const supabase = await createClient();
    const read = await supabase.rpc(READ_LINE_DELIVERY_TASKS_RPC, {
      p_organization_id: verified.organizationId,
    });
    if (read.error) {
      return { ok: false, reason: "error", message: "無法讀取發送任務紀錄", sentLine: false };
    }
    return {
      ok: true,
      message: "已載入發送任務紀錄",
      sentLine: false,
      data: { records: mapLineDeliveryRecords(read.data) },
    };
  } catch {
    return { ok: false, reason: "error", message: "無法讀取發送任務紀錄", sentLine: false };
  }
}

export async function runLineDeliveryMockWorkerAction(
  organizationId: string,
): Promise<
  LineDeliveryActionResult<{
    processed: number;
    noWork: boolean;
    mockAccepted: boolean;
    needsHumanConfirmation: boolean;
    records: Array<{
      id: string;
      status: string;
      mockAccepted: boolean;
      needsHumanConfirmation: boolean;
      sentLine: false;
    }>;
  }>
> {
  try {
    const closed = sendClosedGuard();
    if (closed) return closed;
    const verified = await loadVerifiedDeliveryOwner(organizationId);
    if (!verified.ok) return verified;
    const supabase = await createClient();
    const ticks: Array<{
      id: string;
      status: string;
      mockAccepted: boolean;
      needsHumanConfirmation: boolean;
      sentLine: false;
    }> = [];
    let mockAccepted = false;
    let needsHumanConfirmation = false;

    for (let index = 0; index < LINE_DELIVERY_WORKER_MAX_TICKS; index += 1) {
      const claimed = await supabase.rpc(CLAIM_NEXT_LINE_DELIVERY_TASK_RPC, {
        p_organization_id: verified.organizationId,
      });
      if (claimed.error) {
        return {
          ok: false,
          reason: "error",
          message: "無法領取發送任務，已停止以免重送",
          sentLine: false,
        };
      }
      const task = parseLineDeliveryClaimedTask(claimed.data);
      const tick = await runLineDeliveryMockWorkerTick({ claimed: task });
      if (tick.noWork || !tick.complete || !task) {
        break;
      }
      const completed = await supabase.rpc(COMPLETE_LINE_DELIVERY_TASK_RPC, {
        p_organization_id: verified.organizationId,
        p_delivery_key: task.deliveryKey,
        p_status: tick.complete.status,
        p_last_error: tick.complete.lastError,
        p_error_class: tick.complete.errorClass,
        p_timed_out: tick.complete.timedOut,
        p_http_status: tick.complete.httpStatus,
      });
      if (completed.error) {
        return {
          ok: false,
          reason: "error",
          message: "任務已領取但無法完成，已標記待人工處理且不會自動重送",
          sentLine: false,
        };
      }
      mockAccepted = mockAccepted || tick.complete.mockAccepted;
      needsHumanConfirmation =
        needsHumanConfirmation || tick.complete.needsHumanConfirmation;
      ticks.push({
        id: task.id,
        status: tick.complete.status,
        mockAccepted: tick.complete.mockAccepted,
        needsHumanConfirmation: tick.complete.needsHumanConfirmation,
        sentLine: false,
      });
    }

    return {
      ok: true,
      message: ticks.length === 0
        ? "目前沒有可執行的發送任務"
        : "Mock Worker 已完成此次執行，仍未發送真實 LINE",
      sentLine: false,
      data: {
        processed: ticks.length,
        noWork: ticks.length === 0,
        mockAccepted,
        needsHumanConfirmation,
        records: ticks,
      },
    };
  } catch {
    return {
      ok: false,
      reason: "error",
      message: "Mock Worker 執行失敗，不會自動重送",
      sentLine: false,
    };
  }
}
