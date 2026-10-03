/**
 * Phase 1C-3 Customer remote read pilot.
 *
 * Scoped to /staff/customers list + detail. Does not enable
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

export const CUSTOMER_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT";

export {
  CustomerRemoteReadOnlyError,
  CUSTOMER_REMOTE_READ_ONLY_MESSAGE,
} from "@/lib/persistence/authenticated-customer-read-store";

export function isCustomerRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  return env[CUSTOMER_REMOTE_READ_PILOT_ENV] === "1";
}

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
