/**
 * Service remote create — authenticated write factory.
 *
 * Client / test import only. Server Components must use
 * service-remote-write-flag.ts so the adapter graph stays out of RSC.
 *
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Create-only. EDIT / ACTIVE toggle are refused.
 * No service role. No localStorage fallback.
 */

import { createServiceRecord, type RealServiceCreateInput } from "./service-queries";
import {
  ServiceWritePilotOffError,
  ServiceWriteUnauthorizedError,
  refuseServiceWriteMutation,
} from "./service-write-guard";
import { isServiceRemoteWritePilotEnabled } from "./service-remote-write-flag";
import { canManageServices } from "./service-catalog-derived";
import { ServiceRemoteAdapter } from "@/lib/persistence/service-remote-adapter";
import {
  loadAuthenticatedIdentityCatalog,
  type LoadedAuthenticatedIdentity,
} from "@/lib/persistence/authenticated-identity-catalog";
import {
  AuthenticatedServiceWriteStore,
  type AuthenticatedServiceWriteClient,
} from "@/lib/persistence/authenticated-service-write-store";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import type { StaffRole } from "@/types/saas";
import type { Service } from "@/types";

export {
  SERVICE_REMOTE_WRITE_PILOT_ENV,
  isServiceRemoteWritePilotEnabled,
} from "./service-remote-write-flag";

export {
  SERVICE_WRITE_CREATE_ONLY_MESSAGE,
  SERVICE_WRITE_PILOT_OFF_MESSAGE,
  SERVICE_WRITE_UNAUTHORIZED_MESSAGE,
  ServiceWriteCreateOnlyError,
  ServiceWritePilotOffError,
  ServiceWriteUnauthorizedError,
  refuseServiceWriteMutation,
} from "./service-write-guard";

export type ServiceWriteClient = AuthenticatedServiceWriteClient;

export type ServiceRemoteCreateInput = Omit<RealServiceCreateInput, "serviceType"> & {
  serviceType?: RealServiceCreateInput["serviceType"];
};

export interface AuthenticatedServiceWritePersistence {
  identity: LoadedAuthenticatedIdentity;
  services: ServiceRemoteAdapter;
  update(): never;
  deactivate(): never;
  reactivate(): never;
}

function assertOrganizationBoundary(
  identity: LoadedAuthenticatedIdentity,
  organizationId: string,
): void {
  if (organizationId !== identity.organizationAppId) {
    throw new UnmappedIdentityError("organization", identity.organizationAppId, organizationId);
  }
  identity.mapper.resolveOrganizationDbId(organizationId);
}

function assertCanManageServices(identity: LoadedAuthenticatedIdentity): void {
  const staffRow = identity.catalog.findStaffByAppId(
    identity.organizationDbId,
    identity.operationalStaffId,
  );
  if (!canManageServices(staffRow?.role as StaffRole | undefined)) {
    throw new ServiceWriteUnauthorizedError();
  }
}

export async function createAuthenticatedServiceWritePersistence(
  client: ServiceWriteClient,
): Promise<AuthenticatedServiceWritePersistence> {
  const identity = await loadAuthenticatedIdentityCatalog(client);
  return {
    identity,
    services: new ServiceRemoteAdapter(
      identity.mapper,
      new AuthenticatedServiceWriteStore(client),
    ),
    update: () => refuseServiceWriteMutation("update"),
    deactivate: () => refuseServiceWriteMutation("deactivate"),
    reactivate: () => refuseServiceWriteMutation("reactivate"),
  };
}

export async function runAuthenticatedServiceWriteCreate(
  client: ServiceWriteClient,
  input: ServiceRemoteCreateInput,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<Service> {
  if (!isServiceRemoteWritePilotEnabled(env)) {
    throw new ServiceWritePilotOffError();
  }
  const persistence = await createAuthenticatedServiceWritePersistence(client);
  assertOrganizationBoundary(persistence.identity, input.organizationId);
  persistence.identity.mapper.requireOperationalStaffId(
    persistence.identity.organizationAppId,
    input.createdByStaffId,
  );
  assertCanManageServices(persistence.identity);
  return createServiceRecord(
    {
      ...input,
      organizationId: persistence.identity.organizationAppId,
      serviceType: input.serviceType ?? "GENERIC",
    },
    persistence,
  );
}
