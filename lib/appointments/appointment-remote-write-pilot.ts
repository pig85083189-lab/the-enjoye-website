/**
 * Phase 1C-6B.1 authenticated Appointment write foundation.
 *
 * Client / test import only. Server Components must use
 * appointment-remote-write-flag.ts so the adapter graph stays out of RSC.
 *
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Does not wire Calendar. Does not write unless explicitly called.
 * No service role. No localStorage fallback.
 */

import { AppointmentRemoteAdapter } from "@/lib/persistence/appointment-remote-adapter";
import {
  AuthenticatedAppointmentTableStore,
  type AuthenticatedAppointmentSupabaseClient,
} from "@/lib/persistence/authenticated-appointment-store";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentityQueryBuilder,
  type IdentitySupabaseClient,
  type LoadedAuthenticatedIdentity,
} from "@/lib/persistence/authenticated-identity-catalog";
import { IdentityCatalogError } from "@/lib/persistence/identity-errors";
import {
  assertAppointmentWritePilotOwner,
  refuseAppointmentWriteMutation,
} from "./appointment-write-guard";
import {
  createAppointmentSafely,
  type AppointmentWriteHost,
} from "./appointment-write-create";
import {
  prepareAppointmentCreateCommand,
  type AppointmentWriteDraftInput,
  type PreparedAppointmentCreate,
} from "./appointment-write-command";
import {
  createAppointmentWriteSnapshotCatalog,
  type AppointmentWriteSnapshotCatalog,
} from "./appointment-write-snapshots";
import { emitAppointmentRemoteWriteRefresh } from "./appointment-write-refresh";
import { isAppointmentRemoteWritePilotEnabled } from "./appointment-remote-write-flag";

export {
  APPOINTMENT_REMOTE_WRITE_PILOT_ENV,
  isAppointmentRemoteWritePilotEnabled,
} from "./appointment-remote-write-flag";

export {
  APPOINTMENT_WRITE_PILOT_OWNER_ONLY_MESSAGE,
  APPOINTMENT_WRITE_CREATE_ONLY_MESSAGE,
  AppointmentWritePilotDeniedError,
  AppointmentWriteCreateOnlyError,
  assertAppointmentWritePilotOwner,
  refuseAppointmentWriteMutation,
} from "./appointment-write-guard";

export {
  AppointmentConflictError,
  AppointmentWriteIntegrityError,
  AppointmentWriteRetryableError,
  createAppointmentSafely,
  isAppointmentExclusionConflictError,
} from "./appointment-write-create";

export type AppointmentWriteClient = IdentitySupabaseClient &
  AuthenticatedAppointmentSupabaseClient;

async function readNamedRows(
  builder: IdentityQueryBuilder,
): Promise<Array<Record<string, unknown>>> {
  const result = await builder;
  if (result.error) {
    throw new IdentityCatalogError("missing_mapping", result.error.message);
  }
  return result.data ?? [];
}

function asName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function loadAppointmentWriteSnapshots(
  client: IdentitySupabaseClient,
  identity: LoadedAuthenticatedIdentity,
): Promise<AppointmentWriteSnapshotCatalog> {
  const customers = (
    await readNamedRows(
      client
        .from("customers")
        .select("app_id, organization_id, full_name")
        .eq("organization_id", identity.organizationDbId),
    )
  ).flatMap((row) => {
    const appId = typeof row.app_id === "string" ? row.app_id : "";
    const name = asName(row.full_name);
    if (!appId || !name) return [];
    return [{ organizationId: identity.organizationAppId, appId, name }];
  });
  const services = (
    await readNamedRows(
      client
        .from("services")
        .select("app_id, organization_id, name")
        .eq("organization_id", identity.organizationDbId),
    )
  ).flatMap((row) => {
    const appId = typeof row.app_id === "string" ? row.app_id : "";
    const name = asName(row.name);
    if (!appId || !name) return [];
    return [{ organizationId: identity.organizationAppId, appId, name }];
  });
  const staff = (
    await readNamedRows(
      client
        .from("staff_auth_memberships")
        .select("user_id, display_name, organization_id, is_active")
        .eq("organization_id", identity.organizationAppId),
    )
  ).flatMap((row) => {
    if (row.is_active === false) return [];
    const appId = typeof row.user_id === "string" ? row.user_id : "";
    const name = asName(row.display_name);
    if (!appId || !name) return [];
    return [{ organizationId: identity.organizationAppId, appId, name }];
  });
  return createAppointmentWriteSnapshotCatalog({ customers, services, staff });
}

export interface AuthenticatedAppointmentWritePersistence {
  identity: LoadedAuthenticatedIdentity;
  snapshots: AppointmentWriteSnapshotCatalog;
  appointments: Pick<AppointmentRemoteAdapter, "create" | "get" | "list">;
  prepare(input: AppointmentWriteDraftInput): PreparedAppointmentCreate;
  create(command: PreparedAppointmentCreate): ReturnType<typeof createAppointmentSafely>;
  update(): never;
  reschedule(): never;
  cancel(): never;
  changeStatus(): never;
  delete(): never;
}

export async function createAuthenticatedAppointmentWritePersistence(
  client: AppointmentWriteClient,
): Promise<AuthenticatedAppointmentWritePersistence> {
  const identity = await loadAuthenticatedIdentityCatalog(client);
  const snapshots = await loadAppointmentWriteSnapshots(client, identity);
  const appointments = new AppointmentRemoteAdapter(
    identity.mapper,
    new AuthenticatedAppointmentTableStore(client),
  );
  const host: AppointmentWriteHost = { appointments };
  return {
    identity,
    snapshots,
    appointments,
    prepare(input) {
      return prepareAppointmentCreateCommand(
        { ...input, organizationId: identity.organizationAppId },
        { mapper: identity.mapper, snapshots },
      );
    },
    create(command) {
      return createAppointmentSafely(command, host);
    },
    update: () => refuseAppointmentWriteMutation("update"),
    reschedule: () => refuseAppointmentWriteMutation("reschedule"),
    cancel: () => refuseAppointmentWriteMutation("cancel"),
    changeStatus: () => refuseAppointmentWriteMutation("status"),
    delete: () => refuseAppointmentWriteMutation("delete"),
  };
}

export async function runAuthenticatedAppointmentWriteCreate(
  client: AppointmentWriteClient,
  input: AppointmentWriteDraftInput,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  if (!isAppointmentRemoteWritePilotEnabled(env)) {
    throw new Error("Appointment remote write pilot is off");
  }
  const persistence = await createAuthenticatedAppointmentWritePersistence(client);
  const staff = persistence.identity.catalog.findStaffByAppId(
    persistence.identity.organizationDbId,
    persistence.identity.operationalStaffId,
  );
  assertAppointmentWritePilotOwner(staff?.role);
  const command = persistence.prepare(input);
  const created = await persistence.create(command);
  emitAppointmentRemoteWriteRefresh({
    organizationId: command.organizationId,
    customerId: command.customerId,
    locationId: command.locationId,
    startAt: command.startAt,
  });
  return created;
}
