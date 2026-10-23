import { lineAutomationBuiltinTimingIds } from "@/lib/line/automations/catalog";
import {
  LINE_AUTOMATION_MORNING_HM,
  type LineAutomationEventKind,
} from "@/lib/line/automations/schedule-types";
import type { LineAutomationId } from "@/lib/line/automations/types";
import {
  addMinutesToIso,
  taipeiLocalToUtcIso,
  utcIsoToTaipeiLocal,
} from "@/lib/persistence/appointment-time";
import { subtractTaipeiCalendarDays } from "@/lib/line/automations/appointment-reminder-schedule";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addTaipeiCalendarDays(dateYmd: string, days: number): string {
  if (!isYmd(dateYmd) || !Number.isInteger(days)) {
    throw new Error("Invalid Taipei calendar date");
  }
  return subtractTaipeiCalendarDays(dateYmd, -days);
}

export function isValidTaipeiYmd(value: string): boolean {
  if (!isYmd(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function nextBirthdayYmd(birthdayYmd: string, nowTaipeiYmd: string): string | null {
  if (!isValidTaipeiYmd(birthdayYmd) || !isValidTaipeiYmd(nowTaipeiYmd)) return null;
  const month = birthdayYmd.slice(5, 7);
  const day = birthdayYmd.slice(8, 10);
  const nowYear = Number(nowTaipeiYmd.slice(0, 4));
  const candidate = resolveMonthDay(nowYear, month, day);
  if (!candidate) return null;
  if (candidate >= nowTaipeiYmd) return candidate;
  return resolveMonthDay(nowYear + 1, month, day);
}

function resolveMonthDay(year: number, month: string, day: string): string | null {
  if (month === "02" && day === "29" && !isLeapYear(year)) {
    return `${year}-02-28`;
  }
  const ymd = `${year}-${month}-${day}`;
  return isValidTaipeiYmd(ymd) ? ymd : null;
}

export function automationJobFingerprint(input: {
  organizationId: string;
  automationType: LineAutomationId;
  eventId: string;
  timingId: string;
}): string {
  return [
    input.organizationId,
    input.automationType,
    input.eventId,
    input.timingId,
  ].join("|");
}

/** Birthday occurrence identity for a single Taipei calendar year.
 * This is not yet used by the schedule planner: the database validator in
 * 20261017140000 requires the legacy four-part fingerprint. Switch both
 * sides atomically in an additive migration before enabling annual jobs.
 */
export function annualBirthdayJobFingerprint(input: {
  organizationId: string;
  customerId: string;
  timingId: string;
  occurrenceYmd: string;
}): string {
  if (!isValidTaipeiYmd(input.occurrenceYmd)) {
    throw new Error("Invalid birthday occurrence");
  }
  if (!input.organizationId.startsWith("org-") || input.organizationId.includes("|") ||
      !input.customerId.trim() || input.customerId.includes("|") ||
      !["birthday_morning", "days_before_3"].includes(input.timingId)) {
    throw new Error("Invalid birthday fingerprint input");
  }
  const year = input.occurrenceYmd.slice(0, 4);
  return [input.organizationId, "birthday_greeting", input.customerId, input.timingId, year].join("|");
}

/**
 * Resolve the birthday occurrence from a proposed send time. Advance reminders
 * can be sent in December for a January birthday, so the send year is not
 * necessarily the birthday occurrence year.
 * Preparatory only: the legacy schedule SQL contract is still active.
 */
export function birthdayOccurrenceYmdForFireAt(input: {
  birthdayYmd: string;
  timingId: "birthday_morning" | "days_before_3";
  fireAt: string;
}): string | null {
  if (!isValidTaipeiYmd(input.birthdayYmd)) return null;
  const sendMs = Date.parse(input.fireAt);
  if (!Number.isFinite(sendMs)) return null;
  const sendYmd = utcIsoToTaipeiLocal(new Date(sendMs).toISOString()).dateYmd;
  const occurrenceYmd = input.timingId === "days_before_3"
    ? addTaipeiCalendarDays(sendYmd, 3)
    : sendYmd;
  if (!isValidTaipeiYmd(occurrenceYmd)) return null;
  const year = Number(occurrenceYmd.slice(0, 4));
  const expected = resolveMonthDay(year, input.birthdayYmd.slice(5, 7), input.birthdayYmd.slice(8, 10));
  return expected === occurrenceYmd ? occurrenceYmd : null;
}

export function computeAutomationFireAt(input: {
  automationType: LineAutomationId;
  timingId: string;
  eventKind: LineAutomationEventKind;
  startAt?: string | null;
  completedAt?: string | null;
  expiresAt?: string | null;
  birthdayYmd?: string | null;
  holidayDateYmd?: string | null;
  nowTaipeiYmd: string;
}): string | null {
  const builtin = lineAutomationBuiltinTimingIds(input.automationType);
  if (!builtin || !builtin.includes(input.timingId)) return null;

  if (input.automationType === "appointment_reminder") {
    if (!input.startAt) return null;
    if (input.timingId === "hours_before_3") {
      return addMinutesToIso(input.startAt, -180);
    }
    if (input.timingId === "day_before_morning") {
      const { dateYmd } = utcIsoToTaipeiLocal(input.startAt);
      return taipeiLocalToUtcIso(subtractTaipeiCalendarDays(dateYmd, 1), LINE_AUTOMATION_MORNING_HM);
    }
    return null;
  }

  if (input.automationType === "birthday_greeting") {
    const next = input.birthdayYmd ? nextBirthdayYmd(input.birthdayYmd, input.nowTaipeiYmd) : null;
    if (!next) return null;
    const sendYmd =
      input.timingId === "days_before_3" ? subtractTaipeiCalendarDays(next, 3) : next;
    return taipeiLocalToUtcIso(sendYmd, LINE_AUTOMATION_MORNING_HM);
  }

  if (input.automationType === "holiday_greeting") {
    if (!input.holidayDateYmd || !isValidTaipeiYmd(input.holidayDateYmd)) return null;
    if (input.timingId !== "cny" && input.timingId !== "mid_autumn" && input.timingId !== "christmas") {
      return null;
    }
    return taipeiLocalToUtcIso(input.holidayDateYmd, LINE_AUTOMATION_MORNING_HM);
  }

  if (input.automationType === "satisfaction_survey") {
    if (!input.completedAt) return null;
    if (input.timingId === "hours_after_2") {
      return addMinutesToIso(input.completedAt, 120);
    }
    if (input.timingId === "days_after_1") {
      const local = utcIsoToTaipeiLocal(input.completedAt);
      return taipeiLocalToUtcIso(addTaipeiCalendarDays(local.dateYmd, 1), local.hm);
    }
    return null;
  }

  if (input.automationType === "coupon_expiry") {
    if (!input.expiresAt) return null;
    const days =
      input.timingId === "days_before_7" ? 7 : input.timingId === "days_before_3" ? 3 : input.timingId === "days_before_1" ? 1 : null;
    if (days == null) return null;
    const { dateYmd } = utcIsoToTaipeiLocal(input.expiresAt);
    return taipeiLocalToUtcIso(subtractTaipeiCalendarDays(dateYmd, days), LINE_AUTOMATION_MORNING_HM);
  }

  return null;
}
