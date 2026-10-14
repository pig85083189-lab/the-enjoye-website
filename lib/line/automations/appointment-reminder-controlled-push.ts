/**
 * Phase 2E-3 controlled reminder Push design. SEND stays hardcoded closed.
 * This module only evaluates whether a future one-shot TEST Push would be
 * allowed. It never calls LINE, never opens Broadcast, and never reads a
 * formal customer list.
 */

import { evaluateAppointmentReminderAudience } from "@/lib/line/automations/appointment-reminder-bindings";
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
import type { LineQuotaPublic } from "@/lib/line/line-types";
import { ORG_BEAUTY_OS_TEST_ID } from "@/lib/tenant/constants";

export const LINE_APPOINTMENT_REMINDER_CONTROLLED_PUSH_OPEN = false;
export const CONTROLLED_REMINDER_PUSH_ALLOWED_ORG_ID = ORG_BEAUTY_OS_TEST_ID;
export const CONTROLLED_REMINDER_PUSH_DAILY_LIMIT = 1;
export const CONTROLLED_REMINDER_PUSH_CONFIRM_PHRASE = "確認發送測試預約提醒";
export const CONTROLLED_REMINDER_PUSH_ONESHOT_PREFIX = "larcq-";

export type ControlledReminderPushReason =
  | AppointmentReminderSkipReason
  | "send_closed"
  | "unauthorized"
  | "invalid_input"
  | "duplicate"
  | "quota_exceeded"
  | "inflight";

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
  if (hash.length >= 8) return `••••${hash.slice(-4)}`;
  return "••••";
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
  if (!input.killSwitchOpen) {
    return refuse(base, "send_closed", "受控測試停止開關已關閉");
  }
  if (input.recipientCount !== 1) {
    return refuse(base, "invalid_input", "受控測試只能指定一位收件者，不能群發");
  }
  if (!input.designatedCustomerId.startsWith("cust-")) {
    return refuse(base, "invalid_input", "缺少 Owner 指定的測試收件者");
  }
  if (input.appointment.customerId !== input.designatedCustomerId) {
    return refuse(base, "unauthorized", "這則預約不是指定的測試收件者");
  }
  if (input.confirmPhrase.trim() !== CONTROLLED_REMINDER_PUSH_CONFIRM_PHRASE) {
    return refuse(base, "invalid_input", "請再次確認測試發送文句");
  }
  if (!input.oneshotId.startsWith(CONTROLLED_REMINDER_PUSH_ONESHOT_PREFIX)) {
    return refuse(base, "invalid_input", "缺少單次授權識別");
  }
  if (input.oneshotConsumed) {
    return refuse(base, "duplicate", "這次單次授權已使用，不會重送");
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

  const audience = evaluateAppointmentReminderAudience({
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
