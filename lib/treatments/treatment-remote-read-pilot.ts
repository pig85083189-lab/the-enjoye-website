/**
 * Phase 1C-6G authenticated Treatment read foundation.
 *
 * Client / test import only. Server Components must use
 * treatment-remote-read-flag.ts so the adapter graph stays out of RSC.
 *
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Live Treatment list / detail / Customer 360 / Today entry use this factory
 * when the Treatment remote-read pilot is on. No service role.
 * No localStorage fallback.
 */

import type { TreatmentDraft } from "@/types/treatment";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import { TreatmentRemoteAdapter } from "@/lib/persistence/treatment-remote-adapter";
import { AppointmentRemoteAdapter } from "@/lib/persistence/appointment-remote-adapter";
import {
  AuthenticatedTreatmentReadStore,
} from "@/lib/persistence/authenticated-treatment-read-store";
import { AuthenticatedAppointmentReadStore } from "@/lib/persistence/authenticated-appointment-read-store";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import { isTreatmentRemoteReadPilotEnabled } from "./treatment-remote-read-flag";

export {
  TREATMENT_REMOTE_READ_PILOT_ENV,
  isTreatmentRemoteReadPilotEnabled,
} from "./treatment-remote-read-flag";

export {
  TreatmentRemoteReadOnlyError,
  TREATMENT_REMOTE_READ_ONLY_MESSAGE,
} from "@/lib/persistence/authenticated-treatment-read-store";

export async function createAuthenticatedTreatmentReadPersistence(
  client: IdentitySupabaseClient,
) {
  const identity = await loadAuthenticatedIdentityCatalog(client);
  return {
    identity,
    treatments: new TreatmentRemoteAdapter(
      identity.mapper,
      new AuthenticatedTreatmentReadStore(client),
      new AuthenticatedAppointmentReadStore(client),
    ),
  };
}

export async function listRemotePilotTreatments(
  organizationId: string,
  client: IdentitySupabaseClient,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<TreatmentDraft[]> {
  if (!isTreatmentRemoteReadPilotEnabled(env)) {
    throw new Error("Treatment remote read pilot is off");
  }
  const persistence = await createAuthenticatedTreatmentReadPersistence(client);
  return persistence.treatments.list(organizationId);
}

export async function listRemotePilotTreatmentsByCustomer(
  organizationId: string,
  customerId: string,
  client: IdentitySupabaseClient,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<TreatmentDraft[]> {
  if (!isTreatmentRemoteReadPilotEnabled(env)) {
    throw new Error("Treatment remote read pilot is off");
  }
  const persistence = await createAuthenticatedTreatmentReadPersistence(client);
  return persistence.treatments.listByCustomerId(organizationId, customerId);
}

export async function getRemotePilotTreatment(
  organizationId: string,
  treatmentId: string,
  client: IdentitySupabaseClient,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<TreatmentDraft | undefined> {
  if (!isTreatmentRemoteReadPilotEnabled(env)) {
    throw new Error("Treatment remote read pilot is off");
  }
  const persistence = await createAuthenticatedTreatmentReadPersistence(client);
  return persistence.treatments.get(organizationId, treatmentId);
}

export async function getRemotePilotTreatmentByAppointment(
  organizationId: string,
  appointmentId: string,
  client: IdentitySupabaseClient,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<TreatmentDraft | undefined> {
  if (!isTreatmentRemoteReadPilotEnabled(env)) {
    throw new Error("Treatment remote read pilot is off");
  }
  const persistence = await createAuthenticatedTreatmentReadPersistence(client);
  return persistence.treatments.getByAppointmentId(organizationId, appointmentId);
}

export async function listRemotePilotAppointmentsForTreatments(
  organizationId: string,
  client: IdentitySupabaseClient,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<ScheduleAppointment[]> {
  if (!isTreatmentRemoteReadPilotEnabled(env)) {
    throw new Error("Treatment remote read pilot is off");
  }
  const identity = await loadAuthenticatedIdentityCatalog(client);
  const appointments = new AppointmentRemoteAdapter(
    identity.mapper,
    new AuthenticatedAppointmentReadStore(client),
  );
  return appointments.list({ organizationId });
}
