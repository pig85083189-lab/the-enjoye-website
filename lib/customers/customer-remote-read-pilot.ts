/**
 * Phase 1C-3 Customer remote read pilot.
 *
 * Scoped to /staff/customers list + detail and Treatment customer
 * identity. Does not enable
 * BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Explicit activation: BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT=1
 * Production default is off until that env is set.
 */

import { getCustomer, listCustomers } from "@/lib/customers/customer-queries";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import { AuthenticatedCustomerReadStore } from "@/lib/persistence/authenticated-customer-read-store";
import { CustomerRemoteAdapter } from "@/lib/persistence/customer-remote-adapter";
import type { Customer } from "@/types";

export {
  CUSTOMER_REMOTE_READ_PILOT_ENV,
  isCustomerRemoteReadPilotEnabled,
} from "./customer-remote-read-flag";

export {
  CustomerRemoteReadOnlyError,
  CUSTOMER_REMOTE_READ_ONLY_MESSAGE,
} from "@/lib/persistence/authenticated-customer-read-store";

export async function createAuthenticatedCustomerReadPersistence(
  client: IdentitySupabaseClient,
  organizationAppId?: string | null,
) {
  const identity = await loadAuthenticatedIdentityCatalog(client, organizationAppId);
  return {
    identity,
    customers: new CustomerRemoteAdapter(
      identity.mapper,
      new AuthenticatedCustomerReadStore(client),
    ),
  };
}

export async function listRemotePilotCustomers(
  organizationId: string,
  client: IdentitySupabaseClient,
): Promise<Customer[]> {
  const persistence = await createAuthenticatedCustomerReadPersistence(client, organizationId);
  return listCustomers(organizationId, persistence);
}

export async function getRemotePilotCustomer(
  organizationId: string,
  customerId: string,
  client: IdentitySupabaseClient,
): Promise<Customer | undefined> {
  const persistence = await createAuthenticatedCustomerReadPersistence(client, organizationId);
  return getCustomer(organizationId, customerId, persistence);
}
