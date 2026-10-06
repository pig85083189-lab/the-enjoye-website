/**
 * Package remote create — authenticated write factory.
 *
 * Client / test import only. Server Components must use
 * package-remote-write-flag.ts so the adapter graph stays out of RSC.
 *
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Create-only for public.package_definitions.
 * No Customer Package fulfillment / redemption / ledger writes.
 * No service role. No localStorage fallback.
 */

import { DEFAULT_CURRENCY } from "@/lib/commerce/domain";
import { assertNonNegativeMoney } from "@/lib/commerce/money";
import { newId } from "@/lib/repositories/storage";
import type { StaffRole } from "@/types/saas";
import {
  assertNotDemoResiduePayload,
  assertRemoteServiceAllowed,
  isBlockedRemotePackageName,
  isGeneratedPackageDefinitionAppId,
} from "@/lib/persistence/demo-firewall";
import {
  loadAuthenticatedIdentityCatalog,
  type LoadedAuthenticatedIdentity,
} from "@/lib/persistence/authenticated-identity-catalog";
import {
  AuthenticatedPackageWriteStore,
  type AuthenticatedPackageWriteClient,
} from "@/lib/persistence/authenticated-package-write-store";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import {
  packageDefinitionFromRemoteRow,
} from "@/lib/persistence/package-mapping";
import type { DbPackageDefinition } from "@/lib/persistence/operational-rows";
import type { PackageDefinition, PackageServiceEntitlement } from "./domain";
import { canManagePackagePlans } from "./package-plans-derived";
import {
  isPackageRemoteWritePilotEnabled,
} from "./package-remote-write-flag";
import {
  PackageWritePilotOffError,
  PackageWriteUnauthorizedError,
  refusePackageWriteMutation,
} from "./package-write-guard";

export {
  PACKAGE_REMOTE_WRITE_PILOT_ENV,
  isPackageRemoteWritePilotEnabled,
} from "./package-remote-write-flag";

export {
  PACKAGE_WRITE_CREATE_ONLY_MESSAGE,
  PACKAGE_WRITE_PILOT_OFF_MESSAGE,
  PACKAGE_WRITE_UNAUTHORIZED_MESSAGE,
  PackageWriteCreateOnlyError,
  PackageWritePilotOffError,
  PackageWriteUnauthorizedError,
  refusePackageWriteMutation,
} from "./package-write-guard";

export type PackageWriteClient = AuthenticatedPackageWriteClient;

export interface PackageRemoteCreateInput {
  organizationId: string;
  name: string;
  description?: string;
  includedServiceIds: string[];
  sessionCount: number;
  priceMinor: number;
  validityDays?: number;
  isActive?: boolean;
  createdByStaffId: string;
}

export interface AuthenticatedPackageWritePersistence {
  identity: LoadedAuthenticatedIdentity;
  packages: AuthenticatedPackageWriteStore;
  fulfill(): never;
  redeem(): never;
  adjustLedger(): never;
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

function assertCanManagePackagePlans(identity: LoadedAuthenticatedIdentity): void {
  const staffRow = identity.catalog.findStaffByAppId(
    identity.organizationDbId,
    identity.operationalStaffId,
  );
  if (!canManagePackagePlans(staffRow?.role as StaffRole | undefined)) {
    throw new PackageWriteUnauthorizedError();
  }
}

export async function createAuthenticatedPackageWritePersistence(
  client: PackageWriteClient,
): Promise<AuthenticatedPackageWritePersistence> {
  const identity = await loadAuthenticatedIdentityCatalog(client);
  return {
    identity,
    packages: new AuthenticatedPackageWriteStore(client),
    fulfill: () => refusePackageWriteMutation("fulfill"),
    redeem: () => refusePackageWriteMutation("redeem"),
    adjustLedger: () => refusePackageWriteMutation("ledger"),
  };
}

export async function runAuthenticatedPackageWriteCreate(
  client: PackageWriteClient,
  input: PackageRemoteCreateInput,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<PackageDefinition> {
  if (!isPackageRemoteWritePilotEnabled(env)) {
    throw new PackageWritePilotOffError();
  }
  assertNotDemoResiduePayload(input);
  if (isBlockedRemotePackageName(input.name)) {
    throw new Error("Demo / seed packages cannot be written to remote package persistence");
  }
  if (!input.name.trim()) throw new Error("package name required");
  if (!Number.isInteger(input.sessionCount) || input.sessionCount < 1) {
    throw new Error("sessionCount must be integer >= 1");
  }
  assertNonNegativeMoney(input.priceMinor, "priceMinor");
  if (input.includedServiceIds.length === 0) {
    throw new Error("package requires at least one service");
  }

  const persistence = await createAuthenticatedPackageWritePersistence(client);
  assertOrganizationBoundary(persistence.identity, input.organizationId);
  persistence.identity.mapper.requireOperationalStaffId(
    persistence.identity.organizationAppId,
    input.createdByStaffId,
  );
  assertCanManagePackagePlans(persistence.identity);

  const includedServices: PackageServiceEntitlement[] = input.includedServiceIds.map(
    (serviceId) => {
      assertRemoteServiceAllowed({ id: serviceId });
      persistence.identity.mapper.resolveServiceDbId(
        persistence.identity.organizationAppId,
        serviceId,
      );
      return { serviceId, sessionsPerRedemption: 1 as const };
    },
  );

  const stamp = new Date().toISOString();
  const appId = newId("pkgdef");
  if (!isGeneratedPackageDefinitionAppId(appId)) {
    throw new Error("Generated package app_id is invalid");
  }
  const row: DbPackageDefinition = {
    id: crypto.randomUUID(),
    organization_id: persistence.identity.organizationDbId,
    app_id: appId,
    name: input.name.trim(),
    description: input.description?.trim() ? input.description.trim() : null,
    included_services: includedServices,
    session_count: input.sessionCount,
    price_minor: input.priceMinor,
    currency: DEFAULT_CURRENCY,
    validity_days: input.validityDays ?? null,
    is_active: input.isActive !== false,
    created_at: stamp,
    updated_at: stamp,
  };
  const created = await persistence.packages.insertDefinition(row);
  return packageDefinitionFromRemoteRow(persistence.identity.organizationAppId, created);
}
