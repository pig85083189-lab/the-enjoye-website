/**
 * Authenticated PostgREST service store for the remote-create pilot.
 * Insert is insert-only (no upsert). Updates are refused.
 * Never uses a service-role client.
 */

import { ServiceWriteCreateOnlyError } from "@/lib/services/service-write-guard";
import { AuthenticatedServiceReadStore } from "./authenticated-service-read-store";
import type {
  IdentityQueryBuilder,
  IdentitySupabaseClient,
} from "./authenticated-identity-catalog";
import type { DbService, ServiceTableStore } from "./operational-rows";
import { REMOTE_SERVICE_COLUMNS, remoteServicePayload } from "./service-mapping";

const SERVICE_COLUMNS = REMOTE_SERVICE_COLUMNS.join(",");

export const SERVICE_WRITE_INSERT_ONLY_MESSAGE =
  "Service already exists; insert-only (no upsert)";

export type ServiceWriteQueryResult<T = unknown> = {
  data: T | null;
  error: { message: string } | null;
};

export interface AuthenticatedServiceWriteClient {
  auth: IdentitySupabaseClient["auth"];
  from(table: string): {
    select(columns: string): IdentityQueryBuilder;
    insert(payload: Record<string, unknown>): {
      select(columns: string): PromiseLike<ServiceWriteQueryResult>;
    };
  };
}

function requireRows<T>(result: ServiceWriteQueryResult<T>, action: string): T {
  if (result.error) {
    throw new Error(`${action}: ${result.error.message}`);
  }
  if (result.data == null) {
    throw new Error(`${action}: empty response`);
  }
  return result.data;
}

export class AuthenticatedServiceWriteStore implements ServiceTableStore {
  private readonly reads: AuthenticatedServiceReadStore;

  constructor(private readonly client: AuthenticatedServiceWriteClient) {
    this.reads = new AuthenticatedServiceReadStore(client as IdentitySupabaseClient);
  }

  async insertService(row: DbService): Promise<void> {
    const existing = await this.reads.getServiceByAppId(row.organization_id, row.app_id);
    if (existing) {
      throw new Error(SERVICE_WRITE_INSERT_ONLY_MESSAGE);
    }
    const payload = remoteServicePayload(row);
    const result = await this.client.from("services").insert(payload).select(SERVICE_COLUMNS);
    requireRows(result, "insert service");
  }

  updateService(): never {
    throw new ServiceWriteCreateOnlyError();
  }

  listServices(organizationDbId: string): Promise<DbService[]> {
    return this.reads.listServices(organizationDbId);
  }

  getServiceByAppId(
    organizationDbId: string,
    appId: string,
  ): Promise<DbService | undefined> {
    return this.reads.getServiceByAppId(organizationDbId, appId);
  }

  getServiceByDbId(dbId: string): Promise<DbService | undefined> {
    return this.reads.getServiceByDbId(dbId);
  }
}
