/**
 * Calendar staff-day schedule status — derived from Staff Schedule + Time Off.
 * Does NOT invent leave from isWorking:false; 休假 requires APPROVED time off.
 */
import { formatYmd, startOfDay } from "@/lib/appointments/domain";
import {
  dayOfWeekLocal,
  parseHmToMinutes,
  type StaffTimeOff,
  type StaffWorkingHours,
} from "@/lib/staff-schedule/domain";
import {
  getWorkingHoursForDay,
  listTimeOff,
} from "@/lib/staff-schedule/store";
import { absoluteMinutesFromDate } from "@/lib/appointments/visible-range";

export type StaffDayScheduleKind = "working" | "not_scheduled" | "time_off";

export type StaffDutyLabel = "上班中" | "今日有班" | "已下班";

export interface StaffDayScheduleStatus {
  kind: StaffDayScheduleKind;
  /** e.g. "10:00 – 19:00" when working */
  workingLabel: string | null;
  /** Duty chip when viewing today with working hours */
  dutyLabel: StaffDutyLabel | null;
  /**
   * @deprecated Prefer `kind === "time_off"`. Kept for gradual callers.
   * True only for APPROVED time off — never for isWorking:false alone.
   */
  isOnLeave: boolean;
  /** True when no bookable working hours for the day (includes isWorking:false). */
  isNotScheduled: boolean;
  /** Column treats the day as non-working for pattern / empty-slot blocking. */
  isNonWorkingDay: boolean;
}

function dayBounds(day: Date): { start: Date; end: Date } {
  const start = startOfDay(day);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function approvedTimeOffOnDay(
  organizationId: string,
  locationId: string,
  staffId: string,
  day: Date,
): StaffTimeOff[] {
  const { start, end } = dayBounds(day);
  return listTimeOff(organizationId, {
    locationId,
    staffId,
    from: start,
    to: end,
  }).filter((t) => t.status === "APPROVED");
}

function coversFullLocalDay(off: StaffTimeOff, day: Date): boolean {
  const { start, end } = dayBounds(day);
  const offStart = new Date(off.startAt).getTime();
  const offEnd = new Date(off.endAt).getTime();
  return offStart <= start.getTime() && offEnd >= end.getTime();
}

export function resolveDutyLabel(
  hours: StaffWorkingHours,
  day: Date,
  now: Date | null,
): StaffDutyLabel | null {
  if (!hours.isWorking || !now) return null;
  if (formatYmd(day) !== formatYmd(now)) return null;
  const mins = absoluteMinutesFromDate(now);
  const start = parseHmToMinutes(hours.startTime);
  const end = parseHmToMinutes(hours.endTime);
  if (mins < start) return "今日有班";
  if (mins >= end) return "已下班";
  return "上班中";
}

/**
 * Resolve calendar header / column semantics for one staff × day.
 */
export function resolveStaffDayScheduleStatus(input: {
  organizationId: string;
  locationId: string;
  staffId: string;
  day: Date;
  now?: Date | null;
}): StaffDayScheduleStatus {
  const hours = getWorkingHoursForDay(
    input.organizationId,
    input.locationId,
    input.staffId,
    dayOfWeekLocal(input.day),
  );
  const offs = approvedTimeOffOnDay(
    input.organizationId,
    input.locationId,
    input.staffId,
    input.day,
  );
  const fullDayLeave = offs.some((off) => coversFullLocalDay(off, input.day));
  const hasLeave = offs.length > 0;

  // 休假 only from APPROVED time off (full-day cover, or leave with no working shift).
  if (fullDayLeave || (hasLeave && (!hours || !hours.isWorking))) {
    return {
      kind: "time_off",
      workingLabel: null,
      dutyLabel: null,
      isOnLeave: true,
      isNotScheduled: false,
      isNonWorkingDay: true,
    };
  }

  if (hours?.isWorking) {
    return {
      kind: "working",
      workingLabel: `${hours.startTime} – ${hours.endTime}`,
      dutyLabel: resolveDutyLabel(hours, input.day, input.now ?? null),
      isOnLeave: false,
      isNotScheduled: false,
      isNonWorkingDay: false,
    };
  }

  // Missing hours OR explicit isWorking:false → 未排班 (not 休假)
  return {
    kind: "not_scheduled",
    workingLabel: null,
    dutyLabel: null,
    isOnLeave: false,
    isNotScheduled: true,
    isNonWorkingDay: true,
  };
}

/**
 * Header / subtitle line for a staff × day column.
 * Appointment count is a conflict hint only when not_scheduled.
 */
export function formatStaffDayHeaderMeta(
  status: StaffDayScheduleStatus,
  appointmentCount = 0,
): string {
  if (status.kind === "time_off") return "休假";
  if (status.kind === "not_scheduled") {
    if (appointmentCount > 0) {
      return `未排班 · ${appointmentCount} 筆預約`;
    }
    return "未排班";
  }
  return status.workingLabel ?? "";
}

/** @deprecated Use resolveStaffDayScheduleStatus — maps old isDayOff incorrectly to leave. */
export function resolveStaffDayScheduleLabel(input: {
  organizationId: string;
  locationId: string;
  staffId: string;
  day: Date;
}): { isDayOff: boolean; workingLabel: string | null } {
  const status = resolveStaffDayScheduleStatus(input);
  return {
    // Legacy field: true for any non-working day (leave OR not scheduled)
    isDayOff: status.isNonWorkingDay,
    workingLabel: status.workingLabel,
  };
}
