/**
 * Authenticated, RLS-bound service table access for the Service read pilot.
 * Uses the publishable/session client only. Writes are refused.
 */

import type {
  IdentityQueryBuilder,
  IdentitySupabaseClient,
} from "./authenticated-identity-catalog";
import { REMOTE_SERVICE_COLUMNS } from "./service-mapping";
import type { DbService, RemoteServiceType, ServiceTableStore } from "./operational-rows";

export const SERVICE_REMOTE_READ_ONLY_MESSAGE =
  "Service remote path is read-only";

export class ServiceRemoteReadOnlyError extends Error {
  constructor(message = SERVICE_REMOTE_READ_ONLY_MESSAGE) {
    super(message);
    this.name = "ServiceRemoteReadOnlyError";
  }
}

const SERVICE_SELECT = REMOTE_SERVICE_COLUMNS.join(", ");

const REMOTE_SERVICE_TYPES = new Set<RemoteServiceType>([
  "BREAST",
  "BODY_SCULPTING",
  "FACIAL",
  "WOMB_CARE",
  "DETOX",
  "NAVEL_CANDLE",
  "EXFOLIATION",
  "WAXING",
  "OTHER",
]);

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toRemoteServiceType(value: unknown): RemoteServiceType {
  if (typeof value === "string" && REMOTE_SERVICE_TYPES.has(value as RemoteServiceType)) {
    return value as RemoteServiceType;
  }
  throw new Error("Remote service row has an unsupported service_type");
}

export function dbServiceFromUnknown(row: Record<string, unknown>): DbService {
  const id = asString(row.id);
  const organization_id = asString(row.organization_id);
  const app_id = asString(row.app_id);
  const name = asString(row.name);
  const duration_minutes = asNumber(row.duration_minutes);
  const created_at = asString(row.created_at);
  const updated_at = asString(row.updated_at);
  if (
    !id ||
    !organization_id ||
    !app_id ||
    !name ||
    duration_minutes == null ||
    !created_at ||
    !updated_at
  ) {
    throw new Error("Remote service row is missing required identity columns");
  }
  const price_minor = asNumber(row.price_minor);
  return {
    id,
    organization_id,
    app_id,
    name,
    service_type: toRemoteServiceType(row.service_type),
    duration_minutes,
    price_minor,
    currency: asString(row.currency) || "TWD",
    category: asNullableString(row.category),
    is_active: row.is_active !== false,
    created_at,
    updated_at,
  };
}

async function readServiceRows(
  client: IdentitySupabaseClient,
  apply: (builder: IdentityQueryBuilder) => IdentityQueryBuilder,
): Promise<DbService[]> {
  const result = await apply(client.from("services").select(SERVICE_SELECT));
  if (result.error) {
    throw new Error(result.error.message);
  }
  return (result.data ?? []).map((row) =>
    dbServiceFromUnknown(row as Record<string, unknown>),
  );
}

export class AuthenticatedServiceReadStore implements ServiceTableStore {
  constructor(private readonly client: IdentitySupabaseClient) {}

  insertService(): never {
    throw new ServiceRemoteReadOnlyError();
  }

  updateService(): never {
    throw new ServiceRemoteReadOnlyError();
  }

  async listServices(organizationDbId: string): Promise<DbService[]> {
    return readServiceRows(this.client, (builder) =>
      builder.eq("organization_id", organizationDbId),
    );
  }

  async getServiceByAppId(
    organizationDbId: string,
    appId: string,
  ): Promise<DbService | undefined> {
    const rows = await readServiceRows(this.client, (builder) =>
      builder.eq("organization_id", organizationDbId).eq("app_id", appId),
    );
    return rows[0];
  }

  async getServiceByDbId(dbId: string): Promise<DbService | undefined> {
    const rows = await readServiceRows(this.client, (builder) => builder.eq("id", dbId));
    return rows[0];
  }
}
