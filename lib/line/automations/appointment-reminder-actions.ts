"use server";

import { canShowLineAutomations } from "@/lib/line/automations/access";
import {
  LINE_AUTOMATION_BIND_CREATED_MESSAGE,
  LINE_AUTOMATION_DB_NOT_READY,
  LINE_AUTOMATION_PERSIST_CLOSED_MESSAGE,
  LINE_AUTOMATION_PERSIST_SAVED_MESSAGE,
} from "@/lib/line/automations/copy";
import { interpretStartLineCustomerBindResult } from "@/lib/line/automations/customer-line-bind";
import {
  createDefaultAppointmentReminderRule,
  evaluateAppointmentReminderOwnerAccess,
  evaluateAppointmentReminderRuleSave,
  ruleFromAppointmentReminderDraft,
} from "@/lib/line/automations/appointment-reminder-rules";
import { isAppointmentReminderPersistOpen } from "@/lib/line/automations/appointment-reminder-flag";
import {
  READ_LINE_APPOINTMENT_REMINDER_WORKSPACE_RPC,
  RUN_LINE_APPOINTMENT_REMINDER_DRY_RUN_RPC,
  START_LINE_CUSTOMER_BIND_RPC,
  UNBIND_LINE_CUSTOMER_BINDING_RPC,
} from "@/lib/line/automations/appointment-reminder-rpc";
import { createAppointmentReminderSupabaseRepository } from "@/lib/line/automations/appointment-reminder-supabase";
import type { AppointmentReminderRpcClient } from "@/lib/line/automations/appointment-reminder-write-hook";
import { previewAppointmentReminderTemplate } from "@/lib/line/automations/appointment-reminder-templates";
import type {
  AppointmentReminderAppointment,
  AppointmentReminderDelivery,
  AppointmentReminderDryRunRecord,
  AppointmentReminderRule,
} from "@/lib/line/automations/appointment-reminder-types";
import type { LineAutomationDraft } from "@/lib/line/automations/types";
import type { LineActor } from "@/lib/line/line-command";
import type { LineDecisionReason } from "@/lib/line/line-types";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { createClient } from "@/lib/supabase/server";

export type AppointmentReminderActionResult<T = undefined> =
  | { ok: true; message: string; persisted: boolean; data?: T }
  | { ok: false; reason: LineDecisionReason; message: string; persisted: false };

export type AppointmentReminderWorkspacePublic = {
  rule: AppointmentReminderRule;
  plannedCount: number | null;
  bindCount: number | null;
  consentCount: number | null;
  deliveries: AppointmentReminderDelivery[];
  dryRuns: AppointmentReminderDryRunRecord[];
  persistOpen: boolean;
  sendOpen: false;
  saved: boolean;
};

function actorFromMembership(
  organizationId: string,
  authUserId: string | null,
  membership: Awaited<ReturnType<typeof getAuthenticatedStaffMembership>>,
): LineActor {
  return {
    authUserId,
    role: membership.status === "ok" ? membership.membership.role : null,
    isActive: membership.status === "ok" ? membership.membership.isActive : false,
    organizationId: membership.status === "ok" ? membership.membership.organizationId : null,
    userId: membership.status === "ok" ? membership.membership.userId : null,
  };
}

async function loadReminderActor(organizationId: string): Promise<LineActor> {
  const user = await getServerStaffAuthUser();
  const membership = await getAuthenticatedStaffMembership({ organizationId });
  return actorFromMembership(organizationId, user?.id ?? null, membership);
}

export async function loadAppointmentReminderWorkspaceAction(
  organizationId: string,
): Promise<AppointmentReminderActionResult<AppointmentReminderWorkspacePublic>> {
  const actor = await loadReminderActor(organizationId);
  const access = evaluateAppointmentReminderOwnerAccess({ organizationId, actor });
  if (!access.ok) {
    return { ok: false, reason: access.reason, message: access.message, persisted: false };
  }
  if (!canShowLineAutomations(actor)) {
    return { ok: false, reason: "unauthorized", message: "只有店長可以管理 LINE 自動推播", persisted: false };
  }
  const persistOpen = isAppointmentReminderPersistOpen();
  if (!persistOpen) {
    return {
      ok: true,
      message: LINE_AUTOMATION_DB_NOT_READY,
      persisted: false,
      data: {
        rule: createDefaultAppointmentReminderRule(organizationId),
        plannedCount: null,
        bindCount: null,
        consentCount: null,
        deliveries: [],
        dryRuns: [],
        persistOpen: false,
        sendOpen: false,
        saved: false,
      },
    };
  }
  try {
    const supabase = await createClient();
    const repo = createAppointmentReminderSupabaseRepository(
      supabase as AppointmentReminderRpcClient,
    );
    const workspace = await repo.readWorkspace(organizationId);
    if (!workspace) {
      return {
        ok: true,
        message: LINE_AUTOMATION_DB_NOT_READY,
        persisted: false,
        data: {
          rule: createDefaultAppointmentReminderRule(organizationId),
          plannedCount: null,
          bindCount: null,
          consentCount: null,
          deliveries: [],
          dryRuns: [],
          persistOpen: true,
          sendOpen: false,
          saved: false,
        },
      };
    }
    const deliveries = await supabase
      .from("line_automation_deliveries")
      .select("id,organization_id,job_id,request_id,status,line_request_id,http_status,message,created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(20);
    const dryRuns = await supabase
      .from("line_automation_dry_runs")
      .select("id,organization_id,job_id,request_id,eligible,skip_reason,message,created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(20);
    return {
      ok: true,
      message: workspace.saved ? "已讀取已儲存的預約提醒設定" : LINE_AUTOMATION_DB_NOT_READY,
      persisted: workspace.saved,
      data: {
        rule: workspace.rule,
        plannedCount: workspace.plannedCount,
        bindCount: workspace.bindCount,
        consentCount: workspace.consentCount,
        deliveries: (deliveries.data ?? []).map((row) => ({
          id: row.id,
          organizationId: row.organization_id,
          jobId: row.job_id,
          requestId: row.request_id,
          status: row.status,
          lineRequestId: row.line_request_id,
          httpStatus: row.http_status,
          message: row.message,
          createdAt: row.created_at,
        })),
        dryRuns: (dryRuns.data ?? []).map((row) => ({
          id: row.id,
          organizationId: row.organization_id,
          jobId: row.job_id,
          requestId: row.request_id,
          eligible: row.eligible,
          skipReason: row.skip_reason,
          message: row.message,
          createdAt: row.created_at,
        })),
        persistOpen: true,
        sendOpen: false,
        saved: workspace.saved,
      },
    };
  } catch {
    return {
      ok: true,
      message: LINE_AUTOMATION_DB_NOT_READY,
      persisted: false,
      data: {
        rule: createDefaultAppointmentReminderRule(organizationId),
        plannedCount: null,
        bindCount: null,
        consentCount: null,
        deliveries: [],
        dryRuns: [],
        persistOpen,
        sendOpen: false,
        saved: false,
      },
    };
  }
}

export async function saveAppointmentReminderRuleAction(input: {
  organizationId: string;
  draft: Pick<LineAutomationDraft, "enabled" | "selectedTimingIds" | "template">;
}): Promise<AppointmentReminderActionResult<AppointmentReminderRule>> {
  const actor = await loadReminderActor(input.organizationId);
  const rule = ruleFromAppointmentReminderDraft(input.organizationId, input.draft);
  const gate = evaluateAppointmentReminderRuleSave({
    organizationId: input.organizationId,
    actor,
    rule,
    persistOpen: isAppointmentReminderPersistOpen(),
  });
  if (!gate.ok) {
    return { ok: false, reason: gate.reason, message: gate.message, persisted: false };
  }
  const supabase = await createClient();
  const repo = createAppointmentReminderSupabaseRepository(
    supabase as AppointmentReminderRpcClient,
  );
  const saved = await repo.saveRule(rule, actor.userId ?? "staff-owner");
  if (!saved.persisted) {
    return { ok: false, reason: "error", message: LINE_AUTOMATION_PERSIST_CLOSED_MESSAGE, persisted: false };
  }
  await supabase.rpc(READ_LINE_APPOINTMENT_REMINDER_WORKSPACE_RPC, {
    p_organization_id: input.organizationId,
  });
  return {
    ok: true,
    message: LINE_AUTOMATION_PERSIST_SAVED_MESSAGE,
    persisted: true,
    data: rule,
  };
}

export async function previewAppointmentReminderAction(input: {
  organizationId: string;
  template: string;
  appointment?: AppointmentReminderAppointment | null;
  organizationName?: string | null;
}): Promise<AppointmentReminderActionResult<{ textBody: string }>> {
  const actor = await loadReminderActor(input.organizationId);
  const access = evaluateAppointmentReminderOwnerAccess({
    organizationId: input.organizationId,
    actor,
  });
  if (!access.ok) {
    return { ok: false, reason: access.reason, message: access.message, persisted: false };
  }
  return {
    ok: true,
    message: "僅預覽，不會發送",
    persisted: false,
    data: {
      textBody: previewAppointmentReminderTemplate({
        template: input.template,
        appointment: input.appointment,
        organizationName: input.organizationName,
      }),
    },
  };
}

export async function startCustomerLineBindAction(input: {
  organizationId: string;
  customerId: string;
}): Promise<AppointmentReminderActionResult<{ code: string; expiresAt: string }>> {
  const actor = await loadReminderActor(input.organizationId);
  const access = evaluateAppointmentReminderOwnerAccess({
    organizationId: input.organizationId,
    actor,
  });
  if (!access.ok) {
    return { ok: false, reason: access.reason, message: access.message, persisted: false };
  }
  if (!isAppointmentReminderPersistOpen()) {
    return { ok: false, reason: "send_closed", message: LINE_AUTOMATION_DB_NOT_READY, persisted: false };
  }
  const supabase = await createClient();
  const started = await supabase.rpc(START_LINE_CUSTOMER_BIND_RPC, {
    p_organization_id: input.organizationId,
    p_customer_app_id: input.customerId,
  });
  const interpreted = interpretStartLineCustomerBindResult({
    error: started.error,
    data: started.data,
  });
  if (!interpreted.ok) {
    return { ok: false, reason: "error", message: interpreted.message, persisted: false };
  }
  return {
    ok: true,
    message: LINE_AUTOMATION_BIND_CREATED_MESSAGE,
    persisted: true,
    data: { code: interpreted.code, expiresAt: interpreted.expiresAt },
  };
}

export async function runAppointmentReminderDryRunAction(
  organizationId: string,
): Promise<AppointmentReminderActionResult> {
  const actor = await loadReminderActor(organizationId);
  const access = evaluateAppointmentReminderOwnerAccess({ organizationId, actor });
  if (!access.ok) {
    return { ok: false, reason: access.reason, message: access.message, persisted: false };
  }
  if (!isAppointmentReminderPersistOpen()) {
    return { ok: false, reason: "send_closed", message: LINE_AUTOMATION_DB_NOT_READY, persisted: false };
  }
  const supabase = await createClient();
  const tick = await supabase.rpc(RUN_LINE_APPOINTMENT_REMINDER_DRY_RUN_RPC, {
    p_organization_id: organizationId,
  });
  if (tick.error) {
    return { ok: false, reason: "error", message: "Dry-run 無法寫入檢查紀錄", persisted: false };
  }
  return {
    ok: true,
    message: "Dry-run 已記錄。沒有連接 LINE Push。",
    persisted: true,
  };
}

export async function unbindCustomerLineBindingAction(input: {
  organizationId: string;
  customerId: string;
}): Promise<AppointmentReminderActionResult> {
  const actor = await loadReminderActor(input.organizationId);
  const access = evaluateAppointmentReminderOwnerAccess({
    organizationId: input.organizationId,
    actor,
  });
  if (!access.ok) {
    return { ok: false, reason: access.reason, message: access.message, persisted: false };
  }
  if (!isAppointmentReminderPersistOpen()) {
    return { ok: false, reason: "send_closed", message: LINE_AUTOMATION_DB_NOT_READY, persisted: false };
  }
  const supabase = await createClient();
  const unbound = await supabase.rpc(UNBIND_LINE_CUSTOMER_BINDING_RPC, {
    p_organization_id: input.organizationId,
    p_customer_app_id: input.customerId,
  });
  if (unbound.error) {
    return { ok: false, reason: "error", message: "無法解除客人 LINE 綁定", persisted: false };
  }
  return { ok: true, message: "已解除客人 LINE 綁定，系統不會再發送", persisted: true };
}

export async function loadAppointmentReminderDeliveriesAction(
  organizationId: string,
): Promise<AppointmentReminderActionResult<AppointmentReminderDelivery[]>> {
  const loaded = await loadAppointmentReminderWorkspaceAction(organizationId);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    message: loaded.message,
    persisted: loaded.persisted,
    data: loaded.data?.deliveries ?? [],
  };
}
