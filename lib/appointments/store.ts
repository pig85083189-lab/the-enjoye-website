import type { Appointment } from "@/types";
import { getAppointmentsForOrganization } from "@/data/mock-appointments";
import { getCustomerById } from "@/data/mock-customers";
import { getServiceById } from "@/data/mock-services";
import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import { canAccessLocation } from "@/lib/tenant/access";
import { getScheduleAppointmentsKey, getTenantStorageKey } from "@/lib/tenant/storage-keys";
import { migrateLegacyTenantStorage } from "@/lib/tenant/migration";
import { newId } from "@/lib/repositories/storage";
import { DEFAULT_SERVICE_DURATION_MINUTES } from "./calendar-config";
import {
  anchorTimeOnDay,
  assertTransition,
  durationBetween,
  hasAppointmentConflict,
  isSameLocalDay,
  normalizeAppointmentStatus,
  type CanonicalAppointmentStatus,
  type ScheduleAppointment,
} from "./domain";
import { describeAvailability, getStaffAvailability } from "@/lib/staff-schedule/availability";
import { listBookableStaff } from "@/lib/staff-schedule/store";

export interface AppointmentListQuery {
  organizationId: string;
  locationId?: string;
  from?: Date;
  to?: Date;
  staffId?: string;
  customerId?: string;
  status?: CanonicalAppointmentStatus;
}

export interface CreateAppointmentInput {
  locationId: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  startAt: string;
  endAt: string;
  customerNote?: string;
  internalNote?: string;
  createdBy?: string;
  /** Explicit overlap override */
  allowConflict?: boolean;
}

function readStatusMap(organizationId: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  migrateLegacyTenantStorage(organizationId);
  try {
    const raw = localStorage.getItem(getTenantStorageKey(organizationId, "appointment-status"));
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function emitChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("enjoye-appointment-change"));
}

function readOverrides(organizationId: string): ScheduleAppointment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getScheduleAppointmentsKey(organizationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScheduleAppointment[];
    return parsed.filter((item) => item.organizationId === organizationId);
  } catch {
    return [];
  }
}

function writeOverrides(organizationId: string, list: ScheduleAppointment[]): void {
  if (typeof window === "undefined") return;
  const scoped = list.filter((item) => item.organizationId === organizationId);
  localStorage.setItem(getScheduleAppointmentsKey(organizationId), JSON.stringify(scoped));
  emitChange();
}

function seedToSchedule(item: Appointment, day: Date): ScheduleAppointment {
  const duration = item.durationMinutes || DEFAULT_SERVICE_DURATION_MINUTES;
  const { startAt, endAt } = anchorTimeOnDay(item.time, day, duration);
  const now = new Date().toISOString();
  return {
    id: item.id,
    organizationId: item.organizationId,
    locationId: item.locationId ?? "",
    customerId: item.customerId,
    customerName: item.customerName,
    serviceId: item.serviceId,
    serviceName: item.serviceName,
    staffId: item.staffId,
    staffName: item.staffName,
    startAt,
    endAt,
    durationMinutes: duration,
    status: normalizeAppointmentStatus(item.status),
    notes: item.notes ?? [],
    membership: item.membership,
    remainingSessions: undefined, // legacy seed field — not canonical package balance
    internalNote: item.notes?.[0],
    createdAt: now,
    updatedAt: now,
  };
}

/** Merged seed + persisted overrides + legacy status map. organizationId required. */
export function listAppointments(
  query: AppointmentListQuery,
  anchorDay: Date = new Date(),
): ScheduleAppointment[] {
  const seeds = getAppointmentsForOrganization(query.organizationId)
    .filter((item) => item.organizationId === query.organizationId)
    .map((item) => seedToSchedule(item, anchorDay));

  const overrides = readOverrides(query.organizationId);
  const overrideIds = new Set(overrides.map((item) => item.id));
  const statusMap = readStatusMap(query.organizationId);

  const byId = new Map<string, ScheduleAppointment>();
  for (const seed of seeds) {
    const legacy = statusMap[seed.id];
    byId.set(seed.id, legacy ? { ...seed, status: normalizeAppointmentStatus(legacy) } : seed);
  }
  for (const saved of overrides) {
    byId.set(saved.id, saved);
  }

  let list = Array.from(byId.values()).filter(
    (item) => item.organizationId === query.organizationId && item.locationId,
  );

  if (query.locationId) list = list.filter((item) => item.locationId === query.locationId);
  if (query.staffId) list = list.filter((item) => item.staffId === query.staffId);
  if (query.customerId) list = list.filter((item) => item.customerId === query.customerId);
  if (query.status) list = list.filter((item) => item.status === query.status);
  if (query.from || query.to) {
    const from = query.from?.getTime() ?? Number.NEGATIVE_INFINITY;
    const to = query.to?.getTime() ?? Number.POSITIVE_INFINITY;
    list = list.filter((item) => {
      const t = new Date(item.startAt).getTime();
      return t >= from && t <= to;
    });
  }

  // status map must not override persisted records
  void overrideIds;
  return list.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export function getScheduleAppointment(
  organizationId: string,
  appointmentId: string,
): ScheduleAppointment | undefined {
  return listAppointments({ organizationId }).find((item) => item.id === appointmentId);
}

function assertOwnership(organizationId: string, input: CreateAppointmentInput): {
  customerName: string;
  serviceName: string;
  staffName: string;
  membership: ScheduleAppointment["membership"];
} {
  if (!canAccessLocation(organizationId, input.locationId)) {
    throw new Error("Location does not belong to this organization");
  }
  const customer = getCustomerById(input.customerId, organizationId);
  if (!customer || customer.organizationId !== organizationId) {
    throw new Error("Customer does not belong to this organization");
  }
  const service = getServiceById(input.serviceId, organizationId);
  if (!service || service.organizationId !== organizationId) {
    throw new Error("Service does not belong to this organization");
  }
  const membership = SEED_MEMBERSHIPS.find(
    (m) => m.organizationId === organizationId && m.userId === input.staffId && m.isActive,
  );
  if (!membership) {
    throw new Error("Staff membership does not belong to this organization");
  }
  if (membership.locationIds.length > 0 && !membership.locationIds.includes(input.locationId)) {
    throw new Error("Staff cannot operate this location");
  }
  if (!(new Date(input.endAt).getTime() > new Date(input.startAt).getTime())) {
    throw new Error("endAt must be after startAt");
  }
  return {
    customerName: customer.name,
    serviceName: service.name,
    staffName: membership.displayName,
    membership: customer.membership,
  };
}

export function createAppointment(
  organizationId: string,
  input: CreateAppointmentInput,
): ScheduleAppointment {
  const meta = assertOwnership(organizationId, input);
  const now = new Date().toISOString();
  const draft: ScheduleAppointment = {
    id: newId("apt"),
    organizationId,
    locationId: input.locationId,
    customerId: input.customerId,
    customerName: meta.customerName,
    serviceId: input.serviceId,
    serviceName: meta.serviceName,
    staffId: input.staffId,
    staffName: meta.staffName,
    startAt: input.startAt,
    endAt: input.endAt,
    durationMinutes: durationBetween(input.startAt, input.endAt),
    status: "BOOKED",
    customerNote: input.customerNote,
    internalNote: input.internalNote,
    notes: input.internalNote ? [input.internalNote] : [],
    membership: meta.membership,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  const existing = listAppointments({ organizationId });
  const conflict = hasAppointmentConflict(draft, existing);
  if (conflict && !input.allowConflict) {
    throw new Error(`CONFLICT:${conflict.customerName} ${conflict.serviceName}`);
  }
  const availability = getStaffAvailability({
    organizationId,
    locationId: input.locationId,
    staffId: input.staffId,
    startAt: input.startAt,
    endAt: input.endAt,
    appointments: existing,
  });
  if (!availability.available && !input.allowConflict) {
    throw new Error(`UNAVAILABLE:${describeAvailability(availability)}`);
  }
  writeOverrides(organizationId, [draft, ...readOverrides(organizationId)]);
  return draft;
}

export function updateAppointment(
  organizationId: string,
  appointmentId: string,
  patch: Partial<CreateAppointmentInput> & {
    status?: CanonicalAppointmentStatus;
    updatedBy?: string;
  },
): ScheduleAppointment {
  const current = getScheduleAppointment(organizationId, appointmentId);
  if (!current || current.organizationId !== organizationId) {
    throw new Error("Appointment not found");
  }
  const nextInput: CreateAppointmentInput = {
    locationId: patch.locationId ?? current.locationId,
    customerId: patch.customerId ?? current.customerId,
    serviceId: patch.serviceId ?? current.serviceId,
    staffId: patch.staffId ?? current.staffId,
    startAt: patch.startAt ?? current.startAt,
    endAt: patch.endAt ?? current.endAt,
    customerNote: patch.customerNote ?? current.customerNote,
    internalNote: patch.internalNote ?? current.internalNote,
    allowConflict: patch.allowConflict,
  };
  const meta = assertOwnership(organizationId, nextInput);
  const nextStatus = patch.status ?? current.status;
  if (patch.status) assertTransition(current.status, patch.status);

  const next: ScheduleAppointment = {
    ...current,
    ...nextInput,
    organizationId,
    customerName: meta.customerName,
    serviceName: meta.serviceName,
    staffName: meta.staffName,
    durationMinutes: durationBetween(nextInput.startAt, nextInput.endAt),
    status: nextStatus,
    notes: nextInput.internalNote ? [nextInput.internalNote] : current.notes,
    updatedBy: patch.updatedBy,
    updatedAt: new Date().toISOString(),
    cancelledAt:
      nextStatus === "CANCELLED" || nextStatus === "NO_SHOW"
        ? new Date().toISOString()
        : current.cancelledAt,
    cancelledBy:
      nextStatus === "CANCELLED" || nextStatus === "NO_SHOW"
        ? patch.updatedBy
        : current.cancelledBy,
  };

  const conflict = hasAppointmentConflict(next, listAppointments({ organizationId }));
  if (conflict && !patch.allowConflict && patch.startAt) {
    throw new Error(`CONFLICT:${conflict.customerName}`);
  }
  if (patch.startAt || patch.endAt || patch.staffId || patch.locationId) {
    const availability = getStaffAvailability({
      organizationId,
      locationId: next.locationId,
      staffId: next.staffId,
      startAt: next.startAt,
      endAt: next.endAt,
      ignoreAppointmentId: appointmentId,
      appointments: listAppointments({ organizationId }),
    });
    if (!availability.available && !patch.allowConflict) {
      throw new Error(`UNAVAILABLE:${describeAvailability(availability)}`);
    }
  }

  const rest = readOverrides(organizationId).filter((item) => item.id !== appointmentId);
  writeOverrides(organizationId, [next, ...rest]);
  return next;
}

/**
 * Treatment bridge only. Canonical transitions stay in transitionAppointmentStatus.
 * Persists seed-backed appointments into overrides so Calendar/Today stay aligned.
 */
export function applyCompatibilityStatus(
  organizationId: string,
  appointmentId: string,
  status: CanonicalAppointmentStatus,
): void {
  const current = getScheduleAppointment(organizationId, appointmentId);
  if (!current || current.organizationId !== organizationId) return;
  const next: ScheduleAppointment = {
    ...current,
    status,
    updatedAt: new Date().toISOString(),
  };
  const rest = readOverrides(organizationId).filter((item) => item.id !== appointmentId);
  writeOverrides(organizationId, [next, ...rest]);
}

export function transitionAppointmentStatus(
  organizationId: string,
  appointmentId: string,
  nextStatus: CanonicalAppointmentStatus,
  actorId?: string,
): ScheduleAppointment {
  return updateAppointment(organizationId, appointmentId, {
    status: nextStatus,
    updatedBy: actorId,
    allowConflict: true,
  });
}

export function listTodayAppointments(
  organizationId: string,
  locationId: string | undefined,
  day: Date,
): ScheduleAppointment[] {
  return listAppointments({
    organizationId,
    locationId,
    from: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0),
    to: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999),
  }).filter((item) => isSameLocalDay(item.startAt, day));
}

export function staffOptionsForLocation(organizationId: string, locationId: string) {
  return listBookableStaff(organizationId, locationId);
}
