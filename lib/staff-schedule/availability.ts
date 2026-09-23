import {
  hasAppointmentConflict,
  rangesOverlap,
  type ScheduleAppointment,
} from "@/lib/appointments/domain";
import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import {
  AVAILABILITY_REASON_LABEL,
  dayOfWeekLocal,
  parseHmToMinutes,
  type AvailabilityReasonCode,
  type AvailabilityResult,
} from "./domain";
import { canReceiveAppointments, staffCanPerformService } from "./capability";
import {
  getWorkingHoursForDay,
  listBookableStaff,
  listBreaks,
  listTimeOff,
} from "./store";

export interface AvailabilityQuery {
  organizationId: string;
  locationId: string;
  staffId: string;
  startAt: string;
  endAt: string;
  /** Exclude this appointment when editing */
  ignoreAppointmentId?: string;
  serviceId?: string;
  /**
   * Existing appointments for conflict checks.
   * Caller supplies to avoid circular imports with appointment store.
   */
  appointments: ScheduleAppointment[];
}

/**
 * Statuses that block staff availability (occupy the slot).
 * CANCELLED / NO_SHOW do not block.
 * DRAFT counts as a hold (documented product choice).
 * COMPLETED is historical occupancy — still overlaps if times collide in prototype.
 */
const BLOCKING_STATUSES = new Set([
  "DRAFT",
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "IN_SERVICE",
  "COMPLETED",
]);

export function getStaffAvailability(query: AvailabilityQuery): AvailabilityResult {
  const {
    organizationId,
    locationId,
    staffId,
    startAt,
    endAt,
    ignoreAppointmentId,
    serviceId,
    appointments: allAppointments,
  } = query;

  const reasons: AvailabilityReasonCode[] = [];
  const details: string[] = [];
  let conflictingAppointmentId: string | undefined;

  const membership = SEED_MEMBERSHIPS.find(
    (m) => m.organizationId === organizationId && m.userId === staffId,
  );
  if (!membership || !membership.isActive) {
    return {
      available: false,
      reasons: ["STAFF_NOT_FOUND"],
      details: [AVAILABILITY_REASON_LABEL.STAFF_NOT_FOUND],
    };
  }
  if (!canReceiveAppointments(membership)) {
    reasons.push("NOT_BOOKABLE");
    details.push(AVAILABILITY_REASON_LABEL.NOT_BOOKABLE);
  }
  if (membership.locationIds.length > 0 && !membership.locationIds.includes(locationId)) {
    reasons.push("LOCATION_DENIED");
    details.push(AVAILABILITY_REASON_LABEL.LOCATION_DENIED);
  }
  if (serviceId && !staffCanPerformService(organizationId, staffId, serviceId)) {
    reasons.push("NOT_BOOKABLE");
    details.push("美容師尚未具備此服務能力");
  }

  const dow = dayOfWeekLocal(startAt);
  const hours = getWorkingHoursForDay(organizationId, locationId, staffId, dow);
  if (!hours || !hours.isWorking) {
    reasons.push("OUTSIDE_WORKING_HOURS");
    details.push(`${membership.displayName}：${AVAILABILITY_REASON_LABEL.OUTSIDE_WORKING_HOURS}`);
  } else {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();
    const workStart = parseHmToMinutes(hours.startTime);
    const workEnd = parseHmToMinutes(hours.endTime);
    if (startMin < workStart || endMin > workEnd) {
      reasons.push("OUTSIDE_WORKING_HOURS");
      details.push(
        `${membership.displayName}工作時間 ${hours.startTime}–${hours.endTime}`,
      );
    }
  }

  const dayStart = new Date(startAt);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(startAt);
  dayEnd.setHours(23, 59, 59, 999);

  const breaks = listBreaks(organizationId, {
    locationId,
    staffId,
    from: dayStart,
    to: dayEnd,
  });
  for (const br of breaks) {
    if (rangesOverlap(startAt, endAt, br.startAt, br.endAt)) {
      reasons.push("BREAK");
      details.push(
        `${membership.displayName}休息 ${br.label ?? ""}`.trim() +
          `（${new Date(br.startAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false })}–${new Date(br.endAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false })}）`,
      );
    }
  }

  const offs = listTimeOff(organizationId, {
    locationId,
    staffId,
    from: dayStart,
    to: dayEnd,
  }).filter((item) => item.status === "APPROVED");
  for (const off of offs) {
    if (rangesOverlap(startAt, endAt, off.startAt, off.endAt)) {
      reasons.push("TIME_OFF");
      details.push(
        `${membership.displayName}休假${off.reason ? `：${off.reason}` : ""}`,
      );
    }
  }

  const appointments = allAppointments.filter(
    (item) =>
      item.organizationId === organizationId &&
      item.staffId === staffId &&
      BLOCKING_STATUSES.has(item.status),
  );
  const candidate: Pick<ScheduleAppointment, "id" | "staffId" | "startAt" | "endAt" | "status"> = {
    id: ignoreAppointmentId ?? "new",
    staffId,
    startAt,
    endAt,
    status: "BOOKED",
  };
  const hit = hasAppointmentConflict(candidate, appointments);
  if (hit) {
    reasons.push("APPOINTMENT_CONFLICT");
    details.push(
      `${membership.displayName} ${formatRange(hit.startAt, hit.endAt)} 已有其他預約（${hit.customerName}）`,
    );
    conflictingAppointmentId = hit.id;
  }

  const uniqueReasons = Array.from(new Set(reasons));
  return {
    available: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    details,
    conflictingAppointmentId,
  };
}

function formatRange(startAt: string, endAt: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  return `${new Date(startAt).toLocaleTimeString("zh-TW", opts)}–${new Date(endAt).toLocaleTimeString("zh-TW", opts)}`;
}

export function findAvailableStaff(input: {
  organizationId: string;
  locationId: string;
  startAt: string;
  endAt: string;
  serviceId?: string;
  ignoreAppointmentId?: string;
  appointments: ScheduleAppointment[];
}): Array<{ staffId: string; displayName: string; role: string }> {
  const staff = listBookableStaff(input.organizationId, input.locationId);
  return staff
    .filter((m) => {
      const result = getStaffAvailability({
        organizationId: input.organizationId,
        locationId: input.locationId,
        staffId: m.userId,
        startAt: input.startAt,
        endAt: input.endAt,
        serviceId: input.serviceId,
        ignoreAppointmentId: input.ignoreAppointmentId,
        appointments: input.appointments,
      });
      return result.available;
    })
    .map((m) => ({
      staffId: m.userId,
      displayName: m.displayName,
      role: m.role,
    }));
}

export function describeAvailability(result: AvailabilityResult): string {
  if (result.available) return "此時段可預約";
  if (result.details.length > 0) return result.details.join("；");
  return result.reasons.map((r) => AVAILABILITY_REASON_LABEL[r]).join("；");
}
