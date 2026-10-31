/**
 * Pure, fail-closed appointment slot evaluator.
 * This module never reads browser localStorage and never writes to the database.
 * Inputs MUST come from a verified tenant-scoped server repository.
 */
export type BookingInterval = { startsAt: string; endsAt: string };
export type WorkingWindow = { dayOfWeek: number; startTime: string; endTime: string; isWorking: boolean };

export type SlotCheckInput = {
  date: string; // YYYY-MM-DD, in Asia/Taipei
  startTime: string; // HH:mm, in Asia/Taipei
  durationMinutes: number;
  workingHours: WorkingWindow[] | null;
  breaks: BookingInterval[] | null;
  approvedTimeOff: BookingInterval[] | null;
  occupiedAppointments: BookingInterval[] | null;
  staffVerified: boolean;
  locationVerified: boolean;
  serviceVerified: boolean;
  /** Explicit confirmation that the authoritative repository returned complete data. */
  scheduleSnapshotComplete: boolean;
};

export type SlotCheckResult =
  | { available: true; startsAt: string; endsAt: string }
  | { available: false; reason: "INVALID_INPUT" | "NOT_VERIFIED" | "MISSING_SCHEDULE" | "OUTSIDE_HOURS" | "BREAK" | "TIME_OFF" | "CONFLICT" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TAIWAN_OFFSET_MINUTES = 480;

function minutes(hm: string): number | null {
  const match = TIME.exec(hm);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function overlaps(a: BookingInterval, b: BookingInterval): boolean {
  return Date.parse(a.startsAt) < Date.parse(b.endsAt) &&
    Date.parse(b.startsAt) < Date.parse(a.endsAt);
}

export function checkBookingSlot(input: SlotCheckInput): SlotCheckResult {
  if (!input.staffVerified || !input.locationVerified || !input.serviceVerified) {
    return { available: false, reason: "NOT_VERIFIED" };
  }
  if (!input.scheduleSnapshotComplete || !input.workingHours || !input.breaks || !input.approvedTimeOff || !input.occupiedAppointments) {
    return { available: false, reason: "MISSING_SCHEDULE" };
  }
  const startMinutes = minutes(input.startTime);
  if (!DATE.test(input.date) || startMinutes === null ||
      !Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0 ||
      input.durationMinutes > 480 || startMinutes + input.durationMinutes > 1440) {
    return { available: false, reason: "INVALID_INPUT" };
  }
  const midnight = Date.parse(input.date + "T00:00:00+08:00");
  if (!Number.isFinite(midnight) ||
      new Date(midnight + TAIWAN_OFFSET_MINUTES * 60000).toISOString().slice(0, 10) !== input.date) {
    return { available: false, reason: "INVALID_INPUT" };
  }
  const day = new Date(midnight + TAIWAN_OFFSET_MINUTES * 60000).getUTCDay();
  const matchingHours = input.workingHours.filter(row => row.dayOfWeek === day);
  if (matchingHours.length > 1) return { available: false, reason: "INVALID_INPUT" };
  const hours = matchingHours[0];
  if (!hours || !hours.isWorking) return { available: false, reason: "OUTSIDE_HOURS" };
  const workStart = minutes(hours.startTime);
  const workEnd = minutes(hours.endTime);
  if (workStart === null || workEnd === null || startMinutes < workStart ||
      startMinutes + input.durationMinutes > workEnd) {
    return { available: false, reason: "OUTSIDE_HOURS" };
  }
  const startsAt = new Date(midnight + startMinutes * 60000).toISOString();
  const endsAt = new Date(midnight + (startMinutes + input.durationMinutes) * 60000).toISOString();
  const candidate = { startsAt, endsAt };
  for (const [list, reason] of [
    [input.breaks, "BREAK"],
    [input.approvedTimeOff, "TIME_OFF"],
    [input.occupiedAppointments, "CONFLICT"],
  ] as const) {
    for (const interval of list) {
      const start = Date.parse(interval.startsAt);
      const end = Date.parse(interval.endsAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return { available: false, reason: "INVALID_INPUT" };
      }
      if (overlaps(candidate, interval)) return { available: false, reason };
    }
  }
  return { available: true, startsAt, endsAt };
}
