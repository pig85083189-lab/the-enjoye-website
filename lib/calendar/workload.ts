/**
 * Calendar workload derivation — from appointments only for counts/hours.
 * Schedule labels come from resolveStaffDayScheduleStatus (separate concept).
 */
import {
  formatYmd,
  type ScheduleAppointment,
} from "@/lib/appointments/domain";
import {
  resolveStaffDayScheduleStatus,
  type StaffDayScheduleKind,
} from "@/lib/calendar/schedule-status";
import { parseHmToMinutes } from "@/lib/staff-schedule/domain";
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
  scheduleKind: StaffDayScheduleKind;
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
}): { count: number; hours: number } {
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

export function buildStaffWorkloadRows(input: {
  staff: StaffMembership[];
  appointments: ScheduleAppointment[];
  from: Date;
  toInclusive: Date;
  organizationId: string;
  locationId: string;
  scheduleDay: Date;
  now?: Date | null;
}): StaffWorkload[] {
  return input.staff.map((s) => {
    const load = computeStaffWorkload({
      staffId: s.userId,
      appointments: input.appointments,
      from: input.from,
      toInclusive: input.toInclusive,
    });
    const schedule = resolveStaffDayScheduleStatus({
      organizationId: input.organizationId,
      locationId: input.locationId,
      staffId: s.userId,
      day: input.scheduleDay,
      now: input.now,
    });
    return {
      staffId: s.userId,
      count: load.count,
      hours: load.hours,
      scheduleKind: schedule.kind,
      workingLabel: schedule.workingLabel,
    };
  });
}

export function formatWorkloadHours(hours: number): string {
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${hours}h`;
}

/** Total workload across all staff in range. */
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
