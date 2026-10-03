/**
 * Authenticated PostgREST service store.
 * Explicit QA / remote adapter path only — live Service UI stays local.
 * Never uses a service-role client. Insert is insert-only (no upsert).
 */

import { REMOTE_SERVICE_COLUMNS, remoteServicePayload } from "./service-mapping";
import type { DbService, ServiceTableStore } from "./operational-rows";

const SERVICE_COLUMNS = REMOTE_SERVICE_COLUMNS.join(",");

export const SERVICE_INSERT_ONLY_MESSAGE = "Service already exists; insert-only (no upsert)";

export type ServiceQueryResult<T = unknown> = {
  data: T | null;
  error: { message: string } | null;
};

export interface ServiceQueryBuilder<T = unknown>
  extends PromiseLike<ServiceQueryResult<T>> {
  eq(column: string, value: string): ServiceQueryBuilder<T>;
  select(columns: string): ServiceQueryBuilder<T>;
}

export interface AuthenticatedServiceSupabaseClient {
  from(table: string): {
    select(columns: string): ServiceQueryBuilder;
    insert(payload: Record<string, unknown>): ServiceQueryBuilder;
    update(payload: Record<string, unknown>): ServiceQueryBuilder;
  };
}

function requireRows<T>(result: ServiceQueryResult<T>, action: string): T {
  if (result.error) {
    throw new Error(`${action}: ${result.error.message}`);
  }
  if (result.data == null) {
    throw new Error(`${action}: empty response`);
  }
  return result.data;
}

function asServices(value: unknown): DbService[] {
  if (!Array.isArray(value)) return [];
  return value as DbService[];
}

export class AuthenticatedServiceTableStore implements ServiceTableStore {
  constructor(private readonly client: AuthenticatedServiceSupabaseClient) {}

  async insertService(row: DbService): Promise<void> {
    const existing = await this.getServiceByAppId(row.organization_id, row.app_id);
    if (existing) {
      throw new Error(SERVICE_INSERT_ONLY_MESSAGE);
    }
    const payload = remoteServicePayload(row);
    const result = await this.client.from("services").insert(payload).select(SERVICE_COLUMNS);
    requireRows(result, "insert service");
  }

  async updateService(row: DbService): Promise<void> {
    const payload = remoteServicePayload(row);
    const result = await this.client
      .from("services")
      .update(payload)
      .eq("id", row.id)
      .select(SERVICE_COLUMNS);
    requireRows(result, "update service");
  }

  async listServices(organizationDbId: string): Promise<DbService[]> {
    const result = await this.client
      .from("services")
      .select(SERVICE_COLUMNS)
      .eq("organization_id", organizationDbId);
    return asServices(requireRows(result, "list services"));
  }

  async getServiceByAppId(
    organizationDbId: string,
    appId: string,
  ): Promise<DbService | undefined> {
    const result = await this.client
      .from("services")
      .select(SERVICE_COLUMNS)
      .eq("organization_id", organizationDbId)
      .eq("app_id", appId);
    const rows = asServices(requireRows(result, "get service by app id"));
    return rows[0];
  }

  async getServiceByDbId(dbId: string): Promise<DbService | undefined> {
    const result = await this.client
      .from("services")
      .select(SERVICE_COLUMNS)
      .eq("id", dbId);
    const rows = asServices(requireRows(result, "get service by db id"));
    return rows[0];
  }
}
