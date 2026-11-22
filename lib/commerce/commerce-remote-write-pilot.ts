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

import type { CheckoutDiscount, PaymentDraft } from "./domain";
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

export async function runAuthenticatedCommerceSaveDraft(
  client: CommerceWriteClient,
  input: {
    draftId: string;
    expectedUpdatedAt: string;
    payments: PaymentDraft[];
    discounts: CheckoutDiscount[];
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
    });
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

/** Explicit package operations. Kept separate from legacy settlement. */
export async function runAuthenticatedPackagePurchaseSettle(
  client: CommerceWriteClient,
  input: { draftId: string; expectedUpdatedAt: string; packageDefinitionDbId: string },
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  requireWritePilot(env);
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  assertCommerceWriteRole(actorFromIdentity(persistence.identity));
  try {
    return await persistence.commerce.settlePackagePurchase({
      checkoutAppId: input.draftId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      packageDefinitionDbId: input.packageDefinitionDbId,
    });
  } catch (error) { mapWriteError(error); }
}

export async function runAuthenticatedPackageRedemptionSettle(
  client: CommerceWriteClient,
  input: { draftId: string; expectedUpdatedAt: string; customerPackageDbId: string; serviceDbId: string },
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  requireWritePilot(env);
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  assertCommerceWriteRole(actorFromIdentity(persistence.identity));
  try {
    return await persistence.commerce.settlePackageRedemption({
      checkoutAppId: input.draftId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      customerPackageDbId: input.customerPackageDbId,
      serviceDbId: input.serviceDbId,
    });
  } catch (error) { mapWriteError(error); }
}

export async function runAuthenticatedPackageRedemptionVoid(
  client: CommerceWriteClient,
  input: { transactionDbId: string; reason: string },
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  requireWritePilot(env);
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  assertCommerceWriteRole(actorFromIdentity(persistence.identity));
  try { return await persistence.commerce.voidPackageRedemption(input); }
  catch (error) { mapWriteError(error); }
}


/** Read-only package catalogs, with the same checkout role gate. */
export async function runAuthenticatedPackageDefinitionCatalog(
  client: CommerceWriteClient,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  requireWritePilot(env);
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  assertCommerceWriteRole(actorFromIdentity(persistence.identity));
  return persistence.commerce.listPackageDefinitionsForCheckout();
}

export async function runAuthenticatedCustomerPackageCatalog(
  client: CommerceWriteClient,
  customerDbId: string,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  requireWritePilot(env);
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  assertCommerceWriteRole(actorFromIdentity(persistence.identity));
  return persistence.commerce.listCustomerPackagesForCheckout(customerDbId);
}

/**
 * Resolve package app IDs through the authenticated catalog, not UUID guesses.
 * Fail closed if the definition is missing, duplicated, or belongs to another org.
 */
export async function runAuthenticatedPackagePurchaseByAppId(
  client: CommerceWriteClient,
  input: { draftId: string; expectedUpdatedAt: string; packageDefinitionAppId: string },
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  requireWritePilot(env);
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  assertCommerceWriteRole(actorFromIdentity(persistence.identity));
  const definitions = await persistence.commerce.listPackageDefinitionsForCheckout();
  const matches = definitions.filter((row) =>
    row.organizationDbId === persistence.identity.organizationDbId &&
    row.packageDefinitionAppId === input.packageDefinitionAppId
  );
  if (matches.length !== 1) throw new Error("套票方案尚未同步或對應不唯一，無法結帳");
  try {
    return await persistence.commerce.settlePackagePurchase({
      checkoutAppId: input.draftId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      packageDefinitionDbId: matches[0]!.packageDefinitionDbId,
    });
  } catch (error) { mapWriteError(error); }
}

/** Verify both customer and service belong to the authenticated organization. */
export async function runAuthenticatedPackageRedemptionByAppId(
  client: CommerceWriteClient,
  input: {
    draftId: string;
    expectedUpdatedAt: string;
    customerAppId: string;
    customerPackageAppId: string;
    serviceAppId: string;
  },
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  requireWritePilot(env);
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  assertCommerceWriteRole(actorFromIdentity(persistence.identity));
  const { identity } = persistence;
  const customerDbId = identity.mapper.resolveCustomerDbId(identity.organizationAppId, input.customerAppId);
  const serviceDbId = identity.mapper.resolveServiceDbId(identity.organizationAppId, input.serviceAppId);
  const packages = await persistence.commerce.listCustomerPackagesForCheckout(customerDbId);
  const matches = packages.filter((row) =>
    row.customerDbId === customerDbId &&
    row.customerPackageAppId === input.customerPackageAppId
  );
  if (matches.length !== 1) throw new Error("顧客套票尚未同步或對應不唯一，無法扣堂");
  const pkg = matches[0]!;
  if (pkg.status !== "ACTIVE" || pkg.remainingSessions < 1 ||
      (pkg.expiresAt && new Date(pkg.expiresAt).getTime() <= Date.now()) ||
      !pkg.includedServiceAppIds.includes(input.serviceAppId)) {
    throw new Error("套票堂數不足、已失效或不適用此療程");
  }
  try {
    return await persistence.commerce.settlePackageRedemption({
      checkoutAppId: input.draftId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      customerPackageDbId: pkg.customerPackageDbId,
      serviceDbId,
    });
  } catch (error) { mapWriteError(error); }
}

/** Resolve organization-owned IDs through the authenticated RPC.
 * The database checks staff permission and re-reads authoritative prices.
 */
export async function runAuthenticatedOpenPackagePurchaseDraft(
  client: CommerceWriteClient,
  input: {
    checkoutAppId: string;
    customerAppId: string;
    locationAppId: string;
    packageDefinitionAppId: string;
  },
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
) {
  requireWritePilot(env);
  const persistence = await createAuthenticatedCommerceWritePersistence(client);
  assertCommerceWriteRole(actorFromIdentity(persistence.identity));
  try {
    return await persistence.commerce.openPackagePurchaseDraft(input);
  } catch (error) {
    mapWriteError(error);
  }
}
