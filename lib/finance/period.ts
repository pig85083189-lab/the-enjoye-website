/**
 * Finance period helpers. Calendar days are Asia/Taipei business dates.
 */
import { utcIsoToTaipeiLocal } from "@/lib/persistence/appointment-time";
import type { FinanceDateRange, FinancePeriodKind } from "./domain";
import { FINANCE_DISPLAY_TIMEZONE } from "./domain";

export type { FinanceDateRange, FinancePeriodKind };

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function taipeiYmdFromInstant(instant: Date | string): string {
  const iso = instant instanceof Date ? instant.toISOString() : instant;
  return utcIsoToTaipeiLocal(iso).dateYmd;
}

export function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const match = YMD.exec(ymd.trim());
  if (!match) throw new Error(`Invalid YMD ${JSON.stringify(ymd)}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function ymdFromParts(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function utcNoonFromYmd(ymd: string): Date {
  const { y, m, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function addDaysYmd(ymd: string, days: number): string {
  const date = utcNoonFromYmd(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return ymdFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function weekdayMonday0(ymd: string): number {
  const date = utcNoonFromYmd(ymd);
  const day = date.getUTCDay();
  return day === 0 ? 6 : day - 1;
}

export function compareYmd(a: string, b: string): number {
  return a.localeCompare(b);
}

export function isYmdInRange(ymd: string, range: FinanceDateRange): boolean {
  return compareYmd(ymd, range.startYmd) >= 0 && compareYmd(ymd, range.endYmd) <= 0;
}

export function eachYmd(range: FinanceDateRange): string[] {
  const days: string[] = [];
  let cursor = range.startYmd;
  while (compareYmd(cursor, range.endYmd) <= 0) {
    days.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  return days;
}

export function monthRangeContaining(ymd: string): FinanceDateRange {
  const { y, m } = parseYmd(ymd);
  const startYmd = ymdFromParts(y, m, 1);
  const nextMonth = m === 12 ? ymdFromParts(y + 1, 1, 1) : ymdFromParts(y, m + 1, 1);
  return { startYmd, endYmd: addDaysYmd(nextMonth, -1) };
}

export function weekRangeContaining(ymd: string): FinanceDateRange {
  const mondayOffset = weekdayMonday0(ymd);
  const startYmd = addDaysYmd(ymd, -mondayOffset);
  return { startYmd, endYmd: addDaysYmd(startYmd, 6) };
}

export function dayRange(ymd: string): FinanceDateRange {
  return { startYmd: ymd, endYmd: ymd };
}

export function previousPeriodRange(
  kind: FinancePeriodKind,
  current: FinanceDateRange,
): FinanceDateRange {
  if (kind === "day") {
    const prev = addDaysYmd(current.startYmd, -1);
    return { startYmd: prev, endYmd: prev };
  }
  if (kind === "week") {
    return {
      startYmd: addDaysYmd(current.startYmd, -7),
      endYmd: addDaysYmd(current.endYmd, -7),
    };
  }
  if (kind === "month") {
    const { y, m } = parseYmd(current.startYmd);
    const prevMonth = m === 1 ? ymdFromParts(y - 1, 12, 1) : ymdFromParts(y, m - 1, 1);
    return monthRangeContaining(prevMonth);
  }
  const days = eachYmd(current).length;
  return {
    startYmd: addDaysYmd(current.startYmd, -days),
    endYmd: addDaysYmd(current.startYmd, -1),
  };
}

export function shiftPeriod(
  kind: FinancePeriodKind,
  current: FinanceDateRange,
  direction: -1 | 1,
): FinanceDateRange {
  if (kind === "day") {
    const ymd = addDaysYmd(current.startYmd, direction);
    return dayRange(ymd);
  }
  if (kind === "week") {
    const ymd = addDaysYmd(current.startYmd, direction * 7);
    return weekRangeContaining(ymd);
  }
  if (kind === "month") {
    const { y, m } = parseYmd(current.startYmd);
    const nextM = m + direction;
    const ymd =
      nextM < 1
        ? ymdFromParts(y - 1, 12, 1)
        : nextM > 12
          ? ymdFromParts(y + 1, 1, 1)
          : ymdFromParts(y, nextM, 1);
    return monthRangeContaining(ymd);
  }
  const days = eachYmd(current).length;
  return {
    startYmd: addDaysYmd(current.startYmd, direction * days),
    endYmd: addDaysYmd(current.endYmd, direction * days),
  };
}

export function resolveFinancePeriod(
  kind: FinancePeriodKind,
  anchorYmd: string,
  custom?: FinanceDateRange,
): FinanceDateRange {
  if (kind === "custom" && custom) {
    return compareYmd(custom.startYmd, custom.endYmd) <= 0
      ? custom
      : { startYmd: custom.endYmd, endYmd: custom.startYmd };
  }
  if (kind === "day") return dayRange(anchorYmd);
  if (kind === "week") return weekRangeContaining(anchorYmd);
  return monthRangeContaining(anchorYmd);
}

export function formatPeriodHeading(
  kind: FinancePeriodKind,
  range: FinanceDateRange,
): string {
  const start = parseYmd(range.startYmd);
  if (kind === "month") return `${start.y}年${start.m}月`;
  if (kind === "day") return `${start.y}年${start.m}月${start.d}日`;
  const end = parseYmd(range.endYmd);
  if (start.y === end.y && start.m === end.m) {
    return `${start.y}年${start.m}月${start.d}–${end.d}日`;
  }
  return `${start.y}/${pad2(start.m)}/${pad2(start.d)}–${end.y}/${pad2(end.m)}/${pad2(end.d)}`;
}

export function formatShortYmd(ymd: string): string {
  const { m, d } = parseYmd(ymd);
  return `${pad2(m)}/${pad2(d)}`;
}

export function formatMonthHeading(ymd: string): string {
  const { y, m } = parseYmd(ymd);
  return `${y}年${m}月`;
}

export { FINANCE_DISPLAY_TIMEZONE };
