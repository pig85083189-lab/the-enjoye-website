/**
 * Authenticated PostgREST treatment store.
 * Explicit remote adapter path only — live Treatment UI uses this store
 * when the Treatment remote-write pilot is on.
 * Never uses a service-role client. Insert is insert-only (no upsert).
 * Update is optimistic (id + organization_id + updated_at) and never upserts.
 */

import { TREATMENT_INSERT_ONLY_MESSAGE } from "@/lib/treatments/treatment-write-errors";
import {
  REMOTE_TREATMENT_COLUMNS,
  remoteTreatmentPayload,
  sanitizeTreatmentMutatePatch,
} from "./treatment-mapping";
import type {
  DbTreatment,
  TreatmentOptimisticUpdateInput,
  TreatmentTableStore,
} from "./operational-rows";

const TREATMENT_COLUMNS = REMOTE_TREATMENT_COLUMNS.join(",");

export const TREATMENT_UPDATE_UNSUPPORTED_MESSAGE =
  "Authenticated treatment client does not support update";

export type TreatmentQueryResult<T = unknown> = {
  data: T | null;
  error: { message: string } | null;
};

export interface TreatmentQueryBuilder<T = unknown>
  extends PromiseLike<TreatmentQueryResult<T>> {
  eq(column: string, value: string): TreatmentQueryBuilder<T>;
  select(columns: string): TreatmentQueryBuilder<T>;
}

export interface AuthenticatedTreatmentSupabaseClient {
  from(table: string): {
    select(columns: string): TreatmentQueryBuilder;
    insert(payload: Record<string, unknown>): TreatmentQueryBuilder;
    update?(payload: Record<string, unknown>): TreatmentQueryBuilder;
  };
}

function requireRows<T>(result: TreatmentQueryResult<T>, action: string): T {
  if (result.error) {
    throw new Error(`${action}: ${result.error.message}`);
  }
  if (result.data == null) {
    throw new Error(`${action}: empty response`);
  }
  return result.data;
}

function asTreatments(value: unknown): DbTreatment[] {
  if (!Array.isArray(value)) return [];
  return value as DbTreatment[];
}

export class AuthenticatedTreatmentTableStore implements TreatmentTableStore {
  constructor(private readonly client: AuthenticatedTreatmentSupabaseClient) {}

  async insertTreatment(row: DbTreatment): Promise<void> {
    const existing = await this.getTreatmentByAppId(row.organization_id, row.app_id);
    if (existing) {
      throw new Error(TREATMENT_INSERT_ONLY_MESSAGE);
    }
    const payload = remoteTreatmentPayload(row);
    const result = await this.client
      .from("treatments")
      .insert(payload)
      .select(TREATMENT_COLUMNS);
    requireRows(result, "insert treatment");
  }

  async listTreatments(organizationDbId: string): Promise<DbTreatment[]> {
    const result = await this.client
      .from("treatments")
      .select(TREATMENT_COLUMNS)
      .eq("organization_id", organizationDbId);
    return asTreatments(requireRows(result, "list treatments"));
  }

  async listTreatmentsByCustomer(
    organizationDbId: string,
    customerDbId: string,
  ): Promise<DbTreatment[]> {
    const result = await this.client
      .from("treatments")
      .select(TREATMENT_COLUMNS)
      .eq("organization_id", organizationDbId)
      .eq("customer_id", customerDbId);
    return asTreatments(requireRows(result, "list treatments by customer"));
  }

  async getTreatmentByAppId(
    organizationDbId: string,
    appId: string,
  ): Promise<DbTreatment | undefined> {
    const result = await this.client
      .from("treatments")
      .select(TREATMENT_COLUMNS)
      .eq("organization_id", organizationDbId)
      .eq("app_id", appId);
    const rows = asTreatments(requireRows(result, "get treatment by app id"));
    return rows[0];
  }

  async getTreatmentByDbId(dbId: string): Promise<DbTreatment | undefined> {
    const result = await this.client
      .from("treatments")
      .select(TREATMENT_COLUMNS)
      .eq("id", dbId);
    const rows = asTreatments(requireRows(result, "get treatment by db id"));
    return rows[0];
  }

  async getTreatmentByAppointmentId(
    organizationDbId: string,
    appointmentDbId: string,
  ): Promise<DbTreatment | undefined> {
    const result = await this.client
      .from("treatments")
      .select(TREATMENT_COLUMNS)
      .eq("organization_id", organizationDbId)
      .eq("appointment_id", appointmentDbId);
    const rows = asTreatments(requireRows(result, "get treatment by appointment"));
    return rows[0];
  }

  /**
   * Optimistic UPDATE: WHERE id = verified DB UUID AND organization_id AND
   * updated_at = expectedUpdatedAt. Returns 0 or 1 authoritative row.
   * Never upserts. Never uses a client-supplied UUID as the lookup key
   * without the caller first resolving org + app_id.
   */
  async updateTreatment(input: TreatmentOptimisticUpdateInput): Promise<DbTreatment[]> {
    if (!input.verifiedDbUuid?.trim()) {
      throw new Error("Treatment update requires a verified DB UUID");
    }
    if (!input.organizationDbId?.trim()) {
      throw new Error("Treatment update requires an authenticated organization UUID");
    }
    if (!input.expectedUpdatedAt?.trim()) {
      throw new Error("Treatment mutation requires expectedUpdatedAt");
    }
    const table = this.client.from("treatments");
    if (typeof table.update !== "function") {
      throw new Error(TREATMENT_UPDATE_UNSUPPORTED_MESSAGE);
    }
    const patch = sanitizeTreatmentMutatePatch(input.patch);
    const result = await table
      .update(patch)
      .eq("id", input.verifiedDbUuid)
      .eq("organization_id", input.organizationDbId)
      .eq("updated_at", input.expectedUpdatedAt)
      .select(TREATMENT_COLUMNS);
    if (result.error) {
      throw new Error(`update treatment: ${result.error.message}`);
    }
    return asTreatments(result.data ?? []);
  }
}
