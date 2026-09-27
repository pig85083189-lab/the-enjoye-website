/**
 * Current-time indicator helpers for calendar grids.
 */
import { formatYmd } from "@/lib/appointments/domain";
import { absoluteMinutesFromDate } from "@/lib/appointments/visible-range";
import { minutesToGridTopPx } from "@/lib/calendar/workload";

export function shouldShowNowLine(day: Date, now: Date | null): boolean {
  if (!now) return false;
  return formatYmd(day) === formatYmd(now);
}

export function nowLineTopPx(input: {
  now: Date;
  visibleStartMinutes: number;
  visibleEndMinutes: number;
  slotMinutes: number;
  slotPx: number;
}): number | null {
  const mins = absoluteMinutesFromDate(input.now);
  if (mins < input.visibleStartMinutes || mins > input.visibleEndMinutes) {
    return null;
  }
  return minutesToGridTopPx(
    mins,
    input.visibleStartMinutes,
    input.slotMinutes,
    input.slotPx,
  );
}

export function formatNowHm(now: Date): string {
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function scrollOffsetForNow(input: {
  now: Date;
  visibleStartMinutes: number;
  slotMinutes: number;
  slotPx: number;
  /** Prefer showing this many px above the now line */
  paddingAbovePx?: number;
}): number {
  const top = minutesToGridTopPx(
    absoluteMinutesFromDate(input.now),
    input.visibleStartMinutes,
    input.slotMinutes,
    input.slotPx,
  );
  return Math.max(0, top - (input.paddingAbovePx ?? 120));
}

export function isTodayYmd(day: Date, now: Date | null): boolean {
  if (!now) return false;
  return formatYmd(day) === formatYmd(now);
}
