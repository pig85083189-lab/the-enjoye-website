/**
 * Report date-range helpers — browser local timezone (documented).
 */
import {
  endOfDay,
  formatYmd,
  startOfDay,
} from "@/lib/appointments/domain";
import type { ReportDateRange, ReportPreset } from "./domain";

export function resolveReportPreset(
  preset: ReportPreset,
  now: Date = new Date(),
  custom?: { startYmd: string; endYmd: string },
): ReportDateRange {
  if (preset === "custom" && custom) {
    const [ys, ms, ds] = custom.startYmd.split("-").map(Number);
    const [ye, me, de] = custom.endYmd.split("-").map(Number);
    let start = startOfDay(new Date(ys, (ms ?? 1) - 1, ds ?? 1));
    let end = endOfDay(new Date(ye, (me ?? 1) - 1, de ?? 1));
    if (end.getTime() < start.getTime()) {
      const tmp = start;
      start = startOfDay(end);
      end = endOfDay(tmp);
    }
    return { startAt: start, endAt: end };
  }

  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  if (preset === "today") {
    return { startAt: todayStart, endAt: todayEnd };
  }

  if (preset === "week") {
    // Monday-start local week containing `now`
    const day = todayStart.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() + diff);
    return { startAt: startOfDay(weekStart), endAt: todayEnd };
  }

  // month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return { startAt: monthStart, endAt: todayEnd };
}

export function isInstantInRange(
  isoOrDate: string | Date,
  range: ReportDateRange,
): boolean {
  const t = isoOrDate instanceof Date ? isoOrDate.getTime() : new Date(isoOrDate).getTime();
  if (Number.isNaN(t)) return false;
  return t >= range.startAt.getTime() && t <= range.endAt.getTime();
}

export function eachLocalDayYmd(range: ReportDateRange): string[] {
  const days: string[] = [];
  const cursor = startOfDay(range.startAt);
  const last = startOfDay(range.endAt);
  while (cursor.getTime() <= last.getTime()) {
    days.push(formatYmd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** Previous window used only for derived comparison — never persisted. */
export function previousPeriodRange(
  preset: ReportPreset,
  current: ReportDateRange,
  now: Date = new Date(),
): ReportDateRange {
  if (preset === "today") {
    const previous = new Date(startOfDay(now));
    previous.setDate(previous.getDate() - 1);
    return { startAt: startOfDay(previous), endAt: endOfDay(previous) };
  }
  if (preset === "week") {
    const weekStart = startOfDay(current.startAt);
    const prevStart = new Date(weekStart);
    prevStart.setDate(prevStart.getDate() - 7);
    const prevEnd = new Date(weekStart);
    prevEnd.setDate(prevEnd.getDate() - 1);
    return { startAt: startOfDay(prevStart), endAt: endOfDay(prevEnd) };
  }
  if (preset === "month") {
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const prevMonthStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), 1);
    return { startAt: startOfDay(prevMonthStart), endAt: endOfDay(prevMonthEnd) };
  }
  const durationMs = Math.max(0, current.endAt.getTime() - current.startAt.getTime());
  const prevEnd = new Date(current.startAt.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { startAt: prevStart, endAt: prevEnd };
}

export function safeRate(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(denominator) || denominator <= 0) return 0;
  if (!Number.isFinite(numerator)) return 0;
  return numerator / denominator;
}
