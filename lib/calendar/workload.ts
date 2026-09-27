/**
 * Calendar workload derivation — from appointments + staff schedule; no parallel store.
 */
import {
  formatYmd,
  type ScheduleAppointment,
} from "@/lib/appointments/domain";
import {
  dayOfWeekLocal,
  parseHmToMinutes,
} from "@/lib/staff-schedule/domain";
import { getWorkingHoursForDay } from "@/lib/staff-schedule/store";
import type { StaffMembership } from "@/types/saas";

const WORKLOAD_STATUSES = new Set([
  "DRAFT",
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "IN_SERVICE",
  "COMPLETED",
]);

export interface StaffWorkload {
  staffId: string;
  count: number;
  /** Total appointment duration in hours (1 decimal) */
  hours: number;
  /** True when staff has no working hours for the day */
  isDayOff: boolean;
  workingLabel: string | null;
}

function isInRange(
  item: ScheduleAppointment,
  fromYmd: string,
  toYmdInclusive: string,
): boolean {
  const ymd = formatYmd(new Date(item.startAt));
  return ymd >= fromYmd && ymd <= toYmdInclusive;
}

export function computeStaffWorkload(input: {
  staffId: string;
  appointments: ScheduleAppointment[];
  from: Date;
  toInclusive: Date;
  organizationId?: string;
  locationId?: string;
  dayForSchedule?: Date;
}): Omit<StaffWorkload, "staffId" | "isDayOff" | "workingLabel"> {
  const fromYmd = formatYmd(input.from);
  const toYmd = formatYmd(input.toInclusive);
  const items = input.appointments.filter(
    (a) =>
      a.staffId === input.staffId &&
      WORKLOAD_STATUSES.has(a.status) &&
      isInRange(a, fromYmd, toYmd),
  );
  const minutes = items.reduce((sum, a) => sum + a.durationMinutes, 0);
  return {
    count: items.length,
    hours: Math.round((minutes / 60) * 10) / 10,
  };
}

export function resolveStaffDayScheduleLabel(input: {
  organizationId: string;
  locationId: string;
  staffId: string;
  day: Date;
}): { isDayOff: boolean; workingLabel: string | null } {
  const hours = getWorkingHoursForDay(
    input.organizationId,
    input.locationId,
    input.staffId,
    dayOfWeekLocal(input.day),
  );
  if (!hours || !hours.isWorking) {
    return { isDayOff: true, workingLabel: null };
  }
  return {
    isDayOff: false,
    workingLabel: `${hours.startTime} – ${hours.endTime}`,
  };
}

export function buildStaffWorkloadRows(input: {
  staff: StaffMembership[];
  appointments: ScheduleAppointment[];
  from: Date;
  toInclusive: Date;
  organizationId: string;
  locationId: string;
  /** Day used for working-hours / day-off label (day view = anchor; week = today or week start) */
  scheduleDay: Date;
}): StaffWorkload[] {
  return input.staff.map((s) => {
    const load = computeStaffWorkload({
      staffId: s.userId,
      appointments: input.appointments,
      from: input.from,
      toInclusive: input.toInclusive,
    });
    const schedule = resolveStaffDayScheduleLabel({
      organizationId: input.organizationId,
      locationId: input.locationId,
      staffId: s.userId,
      day: input.scheduleDay,
    });
    return {
      staffId: s.userId,
      count: load.count,
      hours: load.hours,
      isDayOff: schedule.isDayOff,
      workingLabel: schedule.workingLabel,
    };
  });
}

export function formatWorkloadHours(hours: number): string {
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${hours}h`;
}

/** Total workload across all staff in range (dedupe by appointment id). */
export function computeTotalWorkload(
  appointments: ScheduleAppointment[],
  from: Date,
  toInclusive: Date,
): { count: number; hours: number } {
  const fromYmd = formatYmd(from);
  const toYmd = formatYmd(toInclusive);
  const items = appointments.filter(
    (a) => WORKLOAD_STATUSES.has(a.status) && isInRange(a, fromYmd, toYmd),
  );
  const minutes = items.reduce((sum, a) => sum + a.durationMinutes, 0);
  return {
    count: items.length,
    hours: Math.round((minutes / 60) * 10) / 10,
  };
}

export function minutesToGridTopPx(
  absoluteMinutes: number,
  visibleStartMinutes: number,
  slotMinutes: number,
  slotPx: number,
): number {
  return ((absoluteMinutes - visibleStartMinutes) / slotMinutes) * slotPx;
}

export { parseHmToMinutes };
