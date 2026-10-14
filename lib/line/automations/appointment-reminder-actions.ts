"use server";

import { canShowLineAutomations } from "@/lib/line/automations/access";
import {
  LINE_AUTOMATION_BIND_CREATED_MESSAGE,
  LINE_AUTOMATION_DB_NOT_READY,
  LINE_AUTOMATION_PERSIST_CLOSED_MESSAGE,
  LINE_AUTOMATION_PERSIST_SAVED_MESSAGE,
} from "@/lib/line/automations/copy";
import {
  CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID,
  CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_NAME,
  CONTROLLED_REMINDER_PUSH_KILL_SWITCH_OPEN,
  buildControlledReminderPushView,
  evaluateControlledAppointmentReminderPush,
  isControlledReminderPushPanelVisible,
  newControlledReminderOneshotId,
  type ControlledReminderPushDecision,
  type ControlledReminderPushView,
} from "@/lib/line/automations/appointment-reminder-controlled-push";
import {
  OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
  OWNER_SELF_REMINDER_KILL_SWITCH_OPEN,
  buildOwnerSelfReminderView,
  evaluateOwnerSelfReminderPush,
  isOwnerSelfReminderPanelVisible,
  newOwnerSelfReminderOneshotId,
  type OwnerSelfBindEvidence,
  type OwnerSelfReminderDecision,
  type OwnerSelfReminderView,
} from "@/lib/line/automations/appointment-reminder-owner-self-push";
import { unknownLineQuota } from "@/lib/line/line-quota";
import { interpretStartLineCustomerBindResult } from "@/lib/line/automations/customer-line-bind";
import {
  DEFAULT_APPOINTMENT_REMINDER_TEMPLATE,
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
import { ORG_BEAUTY_OS_TEST_ID } from "@/lib/tenant/constants";
import type {
  AppointmentReminderAppointment,
  AppointmentReminderDelivery,
  AppointmentReminderDryRunRecord,
  AppointmentReminderJob,
  AppointmentReminderRule,
  CustomerLineBinding,
  NotificationPreference,
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

function previewControlledReminderAppointment(): AppointmentReminderAppointment {
  return {
    id: "apt-2e4-preview",
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    customerId: CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID,
    customerName: CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_NAME,
    serviceId: "svc-2d2-fake-facial",
    serviceName: "【假資料】2D2 測試課程",
    locationName: "Beauty OS TEST 主店",
    startAt: "2026-10-14T11:00:00.000Z",
    endAt: "2026-10-14T12:00:00.000Z",
    status: "BOOKED",
  };
}

function placeholderControlledReminderJob(): AppointmentReminderJob {
  return {
    id: "laj-2e4preview00001",
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    appointmentId: "apt-2e4-preview",
    customerId: CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID,
    serviceId: "svc-2d2-fake-facial",
    timingId: "hours_before_3",
    fingerprint: "preview",
    scheduledFor: "2026-10-14T08:00:00.000Z",
    status: "scheduled",
    requestId: "larq-2e4preview00001",
    createdAt: "2026-10-14T07:00:00.000Z",
    updatedAt: "2026-10-14T07:00:00.000Z",
  };
}

function bindingFromRow(row: Record<string, unknown> | null): CustomerLineBinding | null {
  if (!row) return null;
  const verified = row.verified === true;
  const unboundAt = typeof row.unbound_at === "string" ? row.unbound_at : null;
  return {
    organizationId: String(row.organization_id ?? ""),
    customerId: String(row.customer_app_id ?? ""),
    lineUserId: "",
    lineUserIdHash: verified && !unboundAt ? "verified" : "",
    verified,
    unboundAt,
    blockedAt: typeof row.blocked_at === "string" ? row.blocked_at : null,
  };
}

function preferenceFromRow(row: Record<string, unknown> | null): NotificationPreference | null {
  if (!row) return null;
  return {
    organizationId: String(row.organization_id ?? ""),
    customerId: String(row.customer_app_id ?? ""),
    appointmentReminderOptIn: row.appointment_reminder_opt_in === true,
    unsubscribedAt: typeof row.unsubscribed_at === "string" ? row.unsubscribed_at : null,
  };
}

async function loadDesignatedRecipientSnapshot(organizationId: string): Promise<{
  binding: CustomerLineBinding | null;
  preference: NotificationPreference | null;
  appointment: AppointmentReminderAppointment;
  job: AppointmentReminderJob;
}> {
  const appointment = previewControlledReminderAppointment();
  const job = placeholderControlledReminderJob();
  try {
    const supabase = await createClient();
    const [bindingResult, preferenceResult, jobResult] = await Promise.all([
      supabase
        .from("line_customer_bindings")
        .select("organization_id,customer_app_id,verified,unbound_at,blocked_at")
        .eq("organization_id", organizationId)
        .eq("customer_app_id", CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID)
        .maybeSingle(),
      supabase
        .from("line_notification_preferences")
        .select("organization_id,customer_app_id,appointment_reminder_opt_in,unsubscribed_at")
        .eq("organization_id", organizationId)
        .eq("customer_app_id", CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID)
        .maybeSingle(),
      supabase
        .from("line_automation_jobs")
        .select(
          "id,organization_id,appointment_app_id,customer_app_id,service_app_id,timing_id,fingerprint,scheduled_for,status,request_id,created_at,updated_at",
        )
        .eq("organization_id", organizationId)
        .eq("customer_app_id", CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID)
        .eq("status", "scheduled")
        .order("scheduled_for", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    const liveJob = jobResult.data as Record<string, unknown> | null;
    const liveCustomerId = String(liveJob?.customer_app_id ?? "");
    if (liveJob?.id && liveCustomerId === CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID) {
      job.id = String(liveJob.id);
      job.appointmentId = String(liveJob.appointment_app_id ?? job.appointmentId);
      job.customerId = CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID;
      job.serviceId = String(liveJob.service_app_id ?? job.serviceId);
      job.fingerprint = String(liveJob.fingerprint ?? job.fingerprint);
      job.scheduledFor = String(liveJob.scheduled_for ?? job.scheduledFor);
      job.requestId = String(liveJob.request_id ?? job.requestId);
      job.status = (liveJob.status as AppointmentReminderJob["status"]) ?? "scheduled";
      appointment.id = job.appointmentId;
      appointment.customerId = CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID;
      appointment.serviceId = job.serviceId;
    }
    return {
      binding: bindingFromRow((bindingResult.data as Record<string, unknown> | null) ?? null),
      preference: preferenceFromRow((preferenceResult.data as Record<string, unknown> | null) ?? null),
      appointment,
      job,
    };
  } catch {
    return { binding: null, preference: null, appointment, job };
  }
}

export async function loadControlledReminderPushViewAction(input: {
  organizationId: string;
  template?: string;
}): Promise<AppointmentReminderActionResult<ControlledReminderPushView>> {
  if (!isControlledReminderPushPanelVisible(input.organizationId)) {
    return { ok: false, reason: "unauthorized", message: "受控測試發送只允許 Beauty OS TEST", persisted: false };
  }
  const actor = await loadReminderActor(input.organizationId);
  const access = evaluateAppointmentReminderOwnerAccess({ organizationId: input.organizationId, actor });
  if (!access.ok) {
    return { ok: false, reason: access.reason, message: access.message, persisted: false };
  }
  const snapshot = await loadDesignatedRecipientSnapshot(input.organizationId);
  const previewText = previewAppointmentReminderTemplate({
    template: input.template || DEFAULT_APPOINTMENT_REMINDER_TEMPLATE,
    appointment: snapshot.appointment,
    organizationName: "Beauty OS TEST",
  });
  return {
    ok: true,
    message: "受控測試發送仍關閉。沒有連接 LINE Push。",
    persisted: false,
    data: buildControlledReminderPushView({
      organizationId: input.organizationId,
      binding: snapshot.binding,
      preference: snapshot.preference,
      previewText,
      sentToday: 0,
      oneshotId: newControlledReminderOneshotId(),
    }),
  };
}

export async function startDesignatedCustomerLineBindAction(
  organizationId: string,
): Promise<AppointmentReminderActionResult<{ code: string; expiresAt: string }>> {
  if (!isControlledReminderPushPanelVisible(organizationId)) {
    return { ok: false, reason: "unauthorized", message: "受控測試發送只允許 Beauty OS TEST", persisted: false };
  }
  return startCustomerLineBindAction({
    organizationId,
    customerId: CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID,
  });
}

export async function evaluateControlledReminderPushAction(input: {
  organizationId: string;
  template?: string;
  confirmPhrase: string;
  oneshotId?: string;
}): Promise<
  AppointmentReminderActionResult<{
    view: ControlledReminderPushView;
    decision: ControlledReminderPushDecision;
  }>
> {
  if (!isControlledReminderPushPanelVisible(input.organizationId)) {
    return { ok: false, reason: "unauthorized", message: "受控測試發送只允許 Beauty OS TEST", persisted: false };
  }
  const actor = await loadReminderActor(input.organizationId);
  const access = evaluateAppointmentReminderOwnerAccess({ organizationId: input.organizationId, actor });
  if (!access.ok) {
    return { ok: false, reason: access.reason, message: access.message, persisted: false };
  }
  const snapshot = await loadDesignatedRecipientSnapshot(input.organizationId);
  const oneshotId = input.oneshotId?.startsWith("larcq-")
    ? input.oneshotId
    : newControlledReminderOneshotId();
  const previewText = previewAppointmentReminderTemplate({
    template: input.template || DEFAULT_APPOINTMENT_REMINDER_TEMPLATE,
    appointment: snapshot.appointment,
    organizationName: "Beauty OS TEST",
  });
  const decision = evaluateControlledAppointmentReminderPush({
    organizationId: input.organizationId,
    designatedCustomerId: CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID,
    appointment: snapshot.appointment,
    job: snapshot.job,
    binding: snapshot.binding,
    preference: snapshot.preference,
    confirmPhrase: input.confirmPhrase,
    oneshotId,
    killSwitchOpen: CONTROLLED_REMINDER_PUSH_KILL_SWITCH_OPEN,
    sentToday: 0,
    recipientCount: 1,
    lineQuota: unknownLineQuota("本階段不查詢 LINE 額度"),
    channelInflight: false,
  });
  return {
    ok: true,
    message: decision.message,
    persisted: false,
    data: {
      view: buildControlledReminderPushView({
        organizationId: input.organizationId,
        binding: snapshot.binding,
        preference: snapshot.preference,
        previewText,
        sentToday: 0,
        oneshotId,
        quotaLabel: "本階段不查詢 LINE 額度，不會連接 LINE",
      }),
      decision,
    },
  };
}

async function loadOwnerSelfBindEvidence(
  organizationId: string,
): Promise<OwnerSelfBindEvidence | null> {
  try {
    const supabase = await createClient();
    const [recipient, secret, account] = await Promise.all([
      supabase
        .from("line_owner_recipients")
        .select("organization_id,staff_user_id,line_user_id_hint,bind_method,bound_at")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      supabase
        .from("line_owner_recipient_secrets")
        .select("organization_id,key_id")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      supabase
        .from("line_official_accounts")
        .select("organization_id,test_push_enabled,channel_id")
        .eq("organization_id", organizationId)
        .maybeSingle(),
    ]);
    const row = recipient.data as Record<string, unknown> | null;
    if (!row) return null;
    const secretRow = secret.data as Record<string, unknown> | null;
    const accountRow = account.data as Record<string, unknown> | null;
    return {
      organizationId: String(row.organization_id ?? ""),
      staffUserId: String(row.staff_user_id ?? ""),
      hint: typeof row.line_user_id_hint === "string" ? row.line_user_id_hint : "••••",
      bindMethod: typeof row.bind_method === "string" ? row.bind_method : null,
      keyId: typeof secretRow?.key_id === "string" ? secretRow.key_id : null,
      secretPresent: Boolean(secretRow?.key_id),
      boundAt: typeof row.bound_at === "string" ? row.bound_at : null,
      testPushEnabled: accountRow?.test_push_enabled === true,
    };
  } catch {
    return null;
  }
}

export async function loadOwnerSelfReminderViewAction(input: {
  organizationId: string;
}): Promise<AppointmentReminderActionResult<OwnerSelfReminderView>> {
  if (!isOwnerSelfReminderPanelVisible(input.organizationId)) {
    return { ok: false, reason: "unauthorized", message: "店長本人測試發送只允許 Beauty OS TEST", persisted: false };
  }
  const actor = await loadReminderActor(input.organizationId);
  const access = evaluateAppointmentReminderOwnerAccess({ organizationId: input.organizationId, actor });
  if (!access.ok) {
    return { ok: false, reason: access.reason, message: access.message, persisted: false };
  }
  const evidence = await loadOwnerSelfBindEvidence(input.organizationId);
  return {
    ok: true,
    message: "尚未有獨立的店長本人預約提醒授權。沒有連接 LINE Push。",
    persisted: false,
    data: buildOwnerSelfReminderView({
      organizationId: input.organizationId,
      evidence,
      oneshotId: newOwnerSelfReminderOneshotId(),
    }),
  };
}

export async function evaluateOwnerSelfReminderPushAction(input: {
  organizationId: string;
  confirmPhrase: string;
  oneshotId?: string;
}): Promise<
  AppointmentReminderActionResult<{
    view: OwnerSelfReminderView;
    decision: OwnerSelfReminderDecision;
  }>
> {
  if (!isOwnerSelfReminderPanelVisible(input.organizationId)) {
    return { ok: false, reason: "unauthorized", message: "店長本人測試發送只允許 Beauty OS TEST", persisted: false };
  }
  const actor = await loadReminderActor(input.organizationId);
  const access = evaluateAppointmentReminderOwnerAccess({ organizationId: input.organizationId, actor });
  if (!access.ok) {
    return { ok: false, reason: access.reason, message: access.message, persisted: false };
  }
  const evidence = await loadOwnerSelfBindEvidence(input.organizationId);
  const oneshotId = input.oneshotId?.startsWith("laros-")
    ? input.oneshotId
    : newOwnerSelfReminderOneshotId();
  const decision = evaluateOwnerSelfReminderPush({
    organizationId: input.organizationId,
    actorStaffUserId: actor.userId,
    channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
    evidence,
    independentConsent: false,
    testPushRecipientReused: evidence?.testPushEnabled === true,
    confirmPhrase: input.confirmPhrase,
    oneshotId,
    killSwitchOpen: OWNER_SELF_REMINDER_KILL_SWITCH_OPEN,
    sentToday: 0,
    recipientCount: 1,
    lineQuota: unknownLineQuota("本階段不查詢 LINE 額度"),
    channelInflight: false,
  });
  return {
    ok: true,
    message: decision.message,
    persisted: false,
    data: {
      view: buildOwnerSelfReminderView({
        organizationId: input.organizationId,
        evidence,
        oneshotId,
      }),
      decision,
    },
  };
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
