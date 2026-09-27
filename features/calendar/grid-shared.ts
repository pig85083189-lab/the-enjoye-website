import type { CSSProperties } from "react";
import {
  CALENDAR_DAY_END_HOUR,
  CALENDAR_DAY_START_HOUR,
  CALENDAR_SLOT_MINUTES,
  CALENDAR_SLOT_PX,
} from "@/lib/appointments/calendar-config";
import {
  absoluteMinutesFromDate,
  layoutBlockInVisibleRange,
} from "@/lib/appointments/visible-range";
import type { CanonicalAppointmentStatus } from "@/lib/appointments/domain";

export const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"] as const;
export const DAY_MINUTES_START = CALENDAR_DAY_START_HOUR * 60;
export const DAY_MINUTES_END = CALENDAR_DAY_END_HOUR * 60;
export const TOTAL_SLOTS =
  (DAY_MINUTES_END - DAY_MINUTES_START) / CALENDAR_SLOT_MINUTES;
export const GRID_HEIGHT = TOTAL_SLOTS * CALENDAR_SLOT_PX;
export const TIME_COL_PX = 56;
export const STAFF_FILL_THRESHOLD = 4;
export const STAFF_COL_MIN_PX = 168;
/** Fallback sticky staff-header height when DOM measure is unavailable */
export const STAFF_DAY_HEADER_STICKY_PX = 104;

export function staffGridTemplate(count: number): string {
  if (count <= 0) return `${TIME_COL_PX}px`;
  if (count <= STAFF_FILL_THRESHOLD) {
    return `${TIME_COL_PX}px repeat(${count}, minmax(0, 1fr))`;
  }
  return `${TIME_COL_PX}px repeat(${count}, minmax(${STAFF_COL_MIN_PX}px, 1fr))`;
}

export function staffGridMinWidth(count: number): string | undefined {
  if (count <= STAFF_FILL_THRESHOLD) return undefined;
  return `${TIME_COL_PX + count * STAFF_COL_MIN_PX}px`;
}

export function layoutTimedBlock(start: Date, end: Date) {
  return layoutBlockInVisibleRange({
    startMinutes: absoluteMinutesFromDate(start),
    endMinutes: absoluteMinutesFromDate(end),
    visibleStartMinutes: DAY_MINUTES_START,
    visibleEndMinutes: DAY_MINUTES_END,
    slotMinutes: CALENDAR_SLOT_MINUTES,
    slotPx: CALENDAR_SLOT_PX,
  });
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

/** Left accent — muted rose / sage, never high-saturation */
export const STATUS_ACCENT: Record<CanonicalAppointmentStatus, string> = {
  DRAFT: "bg-[#C4B4B0]",
  BOOKED: "bg-[#C9797D]",
  CONFIRMED: "bg-[#C9797D]",
  ARRIVED: "bg-[#B9686C]",
  IN_SERVICE: "bg-[#B15B5B]",
  COMPLETED: "bg-[#6A8F74]",
  CANCELLED: "bg-[#B0A8A6]",
  NO_SHOW: "bg-[#B07A4A]",
};

/** Appointment fill — enough contrast vs white calendar, still low chroma */
export const STATUS_BLOCK_BG: Record<CanonicalAppointmentStatus, string> = {
  DRAFT: "bg-[#F7F4F2]",
  BOOKED: "bg-[#F8ECEB]",
  CONFIRMED: "bg-[#F5E8E6]",
  ARRIVED: "bg-[#F2E2E0]",
  IN_SERVICE: "bg-[#EFD9D7]",
  COMPLETED: "bg-[#E9F1EC]",
  CANCELLED: "bg-[#F2F0EF] opacity-65",
  NO_SHOW: "bg-[#F4EBE3] opacity-80",
};

/** Off-hours / not working — readable diagonal wash */
export const OFF_HOURS_STYLE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(48,43,43,0.045) 6px, rgba(48,43,43,0.045) 12px)",
  backgroundColor: "rgba(48, 43, 43, 0.045)",
};

export const BREAK_STYLE: CSSProperties = {
  backgroundColor: "#F4EDE4",
};

export const TIME_OFF_STYLE: CSSProperties = {
  backgroundColor: "#ECEAE8",
};
