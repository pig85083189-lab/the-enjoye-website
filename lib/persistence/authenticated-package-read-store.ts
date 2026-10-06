/**
 * Authenticated, RLS-bound package table access for the Package read pilot.
 * Uses the publishable/session client only. Writes are refused.
 */

import type { IdentitySupabaseClient } from "./authenticated-identity-catalog";
import {
  dbCustomerPackageFromUnknown,
  dbPackageDefinitionFromUnknown,
  dbPackageLedgerFromUnknown,
  REMOTE_CUSTOMER_PACKAGE_COLUMNS,
  REMOTE_PACKAGE_DEFINITION_COLUMNS,
  REMOTE_PACKAGE_LEDGER_COLUMNS,
} from "./package-mapping";
import type {
  DbCustomerPackage,
  DbPackageDefinition,
  DbPackageLedgerEntry,
} from "./operational-rows";

export const PACKAGE_REMOTE_READ_ONLY_MESSAGE = "Package remote path is read-only";

export class PackageRemoteReadOnlyError extends Error {
  constructor(message = PACKAGE_REMOTE_READ_ONLY_MESSAGE) {
    super(message);
    this.name = "PackageRemoteReadOnlyError";
  }
}

const DEFINITION_SELECT = REMOTE_PACKAGE_DEFINITION_COLUMNS.join(", ");
const CUSTOMER_PACKAGE_SELECT = REMOTE_CUSTOMER_PACKAGE_COLUMNS.join(", ");
const LEDGER_SELECT = REMOTE_PACKAGE_LEDGER_COLUMNS.join(", ");

async function readRows<T>(
  result: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  map: (row: Record<string, unknown>) => T,
): Promise<T[]> {
  const resolved = await result;
  if (resolved.error) {
    throw new Error(resolved.error.message);
  }
  return (resolved.data ?? []).map((row) => map(row as Record<string, unknown>));
}

export class AuthenticatedPackageReadStore {
  constructor(private readonly client: IdentitySupabaseClient) {}

  insertDefinition(): never {
    throw new PackageRemoteReadOnlyError();
  }
  insertCustomerPackage(): never {
    throw new PackageRemoteReadOnlyError();
  }
  updateCustomerPackageStatus(): never {
    throw new PackageRemoteReadOnlyError();
  }
  insertPackageLedger(): never {
    throw new PackageRemoteReadOnlyError();
  }

  async listDefinitions(organizationDbId: string): Promise<DbPackageDefinition[]> {
    return readRows(
      this.client
        .from("package_definitions")
        .select(DEFINITION_SELECT)
        .eq("organization_id", organizationDbId),
      dbPackageDefinitionFromUnknown,
    );
  }

  async getDefinitionByAppId(
    organizationDbId: string,
    appId: string,
  ): Promise<DbPackageDefinition | undefined> {
    const rows = await readRows(
      this.client
        .from("package_definitions")
        .select(DEFINITION_SELECT)
        .eq("organization_id", organizationDbId)
        .eq("app_id", appId),
      dbPackageDefinitionFromUnknown,
    );
    return rows[0];
  }

  async listCustomerPackages(
    organizationDbId: string,
    customerDbId?: string,
  ): Promise<DbCustomerPackage[]> {
    let query = this.client
      .from("customer_packages")
      .select(CUSTOMER_PACKAGE_SELECT)
      .eq("organization_id", organizationDbId);
    if (customerDbId) query = query.eq("customer_id", customerDbId);
    return readRows(query, dbCustomerPackageFromUnknown);
  }

  async listPackageLedger(
    organizationDbId: string,
    opts?: { customerPackageDbId?: string; customerDbId?: string },
  ): Promise<DbPackageLedgerEntry[]> {
    let query = this.client
      .from("package_ledger_entries")
      .select(LEDGER_SELECT)
      .eq("organization_id", organizationDbId);
    if (opts?.customerPackageDbId) {
      query = query.eq("customer_package_id", opts.customerPackageDbId);
    }
    if (opts?.customerDbId) {
      query = query.eq("customer_id", opts.customerDbId);
    }
    return readRows(query, dbPackageLedgerFromUnknown);
  }
}
