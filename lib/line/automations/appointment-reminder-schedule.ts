/**
 * Phase 3A appointment-reminder planner (local only).
 * Plans, invalidates, and logs. Never calls LINE and never writes Production.
 */
import type { CanonicalAppointmentStatus } from "@/lib/appointments/domain";
import {
  addMinutesToIso,
  taipeiLocalToUtcIso,
  utcIsoToTaipeiLocal,
} from "@/lib/persistence/appointment-time";
import { lineOfficialQuotaBlockMessage, lineQuotaBlocksSend } from "@/lib/line/line-quota";
import type { LineQuotaPublic } from "@/lib/line/line-types";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import {
  canAutoEnrollProductionCustomers,
  canEnableAutomaticLineSend,
} from "@/lib/line/automations/phase-3a-inventory";

export const APPOINTMENT_REMINDER_TIMEZONE = "Asia/Taipei";
export const APPOINTMENT_REMINDER_DAY_BEFORE_HM = "10:00";
export const APPOINTMENT_REMINDER_HOURS_BEFORE = 3;
export const APPOINTMENT_REMINDER_RATE_LIMIT = 10;

export const REMINDER_KINDS = ["day_before", "hours_before_3"] as const;
export type AppointmentReminderKind = (typeof REMINDER_KINDS)[number];
export type AppointmentReminderAudience = "explicit_test" | "production_customer";
export type AppointmentReminderJobStatus =
  | "planned"
  | "skipped_disabled"
  | "skipped_ineligible"
  | "skipped_past"
  | "invalidated"
  | "duplicate"
  | "blocked_quota"
  | "blocked_rate"
  | "blocked_audience"
  | "blocked_send_closed"
  | "failed";

export type ReminderAppointmentInput = {
  id: string;
  organizationId: string;
  customerId: string;
  startAt: string;
  status: CanonicalAppointmentStatus;
  version: number;
};

export type AppointmentReminderJob = {
  key: string;
  appointmentId: string;
  organizationId: string;
  kind: AppointmentReminderKind;
  version: number;
  fireAt: string;
  audience: AppointmentReminderAudience;
  status: AppointmentReminderJobStatus;
  reason: string;
};

const ELIGIBLE_STATUSES: readonly CanonicalAppointmentStatus[] = ["BOOKED", "CONFIRMED"];

export function appointmentReminderFlagsClosed(): boolean {
  return (
    LINE_BROADCAST_SEND_OPEN === false &&
    LINE_AUTOMATION_SEND_OPEN === false &&
    LINE_OWNER_SELF_PUSH_OPEN === false &&
    LINE_AUTOMATION_KILL_SWITCH === false &&
    canEnableAutomaticLineSend() === false
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function subtractTaipeiCalendarDays(dateYmd: string, days: number): string {
  const [year, month, day] = dateYmd.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day) - days * 86_400_000;
  const next = new Date(utc);
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export function reminderJobKey(input: {
  organizationId: string;
  appointmentId: string;
  kind: AppointmentReminderKind;
  version: number;
}): string {
  return `${input.organizationId}:${input.appointmentId}:${input.kind}:v${input.version}`;
}

export function reminderFireAt(kind: AppointmentReminderKind, startAt: string): string {
  if (kind === "hours_before_3") {
    return addMinutesToIso(startAt, -APPOINTMENT_REMINDER_HOURS_BEFORE * 60);
  }
  const { dateYmd } = utcIsoToTaipeiLocal(startAt);
  return taipeiLocalToUtcIso(subtractTaipeiCalendarDays(dateYmd, 1), APPOINTMENT_REMINDER_DAY_BEFORE_HM);
}

export function isReminderEligibleStatus(status: CanonicalAppointmentStatus): boolean {
  return ELIGIBLE_STATUSES.includes(status);
}

export function planAppointmentReminderJobs(input: {
  appointment: ReminderAppointmentInput;
  enabled: boolean;
  audience: AppointmentReminderAudience;
  nowMs?: number;
  kinds?: readonly AppointmentReminderKind[];
}): AppointmentReminderJob[] {
  const kinds = input.kinds ?? REMINDER_KINDS;
  const nowMs = input.nowMs ?? Date.now();
  return kinds.map((kind) => {
    const fireAt = reminderFireAt(kind, input.appointment.startAt);
    const key = reminderJobKey({
      organizationId: input.appointment.organizationId,
      appointmentId: input.appointment.id,
      kind,
      version: input.appointment.version,
    });
    if (!input.enabled) {
      return job(key, input, kind, fireAt, "skipped_disabled", "後台已停用預約提醒");
    }
    if (!isReminderEligibleStatus(input.appointment.status)) {
      return job(key, input, kind, fireAt, "skipped_ineligible", "預約狀態不可發送提醒");
    }
    if (new Date(fireAt).getTime() <= nowMs) {
      return job(key, input, kind, fireAt, "skipped_past", "發送時間已過");
    }
    return job(key, input, kind, fireAt, "planned", "已列入本機排程，尚未發送");
  });
}

function job(
  key: string,
  input: { appointment: ReminderAppointmentInput; audience: AppointmentReminderAudience },
  kind: AppointmentReminderKind,
  fireAt: string,
  status: AppointmentReminderJobStatus,
  reason: string,
): AppointmentReminderJob {
  return {
    key,
    appointmentId: input.appointment.id,
    organizationId: input.appointment.organizationId,
    kind,
    version: input.appointment.version,
    fireAt,
    audience: input.audience,
    status,
    reason,
  };
}

export function invalidateReminderJobs(
  jobs: readonly AppointmentReminderJob[],
  appointmentId: string,
  cause: "cancel" | "reschedule",
): AppointmentReminderJob[] {
  return jobs.map((row) => {
    if (row.appointmentId !== appointmentId) return row;
    if (row.status !== "planned") return row;
    return {
      ...row,
      status: "invalidated",
      reason: cause === "cancel" ? "預約已取消，提醒失效" : "預約已改期，舊提醒失效",
    };
  });
}

export function evaluateReminderDispatch(input: {
  job: AppointmentReminderJob;
  claimedKeys: ReadonlySet<string>;
  audience: AppointmentReminderAudience;
  quota?: LineQuotaPublic | null;
  dispatchedThisWindow?: number;
  nowMs?: number;
}): AppointmentReminderJob {
  if (input.job.status !== "planned") return input.job;
  if (!appointmentReminderFlagsClosed() || canEnableAutomaticLineSend()) {
    return { ...input.job, status: "failed", reason: "發送開關被意外開啟，已停止" };
  }
  if (
    input.audience === "production_customer" ||
    input.job.audience === "production_customer" ||
    canAutoEnrollProductionCustomers() === true
  ) {
    return {
      ...input.job,
      status: "blocked_audience",
      reason: "正式顧客不得自動成為測試發送對象",
    };
  }
  if (input.claimedKeys.has(input.job.key)) {
    return { ...input.job, status: "duplicate", reason: "同一預約同一時機不可重複發送" };
  }
  if (lineQuotaBlocksSend(input.quota)) {
    return {
      ...input.job,
      status: "blocked_quota",
      reason: lineOfficialQuotaBlockMessage(input.quota),
    };
  }
  if ((input.dispatchedThisWindow ?? 0) >= APPOINTMENT_REMINDER_RATE_LIMIT) {
    return { ...input.job, status: "blocked_rate", reason: "已達本機速率上限" };
  }
  const nowMs = input.nowMs ?? Date.now();
  if (new Date(input.job.fireAt).getTime() > nowMs) {
    return input.job;
  }
  return {
    ...input.job,
    status: "blocked_send_closed",
    reason: "排程已到期，但真實 LINE 發送仍關閉",
  };
}

export function localReminderDemoAppointment(): ReminderAppointmentInput {
  return {
    id: "apt-3a-local-test",
    organizationId: "org-beauty-os-test",
    customerId: "cust-3a-local-test",
    startAt: taipeiLocalToUtcIso("2026-10-20", "16:00"),
    status: "BOOKED",
    version: 1,
  };
}

export function buildLocalReminderDemo(input: {
  enabled: boolean;
  nowMs?: number;
}): AppointmentReminderJob[] {
  return planAppointmentReminderJobs({
    appointment: localReminderDemoAppointment(),
    enabled: input.enabled,
    audience: "explicit_test",
    nowMs: input.nowMs ?? Date.parse("2026-10-18T00:00:00.000Z"),
  });
}
