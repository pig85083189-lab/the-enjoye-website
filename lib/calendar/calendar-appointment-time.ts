/**
 * Calendar presentation time helpers for the remote appointment read pilot.
 * Converts canonical ScheduleAppointment timestamptz values into Taipei
 * business-day windows and grid minutes. Not a second appointment domain.
 */

import {
  CALENDAR_DAY_END_HOUR,
  CALENDAR_DAY_START_HOUR,
  CALENDAR_SLOT_MINUTES,
  CALENDAR_SLOT_PX,
} from "@/lib/appointments/calendar-config";
import {
  absoluteMinutesFromDate,
  layoutBlockInVisibleRange,
  type VisibleRangeLayout,
} from "@/lib/appointments/visible-range";
import {
  addMinutesToIso,
  formatTaipeiAppointmentDisplay,
  taipeiLocalToUtcIso,
  utcIsoToTaipeiLocal,
} from "@/lib/persistence/appointment-time";

const DAY_MINUTES_START = CALENDAR_DAY_START_HOUR * 60;
const DAY_MINUTES_END = CALENDAR_DAY_END_HOUR * 60;

export function absoluteTaipeiMinutesFromIso(iso: string): number {
  const { hm } = utcIsoToTaipeiLocal(iso);
  const [hours, minutes] = hm.split(":").map(Number);
  return hours * 60 + minutes;
}

export function calendarAppointmentYmd(iso: string, useTaipeiTime: boolean): string {
  if (useTaipeiTime) return utcIsoToTaipeiLocal(iso).dateYmd;
  const date = new Date(iso);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function calendarAppointmentHm(iso: string, useTaipeiTime: boolean): string {
  if (useTaipeiTime) return utcIsoToTaipeiLocal(iso).hm;
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function layoutCalendarAppointmentBlock(
  startAt: string,
  endAt: string,
  useTaipeiTime: boolean,
): VisibleRangeLayout {
  const startMinutes = useTaipeiTime
    ? absoluteTaipeiMinutesFromIso(startAt)
    : absoluteMinutesFromDate(new Date(startAt));
  const endMinutes = useTaipeiTime
    ? absoluteTaipeiMinutesFromIso(endAt)
    : absoluteMinutesFromDate(new Date(endAt));
  return layoutBlockInVisibleRange({
    startMinutes,
    endMinutes,
    visibleStartMinutes: DAY_MINUTES_START,
    visibleEndMinutes: DAY_MINUTES_END,
    slotMinutes: CALENDAR_SLOT_MINUTES,
    slotPx: CALENDAR_SLOT_PX,
  });
}

export function taipeiDayRangeUtc(dateYmd: string): { startsAt: string; endsAt: string } {
  const startsAt = taipeiLocalToUtcIso(dateYmd, "00:00");
  return {
    startsAt,
    endsAt: addMinutesToIso(startsAt, 24 * 60),
  };
}

export function taipeiWeekRangeUtc(weekStartYmd: string): { startsAt: string; endsAt: string } {
  const startsAt = taipeiLocalToUtcIso(weekStartYmd, "00:00");
  return {
    startsAt,
    endsAt: addMinutesToIso(startsAt, 7 * 24 * 60),
  };
}

export function calendarViewRangeUtc(input: {
  view: "day" | "week";
  dayYmd: string;
  weekStartYmd: string;
}): { startsAt: string; endsAt: string } {
  return input.view === "week"
    ? taipeiWeekRangeUtc(input.weekStartYmd)
    : taipeiDayRangeUtc(input.dayYmd);
}

export function formatCalendarAppointmentDisplay(
  startAt: string,
  endAt: string,
  useTaipeiTime: boolean,
): { date: string; time: string } {
  if (useTaipeiTime) return formatTaipeiAppointmentDisplay(startAt, endAt);
  const start = new Date(startAt);
  const date = `${start.getFullYear()}/${String(start.getMonth() + 1).padStart(2, "0")}/${String(start.getDate()).padStart(2, "0")}`;
  return {
    date,
    time: `${calendarAppointmentHm(startAt, false)}–${calendarAppointmentHm(endAt, false)}`,
  };
}
