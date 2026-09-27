/**
 * Current-time indicator + day-view initial scroll helpers.
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

export function clampScrollTop(
  scrollTop: number,
  maxScroll: number,
): number {
  if (!Number.isFinite(scrollTop) || scrollTop < 0) return 0;
  if (!Number.isFinite(maxScroll) || maxScroll <= 0) return 0;
  return Math.min(scrollTop, maxScroll);
}

/**
 * Legacy helper — prefer resolveDayViewScrollTop for day grid.
 */
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

export interface DayViewScrollInput {
  now: Date | null;
  isToday: boolean;
  /** Absolute minutes from midnight for relevant appointment starts (day, visible staff) */
  appointmentStartMinutes: number[];
  visibleStartMinutes: number;
  visibleEndMinutes: number;
  slotMinutes: number;
  slotPx: number;
  /** Sticky staff header height inside the scroll container */
  stickyHeaderPx: number;
  /** Visible body height of the scroll container */
  viewportPx: number;
  /** Keep this many minutes of context above the target (default 45) */
  contextBufferMinutes?: number;
  /** Fraction of viewport where "now" should sit (default 0.35) */
  nowViewportFraction?: number;
}

/**
 * Initial Day View scroll that keeps current time near ~35% viewport
 * while not hiding the top of a nearby relevant appointment under the sticky header.
 */
export function resolveDayViewScrollTop(input: DayViewScrollInput): number {
  const {
    now,
    isToday,
    appointmentStartMinutes,
    visibleStartMinutes,
    visibleEndMinutes,
    slotMinutes,
    slotPx,
    stickyHeaderPx,
    viewportPx,
    contextBufferMinutes = 45,
    nowViewportFraction = 0.35,
  } = input;

  const gridHeight =
    ((visibleEndMinutes - visibleStartMinutes) / slotMinutes) * slotPx;
  const maxScroll = Math.max(0, gridHeight - Math.max(viewportPx, 1));

  const toTop = (absoluteMinutes: number) =>
    minutesToGridTopPx(
      absoluteMinutes,
      visibleStartMinutes,
      slotMinutes,
      slotPx,
    );

  let targetTop: number | null = null;

  if (isToday && now) {
    const nowMins = absoluteMinutesFromDate(now);
    if (nowMins >= visibleStartMinutes && nowMins <= visibleEndMinutes) {
      const nowTop = toTop(nowMins);
      // Place now around 30–40% of the viewport below sticky header.
      targetTop =
        nowTop -
        stickyHeaderPx -
        Math.max(viewportPx - stickyHeaderPx, 0) * nowViewportFraction;
    }
  }

  const relevantStarts = appointmentStartMinutes
    .filter(
      (m) => m >= visibleStartMinutes && m <= visibleEndMinutes,
    )
    .sort((a, b) => a - b);

  let appointmentGuardTop: number | null = null;
  // Only guard appointments near "now" (in-progress or next upcoming) —
  // never force scroll back to the day's first appointment when viewing evening.
  if (isToday && now && relevantStarts.length > 0) {
    const nowMins = absoluteMinutesFromDate(now);
    const inProgress = [...relevantStarts]
      .reverse()
      .find((m) => m <= nowMins && nowMins - m <= 180);
    const upcoming = relevantStarts.find((m) => m >= nowMins - 5);
    const focusStart = inProgress ?? upcoming ?? null;
    if (focusStart != null) {
      const buffered = Math.max(
        visibleStartMinutes,
        focusStart - contextBufferMinutes,
      );
      // Ensure appointment top clears sticky header inside the viewport.
      appointmentGuardTop = toTop(buffered) - stickyHeaderPx;
    }
  }

  if (targetTop == null && appointmentGuardTop == null) {
    return 0;
  }
  if (targetTop == null) {
    return clampScrollTop(appointmentGuardTop!, maxScroll);
  }
  if (appointmentGuardTop == null) {
    return clampScrollTop(targetTop, maxScroll);
  }
  // Do not scroll past the appointment guard (would hide appointment top).
  return clampScrollTop(Math.min(targetTop, appointmentGuardTop), maxScroll);
}

export function isTodayYmd(day: Date, now: Date | null): boolean {
  if (!now) return false;
  return formatYmd(day) === formatYmd(now);
}
