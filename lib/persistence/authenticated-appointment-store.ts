/**
 * Authenticated PostgREST appointment store.
 * Explicit remote adapter path only — live Calendar / Today stay local.
 * Never uses a service-role client. Insert is insert-only (no upsert).
 * Update is optimistic (id + organization_id + updated_at) and never upserts.
 */

import {
  REMOTE_APPOINTMENT_COLUMNS,
  remoteAppointmentPayload,
  sanitizeAppointmentMutatePatch,
} from "./appointment-mapping";
import type {
  AppointmentOptimisticUpdateInput,
  AppointmentTableStore,
  DbAppointment,
} from "./operational-rows";

const APPOINTMENT_COLUMNS = REMOTE_APPOINTMENT_COLUMNS.join(",");

export const APPOINTMENT_INSERT_ONLY_MESSAGE =
  "Appointment already exists; insert-only (no upsert)";

export const APPOINTMENT_UPDATE_UNSUPPORTED_MESSAGE =
  "Authenticated appointment client does not support update";

export type AppointmentQueryResult<T = unknown> = {
  data: T | null;
  error: { message: string } | null;
};

export interface AppointmentQueryBuilder<T = unknown>
  extends PromiseLike<AppointmentQueryResult<T>> {
  eq(column: string, value: string): AppointmentQueryBuilder<T>;
  select(columns: string): AppointmentQueryBuilder<T>;
}

export interface AuthenticatedAppointmentSupabaseClient {
  from(table: string): {
    select(columns: string): AppointmentQueryBuilder;
    insert(payload: Record<string, unknown>): AppointmentQueryBuilder;
    update?(payload: Record<string, unknown>): AppointmentQueryBuilder;
  };
}

function requireRows<T>(result: AppointmentQueryResult<T>, action: string): T {
  if (result.error) {
    throw new Error(`${action}: ${result.error.message}`);
  }
  if (result.data == null) {
    throw new Error(`${action}: empty response`);
  }
  return result.data;
}

function asAppointments(value: unknown): DbAppointment[] {
  if (!Array.isArray(value)) return [];
  return value as DbAppointment[];
}

export class AuthenticatedAppointmentTableStore implements AppointmentTableStore {
  constructor(private readonly client: AuthenticatedAppointmentSupabaseClient) {}

  async insertAppointment(row: DbAppointment): Promise<void> {
    const existing = await this.getAppointmentByAppId(row.organization_id, row.app_id);
    if (existing) {
      throw new Error(APPOINTMENT_INSERT_ONLY_MESSAGE);
    }
    const payload = remoteAppointmentPayload(row);
    const result = await this.client
      .from("appointments")
      .insert(payload)
      .select(APPOINTMENT_COLUMNS);
    requireRows(result, "insert appointment");
  }

  async listAppointments(organizationDbId: string): Promise<DbAppointment[]> {
    const result = await this.client
      .from("appointments")
      .select(APPOINTMENT_COLUMNS)
      .eq("organization_id", organizationDbId);
    return asAppointments(requireRows(result, "list appointments"));
  }

  async getAppointmentByAppId(
    organizationDbId: string,
    appId: string,
  ): Promise<DbAppointment | undefined> {
    const result = await this.client
      .from("appointments")
      .select(APPOINTMENT_COLUMNS)
      .eq("organization_id", organizationDbId)
      .eq("app_id", appId);
    const rows = asAppointments(requireRows(result, "get appointment by app id"));
    return rows[0];
  }

  async getAppointmentByDbId(dbId: string): Promise<DbAppointment | undefined> {
    const result = await this.client
      .from("appointments")
      .select(APPOINTMENT_COLUMNS)
      .eq("id", dbId);
    const rows = asAppointments(requireRows(result, "get appointment by db id"));
    return rows[0];
  }

  /**
   * Optimistic UPDATE: WHERE id = verified DB UUID AND organization_id AND
   * updated_at = expectedUpdatedAt. Returns 0 or 1 authoritative row.
   * Never upserts. Never uses a client-supplied UUID as the lookup key
   * without the caller first resolving org + app_id.
   */
  async updateAppointment(input: AppointmentOptimisticUpdateInput): Promise<DbAppointment[]> {
    if (!input.verifiedDbUuid?.trim()) {
      throw new Error("Appointment update requires a verified DB UUID");
    }
    if (!input.organizationDbId?.trim()) {
      throw new Error("Appointment update requires an authenticated organization UUID");
    }
    if (!input.expectedUpdatedAt?.trim()) {
      throw new Error("Appointment mutation requires expectedUpdatedAt");
    }
    const table = this.client.from("appointments");
    if (typeof table.update !== "function") {
      throw new Error(APPOINTMENT_UPDATE_UNSUPPORTED_MESSAGE);
    }
    const patch = sanitizeAppointmentMutatePatch(input.patch);
    const result = await table
      .update(patch)
      .eq("id", input.verifiedDbUuid)
      .eq("organization_id", input.organizationDbId)
      .eq("updated_at", input.expectedUpdatedAt)
      .select(APPOINTMENT_COLUMNS);
    if (result.error) {
      throw new Error(`update appointment: ${result.error.message}`);
    }
    return asAppointments(result.data ?? []);
  }
}
