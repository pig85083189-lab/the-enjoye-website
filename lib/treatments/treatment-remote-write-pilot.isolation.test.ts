import { describe, expect, it } from "vitest";
import {
  assertTreatmentWriteRole,
  isTreatmentRemoteWritePilotEnabled,
  runAuthenticatedTreatmentCreate,
  TreatmentWritePilotDeniedError,
  TREATMENT_REMOTE_WRITE_PILOT_ENV,
} from "./treatment-remote-write-pilot";
import { TREATMENT_REMOTE_READ_PILOT_ENV } from "./treatment-remote-read-flag";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
} from "@/lib/persistence/authenticated-identity-catalog";
import type {
  TreatmentQueryBuilder,
  TreatmentQueryResult,
} from "@/lib/persistence/authenticated-treatment-store";
import type { TreatmentWriteClient } from "./treatment-remote-write-pilot";
import { FUTURE_QA_APPOINTMENT } from "@/lib/appointments/remote-readiness";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const WRITE_ON = {
  [TREATMENT_REMOTE_READ_PILOT_ENV]: "1",
  [TREATMENT_REMOTE_WRITE_PILOT_ENV]: "1",
};

type Row = Record<string, unknown>;

class FakeQuery implements IdentityQueryBuilder, TreatmentQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly filters: Array<{ column: string; value: string }> = [],
    private readonly pendingInsert: Row | null = null,
    private readonly write: ((row: Row) => void) | null = null,
  ) {}

  eq(column: string, value: string): this {
    return new FakeQuery(
      this.rows,
      [...this.filters, { column, value }],
      this.pendingInsert,
      this.write,
    ) as this;
  }

  in(): this {
    return this;
  }
  gte(): this {
    return this;
  }
  lte(): this {
    return this;
  }
  gt(): this {
    return this;
  }
  lt(): this {
    return this;
  }

  select(): this {
    return this;
  }

  then<TResult1 = IdentityQueryResult & TreatmentQueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: IdentityQueryResult & TreatmentQueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.pendingInsert && this.write) {
      this.write(this.pendingInsert);
      return Promise.resolve({ data: [this.pendingInsert], error: null }).then(
        onfulfilled,
        onrejected,
      );
    }
    const data = this.rows.filter((row) =>
      this.filters.every((filter) => String(row[filter.column]) === String(filter.value)),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function writeClient(role = "OWNER"): TreatmentWriteClient {
  const tables: Record<string, Row[]> = {
    staff_auth_memberships: [
      {
        id: "mem-enjoye-owner",
        user_id: FUTURE_QA_APPOINTMENT.staffAppId,
        auth_user_id: AUTH_UUID,
        organization_id: FUTURE_QA_APPOINTMENT.organizationAppId,
        role,
        is_active: true,
        display_name: FUTURE_QA_APPOINTMENT.staffName,
      },
    ],
    organizations: [
      {
        id: FUTURE_QA_APPOINTMENT.organizationDbId,
        app_id: FUTURE_QA_APPOINTMENT.organizationAppId,
      },
    ],
    locations: [
      {
        id: FUTURE_QA_APPOINTMENT.locationDbId,
        app_id: FUTURE_QA_APPOINTMENT.locationAppId,
        organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
      },
    ],
    customers: [
      {
        id: FUTURE_QA_APPOINTMENT.customerDbId,
        app_id: FUTURE_QA_APPOINTMENT.customerAppId,
        organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
      },
    ],
    services: [
      {
        id: FUTURE_QA_APPOINTMENT.serviceDbId,
        app_id: FUTURE_QA_APPOINTMENT.serviceAppId,
        organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
      },
    ],
    appointments: [],
    treatments: [],
  };
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: AUTH_UUID } }, error: null };
      },
    },
    from(table: string) {
      return {
        select() {
          return new FakeQuery(tables[table] ?? []);
        },
        insert(payload: Record<string, unknown>) {
          return new FakeQuery(tables[table] ?? [], [], payload, (row) => {
            tables[table] = [...(tables[table] ?? []), row];
          });
        },
        update(payload: Record<string, unknown>) {
          return new FakeQuery(tables[table] ?? [], [], payload);
        },
      };
    },
  };
}

describe("Phase 1C-6G Treatment remote write pilot", () => {
  it("keeps ACCOUNTANT denied and operational salon roles allowed", () => {
    for (const role of ["OWNER", "MANAGER", "STAFF", "RECEPTIONIST"] as const) {
      expect(() => assertTreatmentWriteRole({ role, isActive: true })).not.toThrow();
    }
    expect(() => assertTreatmentWriteRole({ role: "ACCOUNTANT", isActive: true })).toThrow(
      TreatmentWritePilotDeniedError,
    );
    expect(isTreatmentRemoteWritePilotEnabled({})).toBe(false);
  });

  it("run path stays off unless both Treatment pilots are on", async () => {
    await expect(
      runAuthenticatedTreatmentCreate(writeClient(), {
        locationId: FUTURE_QA_APPOINTMENT.locationAppId,
        customerId: FUTURE_QA_APPOINTMENT.customerAppId,
        serviceId: FUTURE_QA_APPOINTMENT.serviceAppId,
        staffId: FUTURE_QA_APPOINTMENT.staffAppId,
        id: "trt-pilot1-abcdef",
      }),
    ).rejects.toThrow(/pilot is off/);
  });

  it("lets operational roles create a remote draft and denies ACCOUNTANT", async () => {
    const created = await runAuthenticatedTreatmentCreate(
      writeClient("STAFF"),
      {
        locationId: FUTURE_QA_APPOINTMENT.locationAppId,
        customerId: FUTURE_QA_APPOINTMENT.customerAppId,
        serviceId: FUTURE_QA_APPOINTMENT.serviceAppId,
        staffId: FUTURE_QA_APPOINTMENT.staffAppId,
        id: "trt-pilot2-abcdef",
      },
      WRITE_ON,
    );
    expect(created.id).toBe("trt-pilot2-abcdef");
    expect(created.status).toBe("draft");
    expect(created.customerId).toBe(FUTURE_QA_APPOINTMENT.customerAppId);
    await expect(
      runAuthenticatedTreatmentCreate(
        writeClient("ACCOUNTANT"),
        {
          locationId: FUTURE_QA_APPOINTMENT.locationAppId,
          customerId: FUTURE_QA_APPOINTMENT.customerAppId,
          serviceId: FUTURE_QA_APPOINTMENT.serviceAppId,
          staffId: FUTURE_QA_APPOINTMENT.staffAppId,
          id: "trt-pilot3-abcdef",
        },
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(TreatmentWritePilotDeniedError);
  });
});
