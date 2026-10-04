/**
 * Authenticated, RLS-bound treatment table access for the Phase 1C-6G
 * read foundation. Uses the publishable/session client only.
 * Writes are refused.
 */

import type {
  IdentityQueryBuilder,
  IdentitySupabaseClient,
} from "./authenticated-identity-catalog";
import { REMOTE_TREATMENT_COLUMNS } from "./treatment-mapping";
import type { DbTreatment, TreatmentTableStore } from "./operational-rows";

export const TREATMENT_REMOTE_READ_ONLY_MESSAGE =
  "Phase 1C-6G Treatment remote path is read-only";

export class TreatmentRemoteReadOnlyError extends Error {
  constructor(message = TREATMENT_REMOTE_READ_ONLY_MESSAGE) {
    super(message);
    this.name = "TreatmentRemoteReadOnlyError";
  }
}

const TREATMENT_SELECT = REMOTE_TREATMENT_COLUMNS.join(",");

export class AuthenticatedTreatmentReadStore implements TreatmentTableStore {
  constructor(private readonly client: IdentitySupabaseClient) {}

  insertTreatment(): never {
    throw new TreatmentRemoteReadOnlyError();
  }

  async listTreatments(organizationDbId: string): Promise<DbTreatment[]> {
    return this.readRows((builder) => builder.eq("organization_id", organizationDbId));
  }

  async listTreatmentsByCustomer(
    organizationDbId: string,
    customerDbId: string,
  ): Promise<DbTreatment[]> {
    return this.readRows((builder) =>
      builder.eq("organization_id", organizationDbId).eq("customer_id", customerDbId),
    );
  }

  async getTreatmentByAppId(
    organizationDbId: string,
    appId: string,
  ): Promise<DbTreatment | undefined> {
    const rows = await this.readRows((builder) =>
      builder.eq("organization_id", organizationDbId).eq("app_id", appId),
    );
    return rows[0];
  }

  async getTreatmentByDbId(dbId: string): Promise<DbTreatment | undefined> {
    const rows = await this.readRows((builder) => builder.eq("id", dbId));
    return rows[0];
  }

  async getTreatmentByAppointmentId(
    organizationDbId: string,
    appointmentDbId: string,
  ): Promise<DbTreatment | undefined> {
    const rows = await this.readRows((builder) =>
      builder.eq("organization_id", organizationDbId).eq("appointment_id", appointmentDbId),
    );
    return rows[0];
  }

  updateTreatment(): never {
    throw new TreatmentRemoteReadOnlyError();
  }

  private async readRows(
    apply: (builder: IdentityQueryBuilder) => IdentityQueryBuilder,
  ): Promise<DbTreatment[]> {
    const result = await apply(this.client.from("treatments").select(TREATMENT_SELECT));
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data ?? []) as unknown as DbTreatment[];
  }
}
