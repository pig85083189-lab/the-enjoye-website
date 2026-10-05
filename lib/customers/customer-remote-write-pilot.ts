/**
 * Phase Customer Remote Create — authenticated write factory.
 *
 * Client / test import only. Server Components must use
 * customer-remote-write-flag.ts so the adapter graph stays out of RSC.
 *
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * ConsultationWizard create is the only live caller when the Preview write flag is on.
 * No service role. No localStorage fallback.
 */

import { createCustomer, findCustomersByPhone, type RealCustomerCreateInput } from "./customer-queries";
import {
  CustomerDuplicateError,
  CustomerWritePilotOffError,
  refuseCustomerWriteMutation,
} from "./customer-write-guard";
import { isCustomerRemoteWritePilotEnabled } from "./customer-remote-write-flag";
import { CustomerRemoteAdapter } from "@/lib/persistence/customer-remote-adapter";
import {
  loadAuthenticatedIdentityCatalog,
  type LoadedAuthenticatedIdentity,
} from "@/lib/persistence/authenticated-identity-catalog";
import {
  AuthenticatedCustomerWriteStore,
  type AuthenticatedCustomerWriteClient,
} from "@/lib/persistence/authenticated-customer-store";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import type { Customer } from "@/types";

export {
  CUSTOMER_REMOTE_WRITE_PILOT_ENV,
  isCustomerRemoteWritePilotEnabled,
} from "./customer-remote-write-flag";

export {
  CUSTOMER_WRITE_CREATE_ONLY_MESSAGE,
  CUSTOMER_WRITE_PILOT_OFF_MESSAGE,
  CustomerDuplicateError,
  CustomerWriteCreateOnlyError,
  CustomerWritePilotOffError,
  refuseCustomerWriteMutation,
} from "./customer-write-guard";

export type CustomerWriteClient = AuthenticatedCustomerWriteClient;

export type CustomerRemoteCreateInput = RealCustomerCreateInput & {
  locationId?: string;
  allowDuplicate?: boolean;
};

export interface AuthenticatedCustomerWritePersistence {
  identity: LoadedAuthenticatedIdentity;
  customers: CustomerRemoteAdapter;
  update(): never;
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

function assertLocationBoundary(
  identity: LoadedAuthenticatedIdentity,
  locationId: string | undefined,
): void {
  if (!locationId) return;
  identity.mapper.resolveLocationDbId(identity.organizationAppId, locationId);
}

export async function createAuthenticatedCustomerWritePersistence(
  client: CustomerWriteClient,
): Promise<AuthenticatedCustomerWritePersistence> {
  const identity = await loadAuthenticatedIdentityCatalog(client);
  return {
    identity,
    customers: new CustomerRemoteAdapter(
      identity.mapper,
      new AuthenticatedCustomerWriteStore(client),
    ),
    update: () => refuseCustomerWriteMutation("update"),
  };
}

export async function runAuthenticatedCustomerWriteCreate(
  client: CustomerWriteClient,
  input: CustomerRemoteCreateInput,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<Customer> {
  if (!isCustomerRemoteWritePilotEnabled(env)) {
    throw new CustomerWritePilotOffError();
  }
  const persistence = await createAuthenticatedCustomerWritePersistence(client);
  assertOrganizationBoundary(persistence.identity, input.organizationId);
  assertLocationBoundary(persistence.identity, input.locationId);
  persistence.identity.mapper.requireOperationalStaffId(
    persistence.identity.organizationAppId,
    input.primaryStaffId,
  );
  if (!input.allowDuplicate) {
    const existing = await findCustomersByPhone(
      persistence.identity.organizationAppId,
      input.phone,
      persistence,
    );
    if (existing.length > 0) {
      throw new CustomerDuplicateError(existing.map((row) => row.id));
    }
  }
  return createCustomer(
    {
      ...input,
      organizationId: persistence.identity.organizationAppId,
    },
    persistence,
  );
}
