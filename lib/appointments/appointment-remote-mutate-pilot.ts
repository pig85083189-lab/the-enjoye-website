/**
 * Phase 1C-6D.1 authenticated Appointment mutate foundation.
 *
 * Client / test import only. Server Components must use
 * appointment-remote-mutate-flag.ts so the adapter graph stays out of RSC.
 *
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Does not wire Calendar edit / Cancel / Reschedule / status buttons.
 * No service role. No localStorage fallback. No dual write.
 */

import { AppointmentRemoteAdapter } from "@/lib/persistence/appointment-remote-adapter";
import {
  AuthenticatedAppointmentTableStore,
  type AuthenticatedAppointmentSupabaseClient,
} from "@/lib/persistence/authenticated-appointment-store";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
  type LoadedAuthenticatedIdentity,
} from "@/lib/persistence/authenticated-identity-catalog";
import { assertAppointmentWriteCancelRole } from "./appointment-write-guard";
import {
  mutateAppointmentSafely,
  type AppointmentMutateHost,
} from "./appointment-write-mutate";
import {
  prepareAppointmentMutateCommand,
  type AppointmentMutateDraft,
  type PreparedAppointmentMutate,
} from "./appointment-write-mutate-command";
import { loadAppointmentWriteSnapshots } from "./appointment-remote-write-pilot";
import { emitAppointmentRemoteWriteRefresh } from "./appointment-write-refresh";
import { isAppointmentRemoteMutatePilotEnabled } from "./appointment-remote-mutate-flag";
import { AppointmentWriteNotFoundError } from "./appointment-write-mutate-errors";
import type { AppointmentWriteSnapshotCatalog } from "./appointment-write-snapshots";
import type { ScheduleAppointment } from "./domain";

export {
  APPOINTMENT_REMOTE_MUTATE_PILOT_ENV,
  isAppointmentRemoteMutatePilotEnabled,
} from "./appointment-remote-mutate-flag";

export {
  AppointmentConflictError,
  AppointmentCustomerImmutableError,
  AppointmentWriteIntegrityError,
  AppointmentWriteNotFoundError,
  AppointmentWriteRetryableError,
  AppointmentWriteStaleError,
  AppointmentWriteZeroRowError,
  mutateAppointmentSafely,
} from "./appointment-write-mutate";

export {
  prepareAppointmentMutateCommand,
  type AppointmentMutateDraft,
  type PreparedAppointmentMutate,
} from "./appointment-write-mutate-command";

export type AppointmentMutateClient = IdentitySupabaseClient &
  AuthenticatedAppointmentSupabaseClient;

export interface AuthenticatedAppointmentMutatePersistence {
  identity: LoadedAuthenticatedIdentity;
  snapshots: AppointmentWriteSnapshotCatalog;
  appointments: Pick<AppointmentRemoteAdapter, "get" | "list" | "update">;
  prepare(
    input: AppointmentMutateDraft,
    current: ScheduleAppointment,
  ): PreparedAppointmentMutate;
  mutate(
    command: PreparedAppointmentMutate,
  ): ReturnType<typeof mutateAppointmentSafely>;
}

export async function createAuthenticatedAppointmentMutatePersistence(
  client: AppointmentMutateClient,
): Promise<AuthenticatedAppointmentMutatePersistence> {
  const identity = await loadAuthenticatedIdentityCatalog(client);
  const snapshots = await loadAppointmentWriteSnapshots(client, identity);
  const appointments = new AppointmentRemoteAdapter(
    identity.mapper,
    new AuthenticatedAppointmentTableStore(client),
  );
  const host: AppointmentMutateHost = { appointments };
  return {
    identity,
    snapshots,
    appointments,
    prepare(input, current) {
      return prepareAppointmentMutateCommand(input, current, {
        mapper: identity.mapper,
        snapshots,
        organizationId: identity.organizationAppId,
        updatedBy: identity.operationalStaffId,
      });
    },
    mutate(command) {
      return mutateAppointmentSafely(command, host);
    },
  };
}

export async function runAuthenticatedAppointmentWriteMutate(
  client: AppointmentMutateClient,
  input: AppointmentMutateDraft,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  if (!isAppointmentRemoteMutatePilotEnabled(env)) {
    throw new Error("Appointment remote mutate pilot is off");
  }
  const persistence = await createAuthenticatedAppointmentMutatePersistence(client);
  const staff = persistence.identity.catalog.findStaffByAppId(
    persistence.identity.organizationDbId,
    persistence.identity.operationalStaffId,
  );
  assertAppointmentWriteCancelRole(staff?.role);
  if (
    input.organizationId &&
    input.organizationId !== persistence.identity.organizationAppId
  ) {
    throw new Error("Appointment mutate organization does not match the authenticated organization");
  }
  const current = await persistence.appointments.get(
    persistence.identity.organizationAppId,
    input.appointmentId,
  );
  if (!current) {
    throw new AppointmentWriteNotFoundError();
  }
  const command = persistence.prepare(input, current);
  const mutated = await persistence.mutate(command);
  emitAppointmentRemoteWriteRefresh({
    organizationId: command.organizationId,
    customerId: command.customerId,
    locationId: command.locationId,
    startAt: command.startAt,
  });
  return mutated;
}
