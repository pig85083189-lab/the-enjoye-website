/**
 * Phase 1C-3 Customer remote read pilot.
 *
 * Scoped to /staff/customers list + detail and Treatment customer
 * identity. Does not enable
 * BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Preview activation: BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT=1
 * Production is always off, even if that env is present.
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
) {
  const identity = await loadAuthenticatedIdentityCatalog(client);
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
  const persistence = await createAuthenticatedCustomerReadPersistence(client);
  return listCustomers(organizationId, persistence);
}

export async function getRemotePilotCustomer(
  organizationId: string,
  customerId: string,
  client: IdentitySupabaseClient,
): Promise<Customer | undefined> {
  const persistence = await createAuthenticatedCustomerReadPersistence(client);
  return getCustomer(organizationId, customerId, persistence);
}
