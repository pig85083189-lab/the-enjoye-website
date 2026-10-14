/**
 * Phase 2E-4 controlled reminder Push. SEND stays hardcoded closed.
 * Preview TEST may evaluate a single designated fake customer. This module
 * never calls LINE, never opens Broadcast, and never reads a formal list.
 */

import {
  APPOINTMENT_REMINDER_CLAIM_GRACE_MS,
  LINE_APPOINTMENT_REMINDER_SEND_OPEN,
  isAppointmentReminderSendOpen,
} from "@/lib/line/automations/appointment-reminder-flag";
import { appointmentReminderJobIsDue } from "@/lib/line/automations/appointment-reminder-jobs";
import type {
  AppointmentReminderAppointment,
  AppointmentReminderJob,
  AppointmentReminderSkipReason,
  CustomerLineBinding,
  NotificationPreference,
} from "@/lib/line/automations/appointment-reminder-types";
import { LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST } from "@/lib/line/line-flag";
import { reminderChannelSnapshotAllowsSend } from "@/lib/line/automations/appointment-reminder-dispatcher";
import { isLineUnknownHttpOutcome } from "@/lib/line/line-http-error";
import type { LineHttpErrorClass, LineQuotaPublic } from "@/lib/line/line-types";
import { ORG_BEAUTY_OS_TEST_ID } from "@/lib/tenant/constants";

export const LINE_APPOINTMENT_REMINDER_CONTROLLED_PUSH_OPEN = false;
export const CONTROLLED_REMINDER_PUSH_ALLOWED_ORG_ID = ORG_BEAUTY_OS_TEST_ID;
export const CONTROLLED_REMINDER_PUSH_ALLOWED_ORG_LABEL = "Beauty OS TEST";
export const CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID = "cust-2d2-fake-bound";
export const CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_NAME =
  "【假資料】2D2已綁定未同意測試客人";
export const CONTROLLED_REMINDER_PUSH_DAILY_LIMIT = 1;
export const CONTROLLED_REMINDER_PUSH_CONFIRM_PHRASE = "確認發送測試預約提醒";
export const CONTROLLED_REMINDER_PUSH_ONESHOT_PREFIX = "larcq-";
export const CONTROLLED_REMINDER_PUSH_KILL_SWITCH_OPEN = false;

export type ControlledReminderPushReason =
  | AppointmentReminderSkipReason
  | "send_closed"
  | "unauthorized"
  | "invalid_input"
  | "duplicate"
  | "quota_exceeded"
  | "inflight";

export type ControlledReminderBindStatus = "unbound" | "verified" | "blocked";
export type ControlledReminderConsentStatus = "not_consented" | "consented" | "unsubscribed";

export type ControlledReminderPushAudit = {
  organizationId: string;
  customerAppId: string;
  appointmentId: string;
  jobId: string;
  oneshotId: string;
  recipientHint: string;
  authorized: boolean;
  wouldSend: false;
  sent: false;
};

export type ControlledReminderPushDecision = {
  authorized: boolean;
  wouldSend: false;
  sent: false;
  reason: ControlledReminderPushReason;
  message: string;
  audit: ControlledReminderPushAudit;
};

export type ControlledReminderPushView = {
  visible: boolean;
  organizationId: string;
  organizationLabel: string;
  customerId: string;
  customerName: string;
  bindStatus: ControlledReminderBindStatus;
  consentStatus: ControlledReminderConsentStatus;
  recipientHint: string;
  previewText: string;
  remainingToday: number;
  confirmPhrase: string;
  oneshotId: string;
  killSwitchOpen: false;
  sendOpen: false;
  quotaLabel: string;
  canSubmit: false;
};

export type ControlledReminderPreviousAttempt = {
  oneshotId?: string | null;
  status?: string | null;
  errorClass?: LineHttpErrorClass | string | null;
  httpStatus?: number | null;
};

function previewHost(env: NodeJS.Dict<string>): string | null {
  const raw = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

function isPreviewControlledEnvironment(env: NodeJS.Dict<string>): boolean {
  if ((env.VERCEL_ENV ?? "").trim() === "production") return false;
  if ((env.VERCEL_ENV ?? "").trim() !== "preview") return false;
  return previewHost(env) === LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST;
}

function hintFromBinding(binding?: CustomerLineBinding | null): string {
  const hash = binding?.lineUserIdHash?.trim() ?? "";
  if (/^[0-9a-f]{16,}$/i.test(hash)) return `••••${hash.slice(-4)}`;
  return "••••";
}

export function isDesignatedControlledReminderCustomer(customerId: string | null | undefined): boolean {
  return customerId === CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID;
}

export function isControlledReminderPushPanelVisible(organizationId: string | null | undefined): boolean {
  return organizationId === CONTROLLED_REMINDER_PUSH_ALLOWED_ORG_ID;
}

export function newControlledReminderOneshotId(
  random: () => string = () => crypto.randomUUID(),
): string {
  return `${CONTROLLED_REMINDER_PUSH_ONESHOT_PREFIX}${random().replace(/-/g, "").slice(0, 16)}`;
}

export function remainingControlledReminderPushesToday(sentToday: number): number {
  return Math.max(0, CONTROLLED_REMINDER_PUSH_DAILY_LIMIT - Math.max(0, sentToday));
}

export function describeControlledReminderBindStatus(
  binding?: CustomerLineBinding | null,
): ControlledReminderBindStatus {
  if (!binding || binding.unboundAt || !binding.verified || !binding.lineUserIdHash) {
    return "unbound";
  }
  if (binding.blockedAt) return "blocked";
  return "verified";
}

export function describeControlledReminderConsentStatus(
  preference?: NotificationPreference | null,
): ControlledReminderConsentStatus {
  if (!preference || preference.unsubscribedAt) {
    return preference?.unsubscribedAt ? "unsubscribed" : "not_consented";
  }
  return preference.appointmentReminderOptIn ? "consented" : "not_consented";
}

export function controlledReminderPushRefusesRetry(input: {
  jobStatus?: string | null;
  oneshotConsumed?: boolean;
  previous?: ControlledReminderPreviousAttempt | null;
}): boolean {
  if (input.oneshotConsumed) return true;
  if (input.jobStatus === "accepted" || input.jobStatus === "pending_confirmation") return true;
  const previous = input.previous;
  if (!previous) return false;
  if (previous.status === "accepted" || previous.status === "pending_confirmation") return true;
  if (previous.errorClass === "timeout" || previous.errorClass === "unknown") return true;
  return isLineUnknownHttpOutcome(previous.httpStatus);
}

function refuse(
  input: {
    organizationId: string;
    customerId: string;
    appointmentId: string;
    jobId: string;
    oneshotId: string;
    recipientHint: string;
  },
  reason: ControlledReminderPushReason,
  message: string,
): ControlledReminderPushDecision {
  return {
    authorized: false,
    wouldSend: false,
    sent: false,
    reason,
    message,
    audit: {
      organizationId: input.organizationId,
      customerAppId: input.customerId,
      appointmentId: input.appointmentId,
      jobId: input.jobId,
      oneshotId: input.oneshotId,
      recipientHint: input.recipientHint,
      authorized: false,
      wouldSend: false,
      sent: false,
    },
  };
}

/**
 * Bind / consent for the designated TEST recipient. Never returns a LINE userId.
 * Client-supplied plaintext IDs are refused. Hash + verified is required.
 */
export function evaluateControlledReminderAudience(input: {
  organizationId: string;
  customerId: string;
  binding?: CustomerLineBinding | null;
  preference?: NotificationPreference | null;
  crmLineUserId?: string | null;
  ownerRecipientLineUserId?: string | null;
}): { ok: true } | { ok: false; skipReason: AppointmentReminderSkipReason; message: string } {
  if (input.crmLineUserId) {
    return {
      ok: false,
      skipReason: "plaintext_line_id_refused",
      message: "客戶 CRM LINE ID 不是已驗證綁定，系統不會發送",
    };
  }
  if (input.ownerRecipientLineUserId) {
    return {
      ok: false,
      skipReason: "invalid_recipient",
      message: "店長 LINE 綁定不能當作客人收件者",
    };
  }
  if (!isDesignatedControlledReminderCustomer(input.customerId)) {
    return { ok: false, skipReason: "invalid_recipient", message: "只能指定核准的測試假客戶" };
  }
  const binding = input.binding;
  if (!binding) {
    return { ok: false, skipReason: "unbound", message: "客人尚未完成已驗證的 LINE 綁定，系統不會發送" };
  }
  if (binding.organizationId !== input.organizationId || binding.customerId !== input.customerId) {
    return { ok: false, skipReason: "cross_org", message: "不能使用其他店家或客人的 LINE 綁定" };
  }
  if (binding.unboundAt || !binding.verified || !binding.lineUserIdHash) {
    return { ok: false, skipReason: "unbound", message: "客人尚未完成已驗證的 LINE 綁定，系統不會發送" };
  }
  if (binding.blockedAt) {
    return { ok: false, skipReason: "blocked", message: "客人已封鎖官方帳號，系統不會發送" };
  }
  const preference = input.preference;
  if (!preference || preference.organizationId !== input.organizationId) {
    return { ok: false, skipReason: "not_consented", message: "客人尚未同意預約提醒通知" };
  }
  if (preference.customerId !== input.customerId) {
    return { ok: false, skipReason: "cross_org", message: "不能使用其他客人的通知設定" };
  }
  if (preference.unsubscribedAt) {
    return { ok: false, skipReason: "unsubscribed", message: "客人已退訂預約提醒，系統不會發送" };
  }
  if (!preference.appointmentReminderOptIn) {
    return { ok: false, skipReason: "not_consented", message: "客人尚未同意預約提醒通知" };
  }
  return { ok: true };
}

/**
 * hours_before_3 fire time is startAt - 3h. Due window is now-20min..now.
 * Use this only to evaluate an already-persisted job. Persist planning
 * skips scheduledFor <= now as past_due, so a UI create must use a
 * future fire time and wait.
 */
export function dueWindowHoursBefore3StartAt(nowMs = Date.now(), skewMs = 2 * 60_000): {
  startAt: Date;
  fireAt: Date;
} {
  const fireAt = new Date(nowMs - Math.min(skewMs, APPOINTMENT_REMINDER_CLAIM_GRACE_MS - 60_000));
  return { fireAt, startAt: new Date(fireAt.getTime() + 3 * 60 * 60_000) };
}

/** Next 30-min Taipei start whose hours_before_3 fire is still in the future. */
export function upcomingHoursBefore3StartAt(nowMs = Date.now(), slotMinutes = 30): {
  startAt: Date;
  fireAt: Date;
  waitMs: number;
} {
  const threeHours = 3 * 60 * 60_000;
  const slotMs = slotMinutes * 60_000;
  const taipeiOffset = 8 * 60 * 60_000;
  const minStart = nowMs + threeHours + 60_000;
  const taipei = new Date(minStart + taipeiOffset);
  const alignedMinutes = Math.ceil((taipei.getUTCMinutes() || 0) / slotMinutes) * slotMinutes;
  const aligned = new Date(
    Date.UTC(
      taipei.getUTCFullYear(),
      taipei.getUTCMonth(),
      taipei.getUTCDate(),
      taipei.getUTCHours(),
      0,
      0,
      0,
    ) +
      alignedMinutes * 60_000 -
      taipeiOffset,
  );
  const startAt = aligned.getTime() <= minStart ? new Date(aligned.getTime() + slotMs) : aligned;
  const fireAt = new Date(startAt.getTime() - threeHours);
  return { startAt, fireAt, waitMs: Math.max(fireAt.getTime() - nowMs, 0) };
}

export function buildControlledReminderPushView(input: {
  organizationId: string;
  binding?: CustomerLineBinding | null;
  preference?: NotificationPreference | null;
  previewText: string;
  sentToday?: number;
  oneshotId?: string;
  quotaLabel?: string;
}): ControlledReminderPushView {
  const visible = isControlledReminderPushPanelVisible(input.organizationId);
  return {
    visible,
    organizationId: CONTROLLED_REMINDER_PUSH_ALLOWED_ORG_ID,
    organizationLabel: CONTROLLED_REMINDER_PUSH_ALLOWED_ORG_LABEL,
    customerId: CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID,
    customerName: CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_NAME,
    bindStatus: describeControlledReminderBindStatus(input.binding),
    consentStatus: describeControlledReminderConsentStatus(input.preference),
    recipientHint: hintFromBinding(input.binding),
    previewText: input.previewText,
    remainingToday: remainingControlledReminderPushesToday(input.sentToday ?? 0),
    confirmPhrase: CONTROLLED_REMINDER_PUSH_CONFIRM_PHRASE,
    oneshotId: input.oneshotId ?? "",
    killSwitchOpen: false,
    sendOpen: false,
    quotaLabel: input.quotaLabel ?? "本階段不查詢 LINE 額度，不會連接 LINE",
    canSubmit: false,
  };
}

export function evaluateControlledAppointmentReminderPush(input: {
  organizationId: string;
  designatedCustomerId: string;
  appointment: AppointmentReminderAppointment;
  job: AppointmentReminderJob;
  binding?: CustomerLineBinding | null;
  preference?: NotificationPreference | null;
  crmLineUserId?: string | null;
  ownerRecipientLineUserId?: string | null;
  confirmPhrase: string;
  oneshotId: string;
  oneshotConsumed?: boolean;
  killSwitchOpen: boolean;
  sentToday: number;
  recipientCount: number;
  lineQuota?: LineQuotaPublic | null;
  quotaCheckedAt?: string | null;
  channelInflight?: boolean;
  previousAttempt?: ControlledReminderPreviousAttempt | null;
  env?: NodeJS.Dict<string>;
  nowMs?: number;
}): ControlledReminderPushDecision {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  const recipientHint = hintFromBinding(input.binding);
  const base = {
    organizationId: input.organizationId,
    customerId: input.appointment.customerId,
    appointmentId: input.appointment.id,
    jobId: input.job.id,
    oneshotId: input.oneshotId,
    recipientHint,
  };

  if (LINE_APPOINTMENT_REMINDER_CONTROLLED_PUSH_OPEN) {
    return refuse(base, "send_closed", "受控測試發送開關必須維持關閉");
  }
  if (isAppointmentReminderSendOpen() || LINE_APPOINTMENT_REMINDER_SEND_OPEN) {
    return refuse(base, "send_closed", "預約提醒正式發送尚未開放");
  }
  if ((env.VERCEL_ENV ?? "").trim() === "production") {
    return refuse(base, "send_closed", "受控測試發送不可在 Production 開啟");
  }
  if (!isPreviewControlledEnvironment(env)) {
    return refuse(base, "send_closed", "受控測試發送只允許 Preview 與 Preview Supabase");
  }
  if (input.organizationId !== CONTROLLED_REMINDER_PUSH_ALLOWED_ORG_ID) {
    return refuse(base, "unauthorized", "受控測試發送只允許 Beauty OS TEST");
  }
  if (input.appointment.organizationId !== input.organizationId) {
    return refuse(base, "unauthorized", "不能使用其他店家的預約");
  }
  if (input.job.organizationId !== input.organizationId) {
    return refuse(base, "unauthorized", "不能使用其他店家的提醒任務");
  }
  if (input.recipientCount !== 1) {
    return refuse(base, "invalid_input", "受控測試只能指定一位收件者，不能群發");
  }
  if (!isDesignatedControlledReminderCustomer(input.designatedCustomerId)) {
    return refuse(base, "invalid_input", "缺少 Owner 指定的測試收件者");
  }
  if (
    !isDesignatedControlledReminderCustomer(input.appointment.customerId) ||
    input.appointment.customerId !== input.designatedCustomerId
  ) {
    return refuse(base, "unauthorized", "這則預約不是指定的測試收件者");
  }
  if (input.confirmPhrase.trim() !== CONTROLLED_REMINDER_PUSH_CONFIRM_PHRASE) {
    return refuse(base, "invalid_input", "請再次確認測試發送文句");
  }
  if (!input.oneshotId.startsWith(CONTROLLED_REMINDER_PUSH_ONESHOT_PREFIX)) {
    return refuse(base, "invalid_input", "缺少單次授權識別");
  }
  if (!input.killSwitchOpen) {
    return refuse(base, "send_closed", "受控測試停止開關已關閉");
  }
  if (
    controlledReminderPushRefusesRetry({
      jobStatus: input.job.status,
      oneshotConsumed: input.oneshotConsumed,
      previous: input.previousAttempt,
    })
  ) {
    return refuse(base, "duplicate", "這次單次授權已使用或結果待確認，不會重送");
  }
  if (input.sentToday >= CONTROLLED_REMINDER_PUSH_DAILY_LIMIT) {
    return refuse(base, "quota_exceeded", "今日受控測試發送次數已達上限");
  }

  const window = appointmentReminderJobIsDue({ job: input.job, nowMs: input.nowMs });
  if (window.expired) {
    return refuse(base, "expired_window", "提醒時間已過，不會補送");
  }
  if (!window.due) {
    return refuse(base, "past_due", "提醒時間尚未到達");
  }

  const audience = evaluateControlledReminderAudience({
    organizationId: input.organizationId,
    customerId: input.appointment.customerId,
    binding: input.binding,
    preference: input.preference,
    crmLineUserId: input.crmLineUserId,
    ownerRecipientLineUserId: input.ownerRecipientLineUserId,
  });
  if (!audience.ok) {
    return refuse(base, audience.skipReason, audience.message);
  }

  const snapshot = reminderChannelSnapshotAllowsSend({
    quota: input.lineQuota,
    quotaCheckedAt: input.quotaCheckedAt,
    nowMs: input.nowMs,
    channelInflight: input.channelInflight,
  });
  if (!snapshot.ok) {
    return refuse(
      base,
      snapshot.reason === "inflight" ? "inflight" : "quota_exceeded",
      snapshot.message,
    );
  }

  return {
    authorized: true,
    wouldSend: false,
    sent: false,
    reason: "send_closed",
    message: "檢查通過。受控測試發送仍關閉，沒有連接 LINE Push",
    audit: {
      organizationId: input.organizationId,
      customerAppId: input.appointment.customerId,
      appointmentId: input.appointment.id,
      jobId: input.job.id,
      oneshotId: input.oneshotId,
      recipientHint,
      authorized: true,
      wouldSend: false,
      sent: false,
    },
  };
}
