/**
 * Phase 3B appointment-reminder dry run.
 * Fake store only. Never calls LINE, never reads Production customers.
 */
import { describeLineQuota, lineOfficialQuotaBlockMessage, lineQuotaBlocksSend } from "@/lib/line/line-quota";
import type { LineQuotaPublic } from "@/lib/line/line-types";
import { taipeiLocalToUtcIso } from "@/lib/persistence/appointment-time";
import { ORG_BEAUTY_OS_TEST_ID } from "@/lib/tenant/constants";
import {
  APPOINTMENT_REMINDER_RATE_LIMIT,
  appointmentReminderFlagsClosed,
  invalidateReminderJobs,
  isReminderEligibleStatus,
  planAppointmentReminderJobs,
  type AppointmentReminderAudience,
  type AppointmentReminderJob,
  type AppointmentReminderJobStatus,
  type ReminderAppointmentInput,
} from "@/lib/line/automations/appointment-reminder-schedule";
import {
  canAutoEnrollProductionCustomers,
  canEnableAutomaticLineSend,
} from "@/lib/line/automations/phase-3a-inventory";

export const DRY_RUN_ORGANIZATION_ID = ORG_BEAUTY_OS_TEST_ID;
export const DRY_RUN_APPOINTMENT_ID = "apt-3b-dry-run";
export const DRY_RUN_CUSTOMER_ID = "cust-3b-dry-run";
export const DRY_RUN_RECIPIENT_ID = "rcpt-3b-explicit-test";
export const DRY_RUN_DID_NOT_SEND_LINE = true;

export type DryRunLog = {
  atMs: number;
  jobKey: string;
  action: "create" | "plan" | "due_check" | "reverify" | "simulate_send" | "skip" | "fail";
  status: AppointmentReminderJobStatus | "ok";
  reason: string;
  sentLine: false;
};

export type DryRunRecipient = {
  id: string;
  organizationId: string;
  audience: AppointmentReminderAudience;
  approved: boolean;
  unsubscribed: boolean;
  blocked: boolean;
};

export type DryRunStore = {
  available: boolean;
  organizationId: string;
  reminderEnabled: boolean;
  appointments: Map<string, ReminderAppointmentInput>;
  recipients: Map<string, DryRunRecipient>;
  jobs: AppointmentReminderJob[];
  claimedKeys: Set<string>;
  inflightKeys: Set<string>;
  logs: DryRunLog[];
  quota: LineQuotaPublic | null;
  dispatchedThisWindow: number;
  failNextExecution: boolean;
};

export type DryRunTickResult = {
  simulated: true;
  sentLine: false;
  processed: AppointmentReminderJob[];
  logs: DryRunLog[];
};

const ALLOWED_ORG = DRY_RUN_ORGANIZATION_ID;

function log(
  store: DryRunStore,
  input: Omit<DryRunLog, "sentLine">,
): DryRunLog {
  const row: DryRunLog = { ...input, sentLine: false };
  store.logs.push(row);
  return row;
}

export function createDryRunStore(): DryRunStore {
  return {
    available: true,
    organizationId: DRY_RUN_ORGANIZATION_ID,
    reminderEnabled: true,
    appointments: new Map(),
    recipients: new Map(),
    jobs: [],
    claimedKeys: new Set(),
    inflightKeys: new Set(),
    logs: [],
    quota: describeLineQuota({ type: "none", usage: 0 }),
    dispatchedThisWindow: 0,
    failNextExecution: false,
  };
}

export function createDryRunAppointment(input?: Partial<ReminderAppointmentInput>): ReminderAppointmentInput {
  return {
    id: DRY_RUN_APPOINTMENT_ID,
    organizationId: DRY_RUN_ORGANIZATION_ID,
    customerId: DRY_RUN_CUSTOMER_ID,
    startAt: taipeiLocalToUtcIso("2026-10-20", "16:00"),
    status: "BOOKED",
    version: 1,
    ...input,
  };
}

export function createDryRunRecipient(input?: Partial<DryRunRecipient>): DryRunRecipient {
  return {
    id: DRY_RUN_RECIPIENT_ID,
    organizationId: DRY_RUN_ORGANIZATION_ID,
    audience: "explicit_test",
    approved: true,
    unsubscribed: false,
    blocked: false,
    ...input,
  };
}

export function seedDryRunAppointment(store: DryRunStore, appointment: ReminderAppointmentInput): void {
  store.appointments.set(appointment.id, { ...appointment });
  log(store, {
    atMs: 0,
    jobKey: appointment.id,
    action: "create",
    status: "ok",
    reason: "已建立本機模擬預約",
  });
}

export function seedDryRunRecipient(store: DryRunStore, recipient: DryRunRecipient): void {
  store.recipients.set(recipient.id, { ...recipient });
}

export function planDryRunReminders(
  store: DryRunStore,
  appointmentId: string,
  nowMs = Date.parse("2026-10-18T00:00:00.000Z"),
): AppointmentReminderJob[] {
  const appointment = store.appointments.get(appointmentId);
  if (!appointment) return [];
  const planned = planAppointmentReminderJobs({
    appointment,
    enabled: store.reminderEnabled,
    audience: "explicit_test",
    nowMs,
  });
  store.jobs = [...store.jobs, ...planned];
  for (const job of planned) {
    log(store, {
      atMs: nowMs,
      jobKey: job.key,
      action: "plan",
      status: job.status,
      reason: job.reason,
    });
  }
  return planned;
}

export function cancelDryRunAppointment(store: DryRunStore, appointmentId: string): void {
  const current = store.appointments.get(appointmentId);
  if (!current) return;
  store.appointments.set(appointmentId, { ...current, status: "CANCELLED" });
  store.jobs = invalidateReminderJobs(store.jobs, appointmentId, "cancel");
}

export function rescheduleDryRunAppointment(
  store: DryRunStore,
  appointmentId: string,
  startAt: string,
  nowMs = Date.parse("2026-10-18T00:00:00.000Z"),
): AppointmentReminderJob[] {
  const current = store.appointments.get(appointmentId);
  if (!current) return [];
  store.jobs = invalidateReminderJobs(store.jobs, appointmentId, "reschedule");
  const next = { ...current, startAt, version: current.version + 1 };
  store.appointments.set(appointmentId, next);
  return planDryRunReminders(store, appointmentId, nowMs);
}

function claimJob(store: DryRunStore, key: string): boolean {
  if (store.claimedKeys.has(key) || store.inflightKeys.has(key)) return false;
  store.inflightKeys.add(key);
  return true;
}

export function reverifyDryRunJob(input: {
  store: DryRunStore;
  job: AppointmentReminderJob;
  recipientId?: string;
}): { ok: boolean; status: AppointmentReminderJobStatus; reason: string } {
  const { store, job } = input;
  if (!store.available) {
    return { ok: false, status: "unavailable", reason: "模擬資料庫不可用，已跳過" };
  }
  if (!appointmentReminderFlagsClosed() || canEnableAutomaticLineSend()) {
    return { ok: false, status: "failed", reason: "發送開關被意外開啟，已停止" };
  }
  if (store.organizationId !== ALLOWED_ORG || job.organizationId !== ALLOWED_ORG) {
    return { ok: false, status: "skipped_ineligible", reason: "organizationId 不正確" };
  }
  if (!store.reminderEnabled) {
    return { ok: false, status: "skipped_disabled", reason: "後台已停用預約提醒" };
  }
  const appointment = store.appointments.get(job.appointmentId);
  if (!appointment) {
    return { ok: false, status: "skipped_ineligible", reason: "預約已不存在" };
  }
  if (appointment.status === "CANCELLED") {
    return { ok: false, status: "invalidated", reason: "預約已取消，提醒失效" };
  }
  if (!isReminderEligibleStatus(appointment.status)) {
    return { ok: false, status: "skipped_ineligible", reason: "預約狀態不是 BOOKED 或 CONFIRMED" };
  }
  if (appointment.version !== job.version || appointment.startAt !== job.appointmentStartAt) {
    return { ok: false, status: "invalidated", reason: "預約時間或 version 已改變" };
  }
  const recipient = store.recipients.get(input.recipientId ?? DRY_RUN_RECIPIENT_ID);
  if (!recipient || recipient.organizationId !== ALLOWED_ORG) {
    return { ok: false, status: "blocked_audience", reason: "找不到明確核准的測試接收者" };
  }
  if (!recipient.approved || recipient.audience !== "explicit_test" || canAutoEnrollProductionCustomers()) {
    return { ok: false, status: "blocked_audience", reason: "接收者不是明確核准的測試對象" };
  }
  if (recipient.unsubscribed) {
    return { ok: false, status: "skipped_ineligible", reason: "接收者已退訂" };
  }
  if (recipient.blocked) {
    return { ok: false, status: "skipped_ineligible", reason: "接收者已封鎖" };
  }
  if (lineQuotaBlocksSend(store.quota)) {
    return { ok: false, status: "blocked_quota", reason: lineOfficialQuotaBlockMessage(store.quota) };
  }
  if (store.dispatchedThisWindow >= APPOINTMENT_REMINDER_RATE_LIMIT) {
    return { ok: false, status: "blocked_rate", reason: "已達本機速率上限" };
  }
  if (store.claimedKeys.has(job.key)) {
    return { ok: false, status: "duplicate", reason: "同一提醒已被處理" };
  }
  return { ok: true, status: "planned", reason: "重新驗證通過，僅模擬發送" };
}

export function executeDueDryRunJobs(input: {
  store: DryRunStore;
  nowMs: number;
  recipientId?: string;
}): DryRunTickResult {
  const processed: AppointmentReminderJob[] = [];
  if (!input.store.available) {
    for (const job of input.store.jobs.filter((row) => row.status === "planned")) {
      const next = { ...job, status: "unavailable" as const, reason: "模擬資料庫不可用，已跳過" };
      replaceJob(input.store, next);
      processed.push(next);
      log(input.store, {
        atMs: input.nowMs,
        jobKey: job.key,
        action: "skip",
        status: "unavailable",
        reason: next.reason,
      });
    }
    return { simulated: true, sentLine: false, processed, logs: input.store.logs };
  }

  for (const job of input.store.jobs.filter((row) => row.status === "planned")) {
    log(input.store, {
      atMs: input.nowMs,
      jobKey: job.key,
      action: "due_check",
      status: job.status,
      reason: new Date(job.fireAt).getTime() <= input.nowMs ? "提醒已到期，開始重新驗證" : "尚未到期",
    });
    if (new Date(job.fireAt).getTime() > input.nowMs) continue;
    if (!claimJob(input.store, job.key)) {
      const next = { ...job, status: "duplicate" as const, reason: "同一提醒正在處理或已處理" };
      replaceJob(input.store, next);
      processed.push(next);
      log(input.store, {
        atMs: input.nowMs,
        jobKey: job.key,
        action: "skip",
        status: "duplicate",
        reason: next.reason,
      });
      continue;
    }
    const verified = reverifyDryRunJob({
      store: input.store,
      job,
      recipientId: input.recipientId,
    });
    log(input.store, {
      atMs: input.nowMs,
      jobKey: job.key,
      action: "reverify",
      status: verified.status,
      reason: verified.reason,
    });
    if (!verified.ok) {
      input.store.inflightKeys.delete(job.key);
      const next = { ...job, status: verified.status, reason: verified.reason };
      replaceJob(input.store, next);
      processed.push(next);
      log(input.store, {
        atMs: input.nowMs,
        jobKey: job.key,
        action: "skip",
        status: verified.status,
        reason: verified.reason,
      });
      continue;
    }
    if (input.store.failNextExecution) {
      input.store.failNextExecution = false;
      input.store.inflightKeys.delete(job.key);
      const next = { ...job, status: "failed" as const, reason: "模擬執行失敗，未呼叫 LINE" };
      replaceJob(input.store, next);
      processed.push(next);
      log(input.store, {
        atMs: input.nowMs,
        jobKey: job.key,
        action: "fail",
        status: "failed",
        reason: next.reason,
      });
      continue;
    }
    input.store.inflightKeys.delete(job.key);
    input.store.claimedKeys.add(job.key);
    input.store.dispatchedThisWindow += 1;
    const next = {
      ...job,
      status: "simulated" as const,
      reason: "模擬發送完成，未呼叫 LINE，也沒有真正送出",
    };
    replaceJob(input.store, next);
    processed.push(next);
    log(input.store, {
      atMs: input.nowMs,
      jobKey: job.key,
      action: "simulate_send",
      status: "simulated",
      reason: next.reason,
    });
  }
  return { simulated: true, sentLine: false, processed, logs: input.store.logs };
}

function replaceJob(store: DryRunStore, next: AppointmentReminderJob): void {
  store.jobs = store.jobs.map((row) => (row.key === next.key ? next : row));
}

export function runCanonicalAppointmentReminderDryRun(): {
  store: DryRunStore;
  sentLine: false;
  simulatedCount: number;
  jobs: AppointmentReminderJob[];
  logs: DryRunLog[];
} {
  const store = createDryRunStore();
  seedDryRunRecipient(store, createDryRunRecipient());
  seedDryRunAppointment(store, createDryRunAppointment());
  planDryRunReminders(store, DRY_RUN_APPOINTMENT_ID);
  executeDueDryRunJobs({ store, nowMs: Date.parse("2026-10-19T02:00:00.000Z") });
  executeDueDryRunJobs({ store, nowMs: Date.parse("2026-10-20T05:00:00.000Z") });
  return {
    store,
    sentLine: false,
    simulatedCount: store.jobs.filter((row) => row.status === "simulated").length,
    jobs: store.jobs,
    logs: store.logs,
  };
}

export function futureReminderRuntimePlan(): {
  persistJobs: true;
  atomicClaim: true;
  retryUnknownTimeout: true;
  auditLog: true;
  scheduler: string;
  appliesSqlThisPhase: false;
  createsCronThisPhase: false;
} {
  return {
    persistJobs: true,
    atomicClaim: true,
    retryUnknownTimeout: true,
    auditLog: true,
    scheduler: "queue_or_frequent_tick_for_3h_window",
    appliesSqlThisPhase: false,
    createsCronThisPhase: false,
  };
}

export function dryRunJobLabel(status: AppointmentReminderJobStatus): string {
  switch (status) {
    case "planned":
      return "待模擬";
    case "simulated":
      return "模擬完成（未發送 LINE）";
    case "skipped_disabled":
      return "已跳過：功能停用";
    case "skipped_ineligible":
      return "已跳過：條件不符";
    case "skipped_past":
      return "已跳過：時間已過";
    case "invalidated":
      return "已失效";
    case "duplicate":
      return "已跳過：重複";
    case "blocked_quota":
      return "已跳過：額度";
    case "blocked_rate":
      return "已跳過：速率";
    case "blocked_audience":
      return "已跳過：接收者";
    case "blocked_send_closed":
      return "真實發送關閉";
    case "unavailable":
      return "已跳過：資料庫不可用";
    case "failed":
      return "模擬失敗（未發送 LINE）";
  }
}

