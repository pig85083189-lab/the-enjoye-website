/**
 * Authenticated PostgREST package store for the remote-create pilot.
 * Insert is insert-only (no upsert). Customer Package / ledger writes are refused.
 * Never uses a service-role client.
 */

import { PackageWriteCreateOnlyError } from "@/lib/packages/package-write-guard";
import { AuthenticatedPackageReadStore } from "./authenticated-package-read-store";
import type {
  IdentityQueryBuilder,
  IdentitySupabaseClient,
} from "./authenticated-identity-catalog";
import {
  dbPackageDefinitionFromUnknown,
  REMOTE_PACKAGE_DEFINITION_COLUMNS,
  remotePackageDefinitionPayload,
} from "./package-mapping";
import type { DbPackageDefinition } from "./operational-rows";

const DEFINITION_COLUMNS = REMOTE_PACKAGE_DEFINITION_COLUMNS.join(",");

export const PACKAGE_WRITE_INSERT_ONLY_MESSAGE =
  "Package definition already exists; insert-only (no upsert)";

export type PackageWriteQueryResult<T = unknown> = {
  data: T | null;
  error: { message: string } | null;
};

export interface AuthenticatedPackageWriteClient {
  auth: IdentitySupabaseClient["auth"];
  from(table: string): {
    select(columns: string): IdentityQueryBuilder;
    insert(payload: Record<string, unknown>): {
      select(columns: string): PromiseLike<PackageWriteQueryResult>;
    };
  };
}

function requireRows<T>(result: PackageWriteQueryResult<T>, action: string): T {
  if (result.error) {
    throw new Error(`${action}: ${result.error.message}`);
  }
  if (result.data == null) {
    throw new Error(`${action}: empty response`);
  }
  return result.data;
}

export class AuthenticatedPackageWriteStore {
  private readonly reads: AuthenticatedPackageReadStore;

  constructor(private readonly client: AuthenticatedPackageWriteClient) {
    this.reads = new AuthenticatedPackageReadStore(client as IdentitySupabaseClient);
  }

  async insertDefinition(row: DbPackageDefinition): Promise<DbPackageDefinition> {
    const existing = await this.reads.getDefinitionByAppId(row.organization_id, row.app_id);
    if (existing) {
      throw new Error(PACKAGE_WRITE_INSERT_ONLY_MESSAGE);
    }
    const payload = remotePackageDefinitionPayload(row);
    const result = await this.client
      .from("package_definitions")
      .insert(payload)
      .select(DEFINITION_COLUMNS);
    const data = requireRows(result, "insert package definition");
    const created = Array.isArray(data) ? data[0] : data;
    if (!created || typeof created !== "object") {
      throw new Error("insert package definition: empty response");
    }
    return dbPackageDefinitionFromUnknown(created as Record<string, unknown>);
  }

  insertCustomerPackage(): never {
    throw new PackageWriteCreateOnlyError();
  }

  updateCustomerPackageStatus(): never {
    throw new PackageWriteCreateOnlyError();
  }

  insertPackageLedger(): never {
    throw new PackageWriteCreateOnlyError();
  }

  listDefinitions(organizationDbId: string) {
    return this.reads.listDefinitions(organizationDbId);
  }

  getDefinitionByAppId(organizationDbId: string, appId: string) {
    return this.reads.getDefinitionByAppId(organizationDbId, appId);
  }
}
