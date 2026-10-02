/**
 * Authenticated, RLS-bound customer table access for the Phase 1C-3 read pilot.
 * Uses the publishable/session client only. Writes are refused.
 */

import type {
  IdentityQueryBuilder,
  IdentitySupabaseClient,
} from "./authenticated-identity-catalog";
import { REMOTE_CUSTOMER_COLUMNS } from "./customer-mapping";
import type { CustomerTableStore, DbCustomer, RemoteCustomerStatus } from "./operational-rows";

export const CUSTOMER_REMOTE_READ_ONLY_MESSAGE =
  "Phase 1C-3 Customer remote path is read-only";

export class CustomerRemoteReadOnlyError extends Error {
  constructor(message = CUSTOMER_REMOTE_READ_ONLY_MESSAGE) {
    super(message);
    this.name = "CustomerRemoteReadOnlyError";
  }
}

const CUSTOMER_SELECT = REMOTE_CUSTOMER_COLUMNS.join(", ");

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toRemoteStatus(value: unknown): RemoteCustomerStatus {
  if (value === "INACTIVE" || value === "ARCHIVED" || value === "ACTIVE") {
    return value;
  }
  return "ACTIVE";
}

export function dbCustomerFromUnknown(row: Record<string, unknown>): DbCustomer {
  const id = asString(row.id);
  const organization_id = asString(row.organization_id);
  const app_id = asString(row.app_id);
  const full_name = asString(row.full_name);
  const created_at = asString(row.created_at);
  const updated_at = asString(row.updated_at);
  if (!id || !organization_id || !app_id || !full_name || !created_at || !updated_at) {
    throw new Error("Remote customer row is missing required identity columns");
  }
  return {
    id,
    organization_id,
    app_id,
    full_name,
    phone: asNullableString(row.phone),
    email: asNullableString(row.email),
    birthday: asNullableString(row.birthday),
    gender: asNullableString(row.gender),
    line_user_id: asNullableString(row.line_user_id),
    source: asNullableString(row.source),
    membership_tier: asNullableString(row.membership_tier),
    is_vip: Boolean(row.is_vip),
    primary_staff_id: asNullableString(row.primary_staff_id),
    status: toRemoteStatus(row.status),
    notes: asNullableString(row.notes),
    created_at,
    updated_at,
  };
}

async function readCustomerRows(
  client: IdentitySupabaseClient,
  apply: (builder: IdentityQueryBuilder) => IdentityQueryBuilder,
): Promise<DbCustomer[]> {
  const result = await apply(client.from("customers").select(CUSTOMER_SELECT));
  if (result.error) {
    throw new Error(result.error.message);
  }
  return (result.data ?? []).map((row) =>
    dbCustomerFromUnknown(row as Record<string, unknown>),
  );
}

export class AuthenticatedCustomerReadStore implements CustomerTableStore {
  constructor(private readonly client: IdentitySupabaseClient) {}

  insertCustomer(): never {
    throw new CustomerRemoteReadOnlyError();
  }

  updateCustomer(): never {
    throw new CustomerRemoteReadOnlyError();
  }

  async listCustomers(organizationDbId: string): Promise<DbCustomer[]> {
    return readCustomerRows(this.client, (builder) =>
      builder.eq("organization_id", organizationDbId),
    );
  }

  async getCustomerByAppId(
    organizationDbId: string,
    appId: string,
  ): Promise<DbCustomer | undefined> {
    const rows = await readCustomerRows(this.client, (builder) =>
      builder.eq("organization_id", organizationDbId).eq("app_id", appId),
    );
    return rows[0];
  }

  async getCustomerByDbId(dbId: string): Promise<DbCustomer | undefined> {
    const rows = await readCustomerRows(this.client, (builder) => builder.eq("id", dbId));
    return rows[0];
  }

  async findCustomersByPhone(
    organizationDbId: string,
    phone: string,
  ): Promise<DbCustomer[]> {
    const rows = await this.listCustomers(organizationDbId);
    return rows.filter((row) => row.phone === phone);
  }
}
