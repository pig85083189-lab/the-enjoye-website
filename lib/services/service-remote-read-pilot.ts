/**
 * Service remote read pilot.
 *
 * Scoped to /staff/services list. Appointment Create already reads
 * public.services independently via the write-form catalog.
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Explicit activation: BEAUTY_OS_SERVICE_REMOTE_READ_PILOT=1
 * Production default is off until that env is set.
 */

import { getPersistedService, listPersistedServices } from "@/lib/services/service-queries";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import { AuthenticatedServiceReadStore } from "@/lib/persistence/authenticated-service-read-store";
import { ServiceRemoteAdapter } from "@/lib/persistence/service-remote-adapter";
import type { Service } from "@/types";

export {
  SERVICE_REMOTE_READ_PILOT_ENV,
  isServiceRemoteReadPilotEnabled,
} from "./service-remote-read-flag";

export {
  ServiceRemoteReadOnlyError,
  SERVICE_REMOTE_READ_ONLY_MESSAGE,
} from "@/lib/persistence/authenticated-service-read-store";

export async function createAuthenticatedServiceReadPersistence(
  client: IdentitySupabaseClient,
) {
  const identity = await loadAuthenticatedIdentityCatalog(client);
  return {
    identity,
    services: new ServiceRemoteAdapter(
      identity.mapper,
      new AuthenticatedServiceReadStore(client),
    ),
  };
}

export async function listRemotePilotServices(
  organizationId: string,
  client: IdentitySupabaseClient,
): Promise<Service[]> {
  const persistence = await createAuthenticatedServiceReadPersistence(client);
  return listPersistedServices(organizationId, undefined, persistence);
}

export async function getRemotePilotService(
  organizationId: string,
  serviceId: string,
  client: IdentitySupabaseClient,
): Promise<Service | undefined> {
  const persistence = await createAuthenticatedServiceReadPersistence(client);
  return getPersistedService(organizationId, serviceId, persistence);
}
