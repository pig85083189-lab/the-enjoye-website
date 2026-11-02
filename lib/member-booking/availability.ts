/**
 * Pure booking availability calculation. This module does not authorize callers
 * or read/write the database. Server routes must authenticate and scope all data.
 * All local date/time inputs are Asia/Taipei (UTC+08:00).
 */
export type WorkingDay = {
  staffId: string;
  dayOfWeek: number; // Sunday=0
  startTime: string; // HH:mm or HH:mm:ss
  endTime: string;
  isWorking: boolean;
};
export type BusyInterval = { startAt: string; endAt: string };
export type AvailabilityInput = {
  date: string; // YYYY-MM-DD
  staffId: string;
  serviceMinutes: number;
  slotMinutes?: number;
  workingDays: WorkingDay[];
  busy: BusyInterval[];
  /** Staff breaks or other local-time exclusions on the selected date. */
  breaks?: Array<{ startTime: string; endTime: string }>;
  /** Current instant or booking cutoff. Earlier starts are never offered. */
  notBefore?: string;
};
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_CLOCK = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function parseDay(date: string): number {
  const match = LOCAL_DATE.exec(date);
  if (!match) throw new Error("INVALID_DATE");
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  if (new Date(utc).toISOString().slice(0, 10) !== date) throw new Error("INVALID_DATE");
  return utc;
}
function clockMinutes(value: string): number {
  const match = LOCAL_CLOCK.exec(value);
  if (!match) throw new Error("INVALID_CLOCK");
  return Number(match[1]) * 60 + Number(match[2]);
}
function parseBusy(interval: BusyInterval): { start: number; end: number } {
  if (!interval.startAt.endsWith("Z") && !interval.startAt.endsWith("+08:00")) throw new Error("INVALID_BUSY_INTERVAL");
  if (!interval.endAt.endsWith("Z") && !interval.endAt.endsWith("+08:00")) throw new Error("INVALID_BUSY_INTERVAL");
  const start = Date.parse(interval.startAt), end = Date.parse(interval.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("INVALID_BUSY_INTERVAL");
  return { start, end };
}
export function calculateAvailableStarts(input: AvailabilityInput): string[] {
  const utcDay = parseDay(input.date);
  const { serviceMinutes, staffId, workingDays, busy } = input;
  const slotMinutes = input.slotMinutes ?? 30;
  if (!staffId || !Number.isInteger(serviceMinutes) || serviceMinutes <= 0 || serviceMinutes > 720 ||
      !Number.isInteger(slotMinutes) || slotMinutes <= 0 || slotMinutes > 120 ||
      !Array.isArray(workingDays) || !Array.isArray(busy)) throw new Error("INVALID_AVAILABILITY_INPUT");
  const weekday = new Date(utcDay).getUTCDay();
  const shifts = workingDays.filter(day => day.staffId === staffId && day.dayOfWeek === weekday && day.isWorking);
  const occupied = busy.map(parseBusy);
  if (input.breaks !== undefined && !Array.isArray(input.breaks)) throw new Error("INVALID_BREAKS");
  for (const item of input.breaks ?? []) {
    if (!item || typeof item.startTime !== "string" || typeof item.endTime !== "string") throw new Error("INVALID_BREAK");
    const from = clockMinutes(item.startTime), to = clockMinutes(item.endTime);
    if (to <= from) throw new Error("INVALID_BREAK");
    occupied.push({ start: utcDay - TAIPEI_OFFSET_MS + from * 60_000, end: utcDay - TAIPEI_OFFSET_MS + to * 60_000 });
  }
  const notBefore = input.notBefore === undefined ? Number.NEGATIVE_INFINITY : Date.parse(input.notBefore);
  if (Number.isNaN(notBefore)) throw new Error("INVALID_BOOKING_CUTOFF");
  const starts = new Set<number>();
  for (const shift of shifts) {
    const from = clockMinutes(shift.startTime), to = clockMinutes(shift.endTime);
    if (to <= from) throw new Error("INVALID_SHIFT");
    const first = Math.ceil(from / slotMinutes) * slotMinutes;
    for (let minute = first; minute + serviceMinutes <= to; minute += slotMinutes) {
      const start = utcDay - TAIPEI_OFFSET_MS + minute * 60_000;
      const end = start + serviceMinutes * 60_000;
      if (start < notBefore) continue;
      if (occupied.some(interval => interval.start < end && interval.end > start)) continue;
      starts.add(minute);
    }
  }
  return [...starts].sort((a, b) => a - b).map(minute =>
    String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0"));
}
