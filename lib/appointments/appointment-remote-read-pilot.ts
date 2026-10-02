/**
 * Phase 1C-5C Appointment remote read pilot.
 *
 * Scoped to Customer 360 Appointments tab. Does not enable
 * BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Preview activation: BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT=1
 * Production is always off, even if that env is present.
 * Calendar / Today stay on the local appointment store.
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

export const APPOINTMENT_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT";

export {
  AppointmentRemoteReadOnlyError,
  APPOINTMENT_REMOTE_READ_ONLY_MESSAGE,
} from "@/lib/persistence/authenticated-appointment-read-store";

export function isAppointmentRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  return env[APPOINTMENT_REMOTE_READ_PILOT_ENV] === "1";
}

export async function createAuthenticatedAppointmentReadPersistence(
  client: IdentitySupabaseClient,
) {
  const identity = await loadAuthenticatedIdentityCatalog(client);
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
  const persistence = await createAuthenticatedAppointmentReadPersistence(client);
  return persistence.appointments.listByCustomerId(organizationId, customerId);
}

export async function getRemotePilotAppointment(
  organizationId: string,
  appointmentId: string,
  client: IdentitySupabaseClient,
): Promise<ScheduleAppointment | undefined> {
  const persistence = await createAuthenticatedAppointmentReadPersistence(client);
  return persistence.appointments.get(organizationId, appointmentId);
}
