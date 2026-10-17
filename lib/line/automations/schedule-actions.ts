"use server";

import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { evaluateLineAutomationOwnerAccess } from "@/lib/line/automations/rules";
import {
  APPLY_LINE_AUTOMATION_SCHEDULE_RPC,
  READ_LINE_AUTOMATION_SCHEDULE_RPC,
} from "@/lib/line/automations/schedule-types";
import {
  LINE_AUTOMATION_SCHEDULE_CUSTOMER_COLUMNS,
  buildScheduleSnapshot,
} from "@/lib/line/automations/schedule-load";
import {
  proposedJobStatus,
  simulateLineAutomationSchedule,
} from "@/lib/line/automations/schedule-apply";
import {
  resolveVerifiedLineOrganizationId,
  type LineActor,
} from "@/lib/line/line-command";
import { LINE_AUTOMATION_SEND_OPEN } from "@/lib/line/automations/production-safe-flags";
import type { LineDecisionReason } from "@/lib/line/line-types";
import { createClient } from "@/lib/supabase/server";

export type LineAutomationScheduleActionResult<T = undefined> =
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

async function loadVerifiedAutomationOrganization(requestedOrganizationId?: string | null) {
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

function sendClosedGuard(): LineAutomationScheduleActionResult<never> | null {
  if (LINE_AUTOMATION_SEND_OPEN !== false) {
    return {
      ok: false,
      reason: "send_closed",
      message: "自動通知發送開關異常，已停止排程",
      sentLine: false,
    };
  }
  return null;
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
}

async function loadScheduleSnapshot(organizationId: string, nowMs?: number) {
  const supabase = await createClient();
  const org = await supabase
    .from("organizations")
    .select("id,app_id")
    .eq("app_id", organizationId)
    .maybeSingle();
  const orgUuid = typeof org.data?.id === "string" ? org.data.id : null;

  const [rules, jobs, customers, appointments, treatments, packages] = await Promise.all([
    supabase
      .from("line_automation_rules")
      .select("organization_id,automation_type,automation_id,enabled,timing_config,timing_ids,message_template,template")
      .eq("organization_id", organizationId),
    supabase.rpc(READ_LINE_AUTOMATION_SCHEDULE_RPC, {
      p_organization_id: organizationId,
    }),
    orgUuid
      ? supabase
          .from("customers")
          .select(LINE_AUTOMATION_SCHEDULE_CUSTOMER_COLUMNS.join(","))
          .eq("organization_id", orgUuid)
      : Promise.resolve({ data: [], error: null }),
    orgUuid
      ? supabase
          .from("appointments")
          .select("id,app_id,organization_id,customer_id,starts_at,status")
          .eq("organization_id", orgUuid)
      : Promise.resolve({ data: [], error: null }),
    orgUuid
      ? supabase
          .from("treatments")
          .select("id,app_id,organization_id,customer_id,completed_at,status")
          .eq("organization_id", orgUuid)
      : Promise.resolve({ data: [], error: null }),
    orgUuid
      ? supabase
          .from("customer_packages")
          .select("id,app_id,organization_id,customer_id,expires_at,status")
          .eq("organization_id", orgUuid)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (rules.error || jobs.error || customers.error || appointments.error || treatments.error || packages.error) {
    return null;
  }

  return buildScheduleSnapshot({
    organizationId,
    rules: asRows(rules.data),
    customers: orgUuid ? asRows(customers.data) : undefined,
    appointments: orgUuid ? asRows(appointments.data) : undefined,
    treatments: orgUuid ? asRows(treatments.data) : undefined,
    packages: orgUuid ? asRows(packages.data) : undefined,
    jobs: asRows((jobs.data as { jobs?: unknown } | null)?.jobs ?? jobs.data),
    nowMs,
  });
}

function mutationPayload(
  organizationId: string,
  mutation: ReturnType<typeof simulateLineAutomationSchedule>["mutation"],
) {
  return {
    organization_id: organizationId,
    insert: mutation.insert.map((job) => ({
      organization_id: job.organizationId,
      automation_type: job.automationType,
      event_kind: job.eventKind,
      event_id: job.eventId,
      customer_id: job.customerId,
      timing_id: job.timingId,
      fingerprint: job.fingerprint,
      scheduled_for: job.fireAt,
      message_snapshot: job.messageSnapshot,
      recipient_ready: job.recipientReady,
      status: proposedJobStatus(job),
    })),
    update: mutation.update.map((job) => ({
      id: job.id,
      organization_id: job.organizationId,
      automation_type: job.automationType,
      event_kind: job.eventKind,
      event_id: job.eventId,
      customer_id: job.customerId,
      timing_id: job.timingId,
      fingerprint: job.fingerprint,
      scheduled_for: job.fireAt,
      message_snapshot: job.messageSnapshot,
      recipient_ready: job.recipientReady,
      status: proposedJobStatus(job),
    })),
    cancel: mutation.cancel.map((job) => ({
      id: job.id,
      organization_id: job.organizationId,
      fingerprint: job.fingerprint,
    })),
  };
}

export async function simulateLineAutomationScheduleAction(input: {
  organizationId: string;
  nowMs?: number;
}): Promise<
  LineAutomationScheduleActionResult<ReturnType<typeof simulateLineAutomationSchedule>>
> {
  try {
    const closed = sendClosedGuard();
    if (closed) return closed;
    const verified = await loadVerifiedAutomationOrganization(input.organizationId);
    if (!verified.ok) return verified;
    const snapshot = await loadScheduleSnapshot(verified.organizationId, input.nowMs);
    if (!snapshot) {
      return { ok: false, reason: "error", message: "無法讀取自動通知排程", sentLine: false };
    }
    const simulated = simulateLineAutomationSchedule(snapshot);
    return {
      ok: true,
      message: "已完成本機排程模擬。尚未發送 LINE。",
      sentLine: false,
      data: simulated,
    };
  } catch {
    return { ok: false, reason: "error", message: "無法模擬自動通知排程", sentLine: false };
  }
}

export async function applyLineAutomationScheduleAction(input: {
  organizationId: string;
  nowMs?: number;
}): Promise<
  LineAutomationScheduleActionResult<ReturnType<typeof simulateLineAutomationSchedule>>
> {
  try {
    const closed = sendClosedGuard();
    if (closed) return closed;
    const verified = await loadVerifiedAutomationOrganization(input.organizationId);
    if (!verified.ok) return verified;
    const snapshot = await loadScheduleSnapshot(verified.organizationId, input.nowMs);
    if (!snapshot) {
      return { ok: false, reason: "error", message: "無法讀取自動通知排程", sentLine: false };
    }
    const simulated = simulateLineAutomationSchedule(snapshot);
    const supabase = await createClient();
    const applied = await supabase.rpc(APPLY_LINE_AUTOMATION_SCHEDULE_RPC, {
      p_organization_id: verified.organizationId,
      p_mutations: mutationPayload(verified.organizationId, simulated.mutation),
    });
    if (applied.error) {
      return { ok: false, reason: "error", message: "自動通知排程寫入失敗", sentLine: false };
    }
    return {
      ok: true,
      message: "已更新待發送排程。尚未發送 LINE。",
      sentLine: false,
      data: simulated,
    };
  } catch {
    return { ok: false, reason: "error", message: "自動通知排程寫入失敗", sentLine: false };
  }
}
