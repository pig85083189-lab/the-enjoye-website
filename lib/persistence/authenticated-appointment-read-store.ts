/**
 * Authenticated, RLS-bound appointment table access for the Phase 1C-5C read pilot.
 * Uses the publishable/session client only. Writes are refused.
 */

import type {
  IdentityQueryBuilder,
  IdentitySupabaseClient,
} from "./authenticated-identity-catalog";
import { REMOTE_APPOINTMENT_COLUMNS } from "./appointment-mapping";
import type { AppointmentTableStore, DbAppointment } from "./operational-rows";

export const APPOINTMENT_REMOTE_READ_ONLY_MESSAGE =
  "Phase 1C-5C Appointment remote path is read-only";

export class AppointmentRemoteReadOnlyError extends Error {
  constructor(message = APPOINTMENT_REMOTE_READ_ONLY_MESSAGE) {
    super(message);
    this.name = "AppointmentRemoteReadOnlyError";
  }
}

const APPOINTMENT_SELECT = REMOTE_APPOINTMENT_COLUMNS.join(",");

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function dbAppointmentFromUnknown(row: Record<string, unknown>): DbAppointment {
  const id = asString(row.id);
  const organization_id = asString(row.organization_id);
  const location_id = asString(row.location_id);
  const customer_id = asString(row.customer_id);
  const service_id = asString(row.service_id);
  const app_id = asString(row.app_id);
  const starts_at = asString(row.starts_at);
  const ends_at = asString(row.ends_at);
  const status = asString(row.status);
  const created_at = asString(row.created_at);
  const updated_at = asString(row.updated_at);
  if (
    !id ||
    !organization_id ||
    !location_id ||
    !customer_id ||
    !service_id ||
    !app_id ||
    !starts_at ||
    !ends_at ||
    !status ||
    !created_at ||
    !updated_at
  ) {
    throw new Error("Remote appointment row is missing required identity columns");
  }
  return {
    id,
    organization_id,
    location_id,
    customer_id,
    service_id,
    staff_id: asNullableString(row.staff_id),
    app_id,
    starts_at,
    ends_at,
    duration_minutes: asNullableNumber(row.duration_minutes),
    status,
    customer_note: asNullableString(row.customer_note),
    internal_note: asNullableString(row.internal_note),
    customer_name_snapshot: asNullableString(row.customer_name_snapshot),
    service_name_snapshot: asNullableString(row.service_name_snapshot),
    staff_name_snapshot: asNullableString(row.staff_name_snapshot),
    status_reason: asNullableString(row.status_reason),
    cancelled_at: asNullableString(row.cancelled_at),
    cancelled_by: asNullableString(row.cancelled_by),
    created_by: asNullableString(row.created_by),
    updated_by: asNullableString(row.updated_by),
    created_at,
    updated_at,
  };
}

async function readAppointmentRows(
  client: IdentitySupabaseClient,
  apply: (builder: IdentityQueryBuilder) => IdentityQueryBuilder,
): Promise<DbAppointment[]> {
  const result = await apply(client.from("appointments").select(APPOINTMENT_SELECT));
  if (result.error) {
    throw new Error(result.error.message);
  }
  return (result.data ?? []).map((row) =>
    dbAppointmentFromUnknown(row as Record<string, unknown>),
  );
}

export class AuthenticatedAppointmentReadStore implements AppointmentTableStore {
  constructor(private readonly client: IdentitySupabaseClient) {}

  insertAppointment(): never {
    throw new AppointmentRemoteReadOnlyError();
  }

  async listAppointments(organizationDbId: string): Promise<DbAppointment[]> {
    return readAppointmentRows(this.client, (builder) =>
      builder.eq("organization_id", organizationDbId),
    );
  }

  async listAppointmentsByCustomer(
    organizationDbId: string,
    customerDbId: string,
  ): Promise<DbAppointment[]> {
    return readAppointmentRows(this.client, (builder) =>
      builder.eq("organization_id", organizationDbId).eq("customer_id", customerDbId),
    );
  }

  async getAppointmentByAppId(
    organizationDbId: string,
    appId: string,
  ): Promise<DbAppointment | undefined> {
    const rows = await readAppointmentRows(this.client, (builder) =>
      builder.eq("organization_id", organizationDbId).eq("app_id", appId),
    );
    return rows[0];
  }

  async getAppointmentByDbId(dbId: string): Promise<DbAppointment | undefined> {
    const rows = await readAppointmentRows(this.client, (builder) => builder.eq("id", dbId));
    return rows[0];
  }
}
