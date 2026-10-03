/**
 * Authenticated PostgREST customer store for the remote-create pilot.
 * Insert is insert-only (no upsert). Updates are refused.
 * Never uses a service-role client.
 */

import { AuthenticatedCustomerReadStore } from "./authenticated-customer-read-store";
import { REMOTE_CUSTOMER_COLUMNS, remoteCustomerPayload } from "./customer-mapping";
import type {
  IdentityQueryBuilder,
  IdentitySupabaseClient,
} from "./authenticated-identity-catalog";
import type { CustomerTableStore, DbCustomer } from "./operational-rows";
import { CustomerWriteCreateOnlyError } from "@/lib/customers/customer-write-guard";

const CUSTOMER_COLUMNS = REMOTE_CUSTOMER_COLUMNS.join(", ");

export const CUSTOMER_INSERT_ONLY_MESSAGE =
  "Customer already exists; insert-only (no upsert)";

export type CustomerWriteQueryResult<T = unknown> = {
  data: T | null;
  error: { message: string } | null;
};

export interface AuthenticatedCustomerWriteClient {
  auth: IdentitySupabaseClient["auth"];
  from(table: string): {
    select(columns: string): IdentityQueryBuilder;
    insert(payload: Record<string, unknown>): {
      select(columns: string): PromiseLike<CustomerWriteQueryResult>;
    };
  };
}

function requireRows<T>(result: CustomerWriteQueryResult<T>, action: string): T {
  if (result.error) {
    throw new Error(`${action}: ${result.error.message}`);
  }
  if (result.data == null) {
    throw new Error(`${action}: empty response`);
  }
  return result.data;
}

export class AuthenticatedCustomerWriteStore implements CustomerTableStore {
  private readonly reads: AuthenticatedCustomerReadStore;

  constructor(private readonly client: AuthenticatedCustomerWriteClient) {
    this.reads = new AuthenticatedCustomerReadStore(client as IdentitySupabaseClient);
  }

  async insertCustomer(row: DbCustomer): Promise<void> {
    const existing = await this.reads.getCustomerByAppId(row.organization_id, row.app_id);
    if (existing) {
      throw new Error(CUSTOMER_INSERT_ONLY_MESSAGE);
    }
    const payload = remoteCustomerPayload(row);
    const result = await this.client.from("customers").insert(payload).select(CUSTOMER_COLUMNS);
    requireRows(result, "insert customer");
  }

  updateCustomer(): never {
    throw new CustomerWriteCreateOnlyError();
  }

  listCustomers(organizationDbId: string): Promise<DbCustomer[]> {
    return this.reads.listCustomers(organizationDbId);
  }

  getCustomerByAppId(
    organizationDbId: string,
    appId: string,
  ): Promise<DbCustomer | undefined> {
    return this.reads.getCustomerByAppId(organizationDbId, appId);
  }

  getCustomerByDbId(dbId: string): Promise<DbCustomer | undefined> {
    return this.reads.getCustomerByDbId(dbId);
  }

  findCustomersByPhone(organizationDbId: string, phone: string): Promise<DbCustomer[]> {
    return this.reads.findCustomersByPhone(organizationDbId, phone);
  }
}
