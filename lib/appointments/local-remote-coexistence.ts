import { hasAppointmentConflict, type ScheduleAppointment } from "@/lib/appointments/domain";

/**
 * Read-only union of browser appointments and Supabase appointments.
 * Dedupes only an exact organization and appointment identity.
 * Names, phones, and nearby times are never match keys.
 * This module does not write localStorage or Supabase.
 */

export interface AppointmentCoexistenceRecord {
  id: string;
  organizationId: string;
  locationId: string;
  customerId: string;
  staffId: string;
  serviceId: string;
  startAt: string;
  endAt: string;
  status: string;
}

export interface LocalRemoteConflict<T> {
  local: T;
  remote: T;
}

export interface LocalRemoteCoexistence<T> {
  records: T[];
  conflicts: LocalRemoteConflict<T>[];
  remoteIncluded: boolean;
}

export function combineLocalAndRemoteAppointments<T extends AppointmentCoexistenceRecord>(input: {
  remoteReadEnabled: boolean;
  remoteReady: boolean;
  localAppointments: readonly T[];
  remoteAppointments: readonly T[];
}): LocalRemoteCoexistence<T> {
  if (!input.remoteReadEnabled || !input.remoteReady) {
    return {
      records: [...input.localAppointments],
      conflicts: [],
      remoteIncluded: false,
    };
  }

  const remoteByIdentity = new Map<string, T>();
  for (const remote of input.remoteAppointments) {
    remoteByIdentity.set(appointmentIdentityKey(remote), remote);
  }

  const conflicts: LocalRemoteConflict<T>[] = [];
  const localOnly: T[] = [];
  for (const local of input.localAppointments) {
    const remote = remoteByIdentity.get(appointmentIdentityKey(local));
    if (!remote) {
      localOnly.push(local);
      continue;
    }
    if (sameAppointmentIdentity(local, remote)) continue;
    conflicts.push({ local, remote });
    localOnly.push(local);
  }

  return {
    records: [...input.remoteAppointments, ...localOnly],
    conflicts,
    remoteIncluded: true,
  };
}

function appointmentIdentityKey(appointment: AppointmentCoexistenceRecord): string {
  return `${appointment.organizationId}\0${appointment.id}`;
}

export const LOCAL_REMOTE_WRITE_STOPPED_MESSAGE =
  "本機與正式資料的身分或內容不一致，已停止寫入並保留兩邊原始資料。";

export function identityConflictForId<T extends { id: string }>(
  conflicts: readonly LocalRemoteConflict<T>[],
  id: string,
): LocalRemoteConflict<T> | undefined {
  return conflicts.find((item) => item.local.id === id || item.remote.id === id);
}

/** Same-browser guard only. The database exclusion constraint cannot see these rows. */
export function persistedLocalAppointmentOverlap(input: {
  staffId: string;
  startAt: string;
  endAt: string;
  localAppointments: readonly AppointmentCoexistenceRecord[];
}): AppointmentCoexistenceRecord | undefined {
  return hasAppointmentConflict(
    {
      id: "__remote_create_candidate__",
      staffId: input.staffId,
      startAt: input.startAt,
      endAt: input.endAt,
      status: "BOOKED",
    },
    input.localAppointments as readonly ScheduleAppointment[] as ScheduleAppointment[],
  );
}

export function remoteCheckoutBlockedByLocalAppointment(input: {
  localAppointment: AppointmentCoexistenceRecord | null;
  remoteCustomerId?: string;
  remoteLocationId?: string;
  remoteStaffId?: string;
  remoteServiceId?: string;
  remoteStartAt?: string;
}): boolean {
  const local = input.localAppointment;
  if (!local) return false;
  if (!input.remoteCustomerId || !input.remoteLocationId || !input.remoteStaffId || !input.remoteServiceId || !input.remoteStartAt) {
    return true;
  }
  return local.customerId !== input.remoteCustomerId
    || local.locationId !== input.remoteLocationId
    || local.staffId !== input.remoteStaffId
    || local.serviceId !== input.remoteServiceId
    || !sameInstant(local.startAt, input.remoteStartAt);
}

function sameInstant(left: string, right: string): boolean {
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return Number.isFinite(a) && a === b;
}

function sameAppointmentIdentity(
  local: AppointmentCoexistenceRecord,
  remote: AppointmentCoexistenceRecord,
): boolean {
  return local.organizationId === remote.organizationId
    && local.id === remote.id
    && local.locationId === remote.locationId
    && local.customerId === remote.customerId
    && local.staffId === remote.staffId
    && local.serviceId === remote.serviceId
    && local.startAt === remote.startAt
    && local.endAt === remote.endAt
    && local.status === remote.status;
}
