/**
 * Phase 1C-5C Appointment remote read pilot.
 *
 * Client / test import only. Server Components must use
 * appointment-remote-read-flag.ts so the adapter graph stays out of the
 * RSC customer page module.
 *
 * Scoped to Customer 360 Appointments tab. Does not enable
 * BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Preview activation: BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT=1
 * Production default is off until that env is set.
 * Today and Calendar stay on their own independent pilot flags.
 */

import type { ScheduleAppointment } from "@/lib/appointments/domain";
import { AppointmentRemoteAdapter } from "@/lib/persistence/appointment-remote-adapter";
import {
  AuthenticatedAppointmentReadStore,
} from "@/lib/persistence/authenticated-appointment-read-store";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";

export {
  APPOINTMENT_REMOTE_READ_PILOT_ENV,
  isAppointmentRemoteReadPilotEnabled,
} from "./appointment-remote-read-flag";

export {
  AppointmentRemoteReadOnlyError,
  APPOINTMENT_REMOTE_READ_ONLY_MESSAGE,
} from "@/lib/persistence/authenticated-appointment-read-store";

export async function createAuthenticatedAppointmentReadPersistence(
  client: IdentitySupabaseClient,
  organizationAppId?: string | null,
) {
  const identity = await loadAuthenticatedIdentityCatalog(client, organizationAppId);
  return {
    identity,
    appointments: new AppointmentRemoteAdapter(
      identity.mapper,
      new AuthenticatedAppointmentReadStore(client),
    ),
  };
}

export async function listRemotePilotAppointmentsByCustomer(
  organizationId: string,
  customerId: string,
  client: IdentitySupabaseClient,
): Promise<ScheduleAppointment[]> {
  const persistence = await createAuthenticatedAppointmentReadPersistence(
    client,
    organizationId,
  );
  return persistence.appointments.listByCustomerId(organizationId, customerId);
}

export async function getRemotePilotAppointment(
  organizationId: string,
  appointmentId: string,
  client: IdentitySupabaseClient,
): Promise<ScheduleAppointment | undefined> {
  const persistence = await createAuthenticatedAppointmentReadPersistence(
    client,
    organizationId,
  );
  return persistence.appointments.get(organizationId, appointmentId);
}
