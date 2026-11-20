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
