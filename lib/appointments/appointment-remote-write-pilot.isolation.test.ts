import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CALENDAR_REMOTE_READ_PILOT_ENV } from "./calendar-remote-read-flag";
import {
  APPOINTMENT_REMOTE_WRITE_PILOT_ENV,
  AppointmentWriteCreateOnlyError,
  AppointmentWritePilotDeniedError,
  assertAppointmentWritePilotOwner,
  createAuthenticatedAppointmentWritePersistence,
  isAppointmentRemoteWritePilotEnabled,
  refuseAppointmentWriteMutation,
  runAuthenticatedAppointmentWriteCreate,
  type AppointmentWriteClient,
} from "./appointment-remote-write-pilot";
import { FUTURE_QA_APPOINTMENT } from "./remote-readiness";
import {
  emitAppointmentRemoteWriteRefresh,
  getAppointmentRemoteWriteRevision,
  resetAppointmentRemoteWriteRevisionForTests,
} from "./appointment-write-refresh";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
} from "@/lib/persistence/authenticated-identity-catalog";
import type { AppointmentQueryBuilder, AppointmentQueryResult } from "@/lib/persistence/authenticated-appointment-store";
import { getPersistenceDriver } from "@/lib/persistence/driver";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";

type Row = Record<string, unknown>;
type FilterOp = "eq" | "in" | "gte" | "lte" | "gt" | "lt";

class FakeQuery implements IdentityQueryBuilder, AppointmentQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly filters: Array<{
      column: string;
      value?: string;
      values?: string[];
      op?: FilterOp;
    }> = [],
    private readonly pendingInsert: Row | null = null,
    private readonly write: ((row: Row) => void) | null = null,
  ) {}

  eq(column: string, value: string): this {
    return new FakeQuery(
      this.rows,
      [...this.filters, { column, value, op: "eq" }],
      this.pendingInsert,
      this.write,
    ) as this;
  }

  in(column: string, values: string[]): this {
    return new FakeQuery(this.rows, [...this.filters, { column, values, op: "in" }]) as this;
  }

  gte(column: string, value: string): this {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "gte" }]) as this;
  }

  lte(column: string, value: string): this {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "lte" }]) as this;
  }

  gt(column: string, value: string): this {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "gt" }]) as this;
  }

  lt(column: string, value: string): this {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "lt" }]) as this;
  }

  select(): this {
    return this;
  }

  then<TResult1 = IdentityQueryResult & AppointmentQueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: IdentityQueryResult & AppointmentQueryResult) => TResult1 | PromiseLike<TResult1>)
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
      this.filters.every((filter) => {
        if (filter.values) return filter.values.includes(String(row[filter.column]));
        return String(row[filter.column]) === String(filter.value);
      }),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function validTables(role = "OWNER"): Record<string, Row[]> {
  return {
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
        full_name: FUTURE_QA_APPOINTMENT.customerName,
      },
    ],
    services: [
      {
        id: FUTURE_QA_APPOINTMENT.serviceDbId,
        app_id: FUTURE_QA_APPOINTMENT.serviceAppId,
        organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
        name: FUTURE_QA_APPOINTMENT.serviceName,
      },
    ],
    appointments: [],
  };
}

function writeClient(role = "OWNER"): AppointmentWriteClient {
  const tables = validTables(role);
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
      };
    },
  };
}

const WRITE_ON = {
  [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
  [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
};

describe("Phase 1C-6B.1 appointment remote write foundation", () => {
  beforeEach(() => {
    resetAppointmentRemoteWriteRevisionForTests();
  });

  it("does not require global persistence and stays off in production", () => {
    expect(getPersistenceDriver({})).toBe("local");
    expect(isAppointmentRemoteWritePilotEnabled({})).toBe(false);
    expect(isAppointmentRemoteWritePilotEnabled(WRITE_ON)).toBe(true);
    expect(
      isAppointmentRemoteWritePilotEnabled({
        ...WRITE_ON,
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
    expect(
      isAppointmentRemoteWritePilotEnabled({
        ...WRITE_ON,
        VERCEL_TARGET_ENV: "production",
      }),
    ).toBe(false);
    expect(
      isAppointmentRemoteWritePilotEnabled({
        [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe(false);
    expect(
      getPersistenceDriver({
        [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe("local");
  });

  it("Owner guard allows OWNER and denies every other current staff role", () => {
    expect(() => assertAppointmentWritePilotOwner("OWNER")).not.toThrow();
    for (const role of ["MANAGER", "STAFF", "RECEPTIONIST", "ACCOUNTANT"]) {
      expect(() => assertAppointmentWritePilotOwner(role)).toThrow(AppointmentWritePilotDeniedError);
    }
  });

  it("create-only boundary refuses update/reschedule/cancel/status/delete", async () => {
    const persistence = await createAuthenticatedAppointmentWritePersistence(writeClient());
    expect(() => persistence.update()).toThrow(AppointmentWriteCreateOnlyError);
    expect(() => persistence.reschedule()).toThrow(AppointmentWriteCreateOnlyError);
    expect(() => persistence.cancel()).toThrow(AppointmentWriteCreateOnlyError);
    expect(() => persistence.changeStatus()).toThrow(AppointmentWriteCreateOnlyError);
    expect(() => persistence.delete()).toThrow(AppointmentWriteCreateOnlyError);
    expect(() => refuseAppointmentWriteMutation("update")).toThrow(/create-only/);
  });

  it("prepares BOOKED create with canonical snapshots and mapped identities", async () => {
    const persistence = await createAuthenticatedAppointmentWritePersistence(writeClient());
    const prepared = persistence.prepare({
      organizationId: FUTURE_QA_APPOINTMENT.organizationAppId,
      locationId: FUTURE_QA_APPOINTMENT.locationAppId,
      customerId: FUTURE_QA_APPOINTMENT.customerAppId,
      serviceId: FUTURE_QA_APPOINTMENT.serviceAppId,
      staffId: FUTURE_QA_APPOINTMENT.staffAppId,
      appointmentId: "apt-prep01-abcdef",
      dateYmd: "2026-10-16",
      startHm: "10:00",
      durationMinutes: 100,
      customerName: "UI Fake Customer",
      serviceName: "UI Fake Service",
      staffName: "UI Fake Staff",
      status: "CANCELLED",
    });
    expect(prepared.status).toBe("BOOKED");
    expect(prepared.customerName).toBe(FUTURE_QA_APPOINTMENT.customerName);
    expect(prepared.serviceName).toBe(FUTURE_QA_APPOINTMENT.serviceName);
    expect(prepared.staffName).toBe(FUTURE_QA_APPOINTMENT.staffName);
    expect(prepared.staffId).toBe(FUTURE_QA_APPOINTMENT.staffAppId);
    expect(prepared.createdBy).toBe(FUTURE_QA_APPOINTMENT.staffAppId);
    expect(prepared.startAt).toBe("2026-10-16T02:00:00.000Z");
    expect(prepared.endAt).toBe("2026-10-16T03:40:00.000Z");
    const created = await persistence.create(prepared);
    expect(created.appointment.id).toBe("apt-prep01-abcdef");
    expect(created.appointment.status).toBe("BOOKED");
    expect(created.appointment.id).not.toBe(
      (created.appointment as { dbId?: string }).dbId ?? created.appointment.createdAt,
    );
  });

  it("run path stays off unless the write flag is on and the actor is Owner", async () => {
    await expect(
      runAuthenticatedAppointmentWriteCreate(writeClient(), {
        organizationId: FUTURE_QA_APPOINTMENT.organizationAppId,
        locationId: FUTURE_QA_APPOINTMENT.locationAppId,
        customerId: FUTURE_QA_APPOINTMENT.customerAppId,
        serviceId: FUTURE_QA_APPOINTMENT.serviceAppId,
        staffId: FUTURE_QA_APPOINTMENT.staffAppId,
        dateYmd: "2026-10-16",
        startHm: "14:00",
        durationMinutes: 60,
      }),
    ).rejects.toThrow(/pilot is off/);
    await expect(
      runAuthenticatedAppointmentWriteCreate(
        writeClient("MANAGER"),
        {
          organizationId: FUTURE_QA_APPOINTMENT.organizationAppId,
          locationId: FUTURE_QA_APPOINTMENT.locationAppId,
          customerId: FUTURE_QA_APPOINTMENT.customerAppId,
          serviceId: FUTURE_QA_APPOINTMENT.serviceAppId,
          staffId: FUTURE_QA_APPOINTMENT.staffAppId,
          dateYmd: "2026-10-16",
          startHm: "14:00",
          durationMinutes: 60,
        },
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(AppointmentWritePilotDeniedError);
  });

  it("emits a refresh revision for Calendar / 360 / Today request keys", () => {
    expect(getAppointmentRemoteWriteRevision()).toBe(0);
    emitAppointmentRemoteWriteRefresh({
      organizationId: FUTURE_QA_APPOINTMENT.organizationAppId,
      customerId: FUTURE_QA_APPOINTMENT.customerAppId,
      locationId: FUTURE_QA_APPOINTMENT.locationAppId,
      startAt: "2026-10-09T02:00:00.000Z",
    });
    expect(getAppointmentRemoteWriteRevision()).toBe(1);
    const calendar = readFileSync(
      path.join(process.cwd(), "features/calendar/use-calendar-remote-read.ts"),
      "utf8",
    );
    const tab = readFileSync(
      path.join(process.cwd(), "features/customers/use-appointment-remote-read.ts"),
      "utf8",
    );
    const today = readFileSync(
      path.join(process.cwd(), "features/today/use-today-remote-read.ts"),
      "utf8",
    );
    expect(calendar).toMatch(/useAppointmentRemoteWriteRevision/);
    expect(tab).toMatch(/useAppointmentRemoteWriteRevision/);
    expect(today).toMatch(/useAppointmentRemoteWriteRevision/);
  });

  it("keeps the write graph out of Calendar RSC and live mutation surfaces", () => {
    const page = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/calendar/page.tsx"),
      "utf8",
    );
    const calendar = readFileSync(
      path.join(process.cwd(), "features/calendar/CalendarPage.tsx"),
      "utf8",
    );
    const flag = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-remote-write-flag.ts"),
      "utf8",
    );
    const factory = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-remote-write-pilot.ts"),
      "utf8",
    );
    const create = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-write-create.ts"),
      "utf8",
    );
    expect(page).toMatch(/calendar-remote-read-flag|appointment-remote-write-flag/);
    expect(page).not.toMatch(/appointment-remote-write-pilot|AuthenticatedAppointmentTableStore|AppointmentRemoteAdapter/);
    expect(calendar).not.toMatch(
      /createAuthenticatedAppointmentWritePersistence|AuthenticatedAppointmentTableStore|AppointmentRemoteAdapter/,
    );
    expect(calendar).toMatch(/createAppointment/);
    expect(calendar).toMatch(/use-calendar-remote-write|submitCalendarRemoteAppointmentCreate/);
    expect(flag).not.toMatch(
      /AppointmentRemoteAdapter|AuthenticatedAppointmentTableStore|loadAuthenticatedIdentityCatalog|createServiceRoleClient/,
    );
    expect(factory).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(factory).not.toMatch(/createRemoteOperationalPersistence/);
    expect(factory).toMatch(/Does not enable BEAUTY_OS_PERSISTENCE/);
    expect(create).not.toMatch(/from\(["']@\/lib\/appointments\/store["']\)|createAppointment\(/);
    expect(create).not.toMatch(/\.upsert\(/);
    expect(existsSync(path.join(process.cwd(), "app/staff/appointment-bootstrap/page.tsx"))).toBe(
      false,
    );
    for (const file of [
      "features/treatments/TreatmentWorkspace.tsx",
      "features/checkout/CheckoutPageClient.tsx",
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(
        /createAuthenticatedAppointmentWritePersistence|runAuthenticatedAppointmentWriteCreate|BEAUTY_OS_APPOINTMENT_REMOTE_WRITE_PILOT/,
      );
    }
  });
});
