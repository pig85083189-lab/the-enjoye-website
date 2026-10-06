/**
 * Phase 1C-6H.2 authenticated Commerce remote write foundation.
 *
 * Client / test import only. Server Components must use
 * commerce-remote-write-flag.ts so the adapter graph stays out of RSC.
 *
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Live Checkout draft hydrate / save / settle use this factory when the
 * Commerce remote-write pilot is on. No service role. No local + remote dual write.
 */

import type { CheckoutDiscount, PackageRedemptionSelection, PaymentDraft } from "./domain";
import { canCheckout, type CapabilityActor } from "@/lib/staff-auth/operational-capabilities";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import {
  AuthenticatedCommerceStore,
  type CommerceSupabaseClient,
} from "@/lib/persistence/authenticated-commerce-store";
import {
  COMMERCE_WRITE_PILOT_OFF_MESSAGE,
  CommerceWritePilotDeniedError,
  CommerceWriteStaleError,
} from "./commerce-remote-write-errors";
import { isCommerceRemoteWritePilotEnabled } from "./commerce-remote-write-flag";

export {
  COMMERCE_REMOTE_WRITE_PILOT_ENV,
  isCommerceRemoteWritePilotEnabled,
} from "./commerce-remote-write-flag";

export {
  COMMERCE_WRITE_FORBIDDEN_MESSAGE,
  COMMERCE_WRITE_PILOT_OFF_MESSAGE,
  CommerceWritePilotDeniedError,
  CommerceWriteStaleError,
} from "./commerce-remote-write-errors";

export type CommerceWriteClient = IdentitySupabaseClient & CommerceSupabaseClient;

export interface AuthenticatedCommerceWritePersistence {
  identity: Awaited<ReturnType<typeof loadAuthenticatedIdentityCatalog>>;
  commerce: AuthenticatedCommerceStore;
}

export function assertCommerceWriteRole(actor: CapabilityActor): void {
  if (!canCheckout(actor)) {
    throw new CommerceWritePilotDeniedError();
  }
}

export async function createAuthenticatedCommerceWritePersistence(
  client: CommerceWriteClient,
): Promise<AuthenticatedCommerceWritePersistence> {
  const identity = await loadAuthenticatedIdentityCatalog(client);
  return {
    identity,
    commerce: new AuthenticatedCommerceStore(client),
  };
}

function actorFromIdentity(
  identity: AuthenticatedCommerceWritePersistence["identity"],
): CapabilityActor {
  const staff = identity.catalog.findStaffByAppId(
    identity.organizationDbId,
    identity.operationalStaffId,
  );
  return { role: staff?.role, isActive: true };
}

function requireWritePilot(env: NodeJS.Dict<string>): void {
  if (!isCommerceRemoteWritePilotEnabled(env)) {
    throw new Error(COMMERCE_WRITE_PILOT_OFF_MESSAGE);
  }
}

function mapWriteError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (/資料已更新|stale|updated_at/i.test(message)) {
    throw new CommerceWriteStaleError();
  }
  if (/沒有權限/.test(message)) {
    throw new CommerceWritePilotDeniedError();
  }
  throw error;
}

export async function runAuthenticatedCommerceHydrate(
  client: CommerceWriteClient,
  input: {
    appointmentId: string;
    treatmentId: string;
  },
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  requireWritePilot(env);
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  assertCommerceWriteRole(actorFromIdentity(persistence.identity));
  try {
    return await persistence.commerce.hydrateFromTreatment({
      appointmentAppId: input.appointmentId,
      treatmentAppId: input.treatmentId,
    });
  } catch (error) {
    mapWriteError(error);
  }
}

export async function runAuthenticatedCommerceHydrateFromPackage(
  client: CommerceWriteClient,
  input: {
    customerId: string;
    packageId: string;
    locationId: string;
  },
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  requireWritePilot(env);
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  assertCommerceWriteRole(actorFromIdentity(persistence.identity));
  try {
    const bundle = await persistence.commerce.hydrateFromPackage({
      customerAppId: input.customerId,
      packageDefinitionAppId: input.packageId,
      locationAppId: input.locationId,
    });
    const customer = await persistence.commerce.getCustomerDisplay(input.customerId);
    return { ...bundle, customer };
  } catch (error) {
    mapWriteError(error);
  }
}

export async function runAuthenticatedCommerceSaveDraft(
  client: CommerceWriteClient,
  input: {
    draftId: string;
    expectedUpdatedAt: string;
    payments: PaymentDraft[];
    discounts: CheckoutDiscount[];
    packageRedemption?: PackageRedemptionSelection | null;
  },
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  requireWritePilot(env);
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  assertCommerceWriteRole(actorFromIdentity(persistence.identity));
  try {
    return await persistence.commerce.saveDraft({
      checkoutAppId: input.draftId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      payments: input.payments,
      discounts: input.discounts,
      packageRedemption: input.packageRedemption,
    });
  } catch (error) {
    mapWriteError(error);
  }
}

export async function runAuthenticatedCommerceRepairPackageFulfillment(
  client: CommerceWriteClient,
  transactionAppId: string,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  requireWritePilot(env);
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  assertCommerceWriteRole(actorFromIdentity(persistence.identity));
  try {
    return await persistence.commerce.repairPackageFulfillment(transactionAppId);
  } catch (error) {
    mapWriteError(error);
  }
}

export async function runAuthenticatedCommerceSettle(
  client: CommerceWriteClient,
  input: {
    draftId: string;
    expectedUpdatedAt: string;
  },
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  requireWritePilot(env);
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  assertCommerceWriteRole(actorFromIdentity(persistence.identity));
  try {
    return await persistence.commerce.settleDraft({
      checkoutAppId: input.draftId,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
  } catch (error) {
    mapWriteError(error);
  }
}

export async function runAuthenticatedCommerceListTransactions(
  client: CommerceWriteClient,
  organizationId: string,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  if (!isCommerceRemoteWritePilotEnabled(env)) {
    throw new Error(COMMERCE_WRITE_PILOT_OFF_MESSAGE);
  }
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  persistence.identity.mapper.resolveOrganizationDbId(organizationId);
  const rows = await persistence.commerce.listTransactions();
  return rows.filter((row) => row.organizationId === organizationId);
}
