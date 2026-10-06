/**
 * Package remote read pilot.
 *
 * Scoped to /staff/packages sell picker and Customer 360 wallet package
 * read. Does not enable BEAUTY_OS_PERSISTENCE or
 * BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Explicit activation: BEAUTY_OS_PACKAGE_REMOTE_READ_PILOT=1
 * Production default is off until that env is set.
 *
 * Read-only. Does not create package definitions, customer packages,
 * or ledger entries.
 */

import {
  customerPackageFromRemoteRow,
  packageDefinitionFromRemoteRow,
  packageLedgerFromRemoteRow,
} from "@/lib/persistence/package-mapping";
import {
  AuthenticatedPackageReadStore,
  PackageRemoteReadOnlyError,
  PACKAGE_REMOTE_READ_ONLY_MESSAGE,
} from "@/lib/persistence/authenticated-package-read-store";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import type { CustomerPackage, PackageDefinition, PackageLedgerEntry } from "./domain";

export {
  PACKAGE_REMOTE_READ_PILOT_ENV,
  isPackageRemoteReadPilotEnabled,
} from "./package-remote-read-flag";

export { PackageRemoteReadOnlyError, PACKAGE_REMOTE_READ_ONLY_MESSAGE };

export async function createAuthenticatedPackageReadPersistence(
  client: IdentitySupabaseClient,
) {
  const identity = await loadAuthenticatedIdentityCatalog(client);
  return {
    identity,
    packages: new AuthenticatedPackageReadStore(client),
  };
}

export async function listRemotePilotPackageDefinitions(
  organizationId: string,
  client: IdentitySupabaseClient,
  opts?: { activeOnly?: boolean },
): Promise<PackageDefinition[]> {
  const persistence = await createAuthenticatedPackageReadPersistence(client);
  persistence.identity.mapper.resolveOrganizationDbId(organizationId);
  const rows = await persistence.packages.listDefinitions(
    persistence.identity.organizationDbId,
  );
  const definitions = rows.map((row) =>
    packageDefinitionFromRemoteRow(organizationId, row),
  );
  return opts?.activeOnly ? definitions.filter((row) => row.isActive) : definitions;
}

export async function listRemotePilotCustomerPackages(
  organizationId: string,
  client: IdentitySupabaseClient,
  opts?: { customerId?: string },
): Promise<CustomerPackage[]> {
  const persistence = await createAuthenticatedPackageReadPersistence(client);
  const customerDbId = opts?.customerId
    ? persistence.identity.mapper.resolveCustomerDbId(organizationId, opts.customerId)
    : undefined;
  const [rows, definitions] = await Promise.all([
    persistence.packages.listCustomerPackages(
      persistence.identity.organizationDbId,
      customerDbId,
    ),
    persistence.packages.listDefinitions(persistence.identity.organizationDbId),
  ]);
  const definitionAppByDb = new Map(definitions.map((row) => [row.id, row.app_id]));
  return rows.map((row) =>
    customerPackageFromRemoteRow(organizationId, row, {
      customerAppId: persistence.identity.mapper.toCustomerAppId(row.customer_id),
      packageDefinitionAppId: definitionAppByDb.get(row.package_definition_id) ?? "",
    }),
  );
}

export async function listRemotePilotPackageLedger(
  organizationId: string,
  client: IdentitySupabaseClient,
  opts?: { customerId?: string },
): Promise<PackageLedgerEntry[]> {
  const persistence = await createAuthenticatedPackageReadPersistence(client);
  const customerDbId = opts?.customerId
    ? persistence.identity.mapper.resolveCustomerDbId(organizationId, opts.customerId)
    : undefined;
  const [rows, packages] = await Promise.all([
    persistence.packages.listPackageLedger(persistence.identity.organizationDbId, {
      customerDbId,
    }),
    persistence.packages.listCustomerPackages(
      persistence.identity.organizationDbId,
      customerDbId,
    ),
  ]);
  const packageAppByDb = new Map(packages.map((row) => [row.id, row.app_id]));
  return rows.map((row) =>
    packageLedgerFromRemoteRow(organizationId, row, {
      customerPackageAppId: packageAppByDb.get(row.customer_package_id) ?? "",
      customerAppId: persistence.identity.mapper.toCustomerAppId(row.customer_id),
      locationAppId: row.location_id
        ? persistence.identity.mapper.toLocationAppId(row.location_id)
        : undefined,
    }),
  );
}
