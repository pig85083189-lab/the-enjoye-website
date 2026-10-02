/**
 * Authenticated PostgREST customer store.
 * Explicit QA / remote adapter path only — live UI stays on local stores.
 * Never uses a service-role client. Insert is insert-only (no upsert).
 */

import { phonesMatch } from "@/lib/phone";
import {
  REMOTE_CUSTOMER_COLUMNS,
  remoteCustomerPayload,
} from "./customer-mapping";
import type { CustomerTableStore, DbCustomer } from "./operational-rows";

const CUSTOMER_COLUMNS = REMOTE_CUSTOMER_COLUMNS.join(",");

export type CustomerQueryResult<T = unknown> = {
  data: T | null;
  error: { message: string } | null;
};

export interface CustomerQueryBuilder<T = unknown>
  extends PromiseLike<CustomerQueryResult<T>> {
  eq(column: string, value: string): CustomerQueryBuilder<T>;
  select(columns: string): CustomerQueryBuilder<T>;
}

export interface AuthenticatedCustomerSupabaseClient {
  from(table: string): {
    select(columns: string): CustomerQueryBuilder;
    insert(payload: Record<string, unknown>): CustomerQueryBuilder;
    update(payload: Record<string, unknown>): CustomerQueryBuilder;
  };
}

function requireRows<T>(result: CustomerQueryResult<T>, action: string): T {
  if (result.error) {
    throw new Error(`${action}: ${result.error.message}`);
  }
  if (result.data == null) {
    throw new Error(`${action}: empty response`);
  }
  return result.data;
}

function asCustomers(value: unknown): DbCustomer[] {
  if (!Array.isArray(value)) return [];
  return value as DbCustomer[];
}

export class AuthenticatedCustomerTableStore implements CustomerTableStore {
  constructor(private readonly client: AuthenticatedCustomerSupabaseClient) {}

  async insertCustomer(row: DbCustomer): Promise<void> {
    const existing = await this.getCustomerByAppId(row.organization_id, row.app_id);
    if (existing) {
      throw new Error("Customer already exists; insert-only (no upsert)");
    }
    const payload = remoteCustomerPayload(row);
    const result = await this.client.from("customers").insert(payload).select(CUSTOMER_COLUMNS);
    requireRows(result, "insert customer");
  }

  async updateCustomer(row: DbCustomer): Promise<void> {
    const payload = remoteCustomerPayload(row);
    const result = await this.client
      .from("customers")
      .update(payload)
      .eq("id", row.id)
      .select(CUSTOMER_COLUMNS);
    requireRows(result, "update customer");
  }

  async listCustomers(organizationDbId: string): Promise<DbCustomer[]> {
    const result = await this.client
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .eq("organization_id", organizationDbId);
    return asCustomers(requireRows(result, "list customers"));
  }

  async getCustomerByAppId(
    organizationDbId: string,
    appId: string,
  ): Promise<DbCustomer | undefined> {
    const result = await this.client
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .eq("organization_id", organizationDbId)
      .eq("app_id", appId);
    const rows = asCustomers(requireRows(result, "get customer by app id"));
    return rows[0];
  }

  async getCustomerByDbId(dbId: string): Promise<DbCustomer | undefined> {
    const result = await this.client
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .eq("id", dbId);
    const rows = asCustomers(requireRows(result, "get customer by db id"));
    return rows[0];
  }

  async findCustomersByPhone(organizationDbId: string, phone: string): Promise<DbCustomer[]> {
    const rows = await this.listCustomers(organizationDbId);
    return rows.filter((row) => row.phone != null && phonesMatch(row.phone, phone));
  }
}
