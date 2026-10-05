import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CALENDAR_REMOTE_READ_PILOT_ENV } from "./calendar-remote-read-flag";
import { APPOINTMENT_REMOTE_WRITE_PILOT_ENV } from "./appointment-remote-write-flag";
import {
  APPOINTMENT_REMOTE_MUTATE_PILOT_ENV,
  AppointmentWriteStaleError,
  createAuthenticatedAppointmentMutatePersistence,
  isAppointmentRemoteMutatePilotEnabled,
  runAuthenticatedAppointmentWriteMutate,
  type AppointmentMutateClient,
} from "./appointment-remote-mutate-pilot";
import {
  AppointmentWriteCreateOnlyError,
  AppointmentWritePilotDeniedError,
  createAuthenticatedAppointmentWritePersistence,
  type AppointmentWriteClient,
} from "./appointment-remote-write-pilot";
import { FUTURE_QA_APPOINTMENT } from "./remote-readiness";
import {
  getAppointmentRemoteWriteRevision,
  resetAppointmentRemoteWriteRevisionForTests,
} from "./appointment-write-refresh";
import { IdentityCatalogError } from "@/lib/persistence/identity-errors";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
} from "@/lib/persistence/authenticated-identity-catalog";
import type {
  AppointmentQueryBuilder,
  AppointmentQueryResult,
} from "@/lib/persistence/authenticated-appointment-store";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const OTHER_LOCATION_APP = "loc-other-unauth";
const OTHER_LOCATION_DB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
    private readonly pendingUpdate: Row | null = null,
    private readonly write: ((row: Row) => void) | null = null,
  ) {}

  eq(column: string, value: string): this {
    return new FakeQuery(
      this.rows,
      [...this.filters, { column, value, op: "eq" }],
      this.pendingInsert,
      this.pendingUpdate,
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
    if (this.pendingUpdate) {
      const matches = this.rows.filter((row) =>
        this.filters.every((filter) => String(row[filter.column]) === String(filter.value)),
      );
      const updated = matches.map((row) => {
        const next = {
          ...row,
          ...this.pendingUpdate,
          updated_at: "2026-10-03T01:00:00.000Z",
        };
        Object.assign(row, next);
        return next;
      });
      return Promise.resolve({ data: updated, error: null }).then(onfulfilled, onrejected);
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

function appointmentRow(overrides: Row = {}): Row {
  return {
    id: "b92c54a1-000e-4cf1-bbd3-837ce3312559",
    organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
    location_id: FUTURE_QA_APPOINTMENT.locationDbId,
    customer_id: FUTURE_QA_APPOINTMENT.customerDbId,
    service_id: FUTURE_QA_APPOINTMENT.serviceDbId,
    staff_id: FUTURE_QA_APPOINTMENT.staffAppId,
    app_id: "apt-muqrindw-yt0l5z",
    starts_at: "2026-10-09T02:00:00.000Z",
    ends_at: "2026-10-09T03:40:00.000Z",
    duration_minutes: 100,
    status: "BOOKED",
    customer_note: null,
    internal_note: null,
    customer_name_snapshot: FUTURE_QA_APPOINTMENT.customerName,
    service_name_snapshot: FUTURE_QA_APPOINTMENT.serviceName,
    staff_name_snapshot: FUTURE_QA_APPOINTMENT.staffName,
    status_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    created_by: FUTURE_QA_APPOINTMENT.staffAppId,
    updated_by: null,
    created_at: "2026-10-02T00:00:00.000Z",
    updated_at: "2026-10-02T00:00:00.000Z",
    ...overrides,
  };
}

function validTables(role = "OWNER", extraLocations: Row[] = []): Record<string, Row[]> {
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
      ...extraLocations,
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
    appointments: [appointmentRow()],
  };
}

function mutateClient(
  role = "OWNER",
  options: { authenticated?: boolean; extraLocations?: Row[] } = {},
): AppointmentMutateClient {
  const tables = validTables(role, options.extraLocations);
  return {
    auth: {
      async getUser() {
        if (options.authenticated === false) {
          return { data: { user: null }, error: null };
        }
        return { data: { user: { id: AUTH_UUID } }, error: null };
      },
    },
    from(table: string) {
      return {
        select() {
          return new FakeQuery(tables[table] ?? []);
        },
        insert(payload: Record<string, unknown>) {
          return new FakeQuery(tables[table] ?? [], [], payload, null, (row) => {
            tables[table] = [...(tables[table] ?? []), row];
          });
        },
        update(payload: Record<string, unknown>) {
          return new FakeQuery(tables[table] ?? [], [], null, payload);
        },
      };
    },
  };
}

const MUTATE_ON = {
  [APPOINTMENT_REMOTE_MUTATE_PILOT_ENV]: "1",
  [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
  [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
};

describe("Phase 1C-6D.1 appointment remote mutate foundation", () => {
  beforeEach(() => {
    resetAppointmentRemoteWriteRevisionForTests();
  });

  it("keeps the existing create persistence create-only", async () => {
    const persistence = await createAuthenticatedAppointmentWritePersistence(
      mutateClient() as AppointmentWriteClient,
    );
    expect(() => persistence.update()).toThrow(AppointmentWriteCreateOnlyError);
    expect(() => persistence.cancel()).toThrow(AppointmentWriteCreateOnlyError);
    expect(() => persistence.reschedule()).toThrow(AppointmentWriteCreateOnlyError);
    expect(() => persistence.changeStatus()).toThrow(AppointmentWriteCreateOnlyError);
  });

  it("requires authentication, an operational cancel role, and the mutate flag", async () => {
    await expect(
      createAuthenticatedAppointmentMutatePersistence(
        mutateClient("OWNER", { authenticated: false }),
      ),
    ).rejects.toBeInstanceOf(IdentityCatalogError);

    await expect(
      runAuthenticatedAppointmentWriteMutate(
        mutateClient(),
        {
          kind: "cancel",
          appointmentId: "apt-muqrindw-yt0l5z",
          expectedUpdatedAt: "2026-10-02T00:00:00.000Z",
        },
      ),
    ).rejects.toThrow(/pilot is off/);

    await expect(
      runAuthenticatedAppointmentWriteMutate(
        mutateClient("ACCOUNTANT"),
        {
          kind: "cancel",
          appointmentId: "apt-muqrindw-yt0l5z",
          expectedUpdatedAt: "2026-10-02T00:00:00.000Z",
        },
        MUTATE_ON,
      ),
    ).rejects.toBeInstanceOf(AppointmentWritePilotDeniedError);
  });

  it("lets STAFF cancel through the same remote mutate runner", async () => {
    const result = await runAuthenticatedAppointmentWriteMutate(
      mutateClient("STAFF"),
      {
        kind: "cancel",
        appointmentId: "apt-muqrindw-yt0l5z",
        expectedUpdatedAt: "2026-10-02T00:00:00.000Z",
      },
      MUTATE_ON,
    );
    expect(result.appointment.status).toBe("CANCELLED");
    expect(result.appointment.cancelledBy).toBe(FUTURE_QA_APPOINTMENT.staffAppId);
  });

  it("cancels through the Owner runner and reuses the write refresh bus", async () => {
    expect(isAppointmentRemoteMutatePilotEnabled(MUTATE_ON)).toBe(true);
    const result = await runAuthenticatedAppointmentWriteMutate(
      mutateClient(),
      {
        kind: "cancel",
        appointmentId: "apt-muqrindw-yt0l5z",
        expectedUpdatedAt: "2026-10-02T00:00:00.000Z",
      },
      MUTATE_ON,
    );
    expect(result.appointment.status).toBe("CANCELLED");
    expect(result.appointment.cancelledBy).toBe(FUTURE_QA_APPOINTMENT.staffAppId);
    expect(result.appointment.customerId).toBe(FUTURE_QA_APPOINTMENT.customerAppId);
    expect(result.appointment.id).toBe("apt-muqrindw-yt0l5z");
    expect(getAppointmentRemoteWriteRevision()).toBe(1);
  });

  it("rejects an unauthorized new location and a mismatched organization", async () => {
    const persistence = await createAuthenticatedAppointmentMutatePersistence(mutateClient());
    const current = await persistence.appointments.get(
      FUTURE_QA_APPOINTMENT.organizationAppId,
      "apt-muqrindw-yt0l5z",
    );
    expect(current).toBeTruthy();
    expect(() =>
      persistence.prepare(
        {
          kind: "reschedule",
          appointmentId: current!.id,
          expectedUpdatedAt: current!.updatedAt,
          dateYmd: "2026-10-09",
          startHm: "15:00",
          durationMinutes: 60,
          locationId: OTHER_LOCATION_APP,
        },
        current!,
      ),
    ).toThrow(/Unmapped location/);

    await expect(
      runAuthenticatedAppointmentWriteMutate(
        mutateClient(),
        {
          kind: "cancel",
          appointmentId: "apt-muqrindw-yt0l5z",
          expectedUpdatedAt: "2026-10-02T00:00:00.000Z",
          organizationId: "org-other",
        },
        MUTATE_ON,
      ),
    ).rejects.toThrow(/authenticated organization/);
  });

  it("authorizes a mapped new location and refuses a stale write", async () => {
    const client = mutateClient("OWNER", {
      extraLocations: [
        {
          id: OTHER_LOCATION_DB,
          app_id: "loc-enjoye-second",
          organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
        },
      ],
    });
    const moved = await runAuthenticatedAppointmentWriteMutate(
      client,
      {
        kind: "reschedule",
        appointmentId: "apt-muqrindw-yt0l5z",
        expectedUpdatedAt: "2026-10-02T00:00:00.000Z",
        dateYmd: "2026-10-09",
        startHm: "16:00",
        durationMinutes: 60,
        locationId: "loc-enjoye-second",
      },
      MUTATE_ON,
    );
    expect(moved.appointment.locationId).toBe("loc-enjoye-second");
    expect(moved.appointment.durationMinutes).toBe(60);

    await expect(
      runAuthenticatedAppointmentWriteMutate(
        client,
        {
          kind: "cancel",
          appointmentId: "apt-muqrindw-yt0l5z",
          expectedUpdatedAt: "2026-10-02T00:00:00.000Z",
        },
        MUTATE_ON,
      ),
    ).rejects.toBeInstanceOf(AppointmentWriteStaleError);
  });

  it("keeps Calendar / Today / Customer 360 read-only and out of the mutate graph", () => {
    const calendar = readFileSync(
      path.join(process.cwd(), "features/calendar/CalendarPage.tsx"),
      "utf8",
    );
    const quickView = readFileSync(
      path.join(process.cwd(), "features/calendar/AppointmentQuickView.tsx"),
      "utf8",
    );
    const today = readFileSync(path.join(process.cwd(), "features/today/TodayDashboard.tsx"), "utf8");
    const profile = readFileSync(
      path.join(process.cwd(), "features/customers/CustomerProfilePage.tsx"),
      "utf8",
    );
    const page = readFileSync(path.join(process.cwd(), "app/staff/(app)/calendar/page.tsx"), "utf8");
    const flag = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-remote-mutate-flag.ts"),
      "utf8",
    );
    const factory = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-remote-mutate-pilot.ts"),
      "utf8",
    );
    expect(calendar).toMatch(/readOnly=\{calendarRemoteReadPilot\}/);
    expect(today).toMatch(/readOnly=\{todayRemoteReadPilot\}/);
    expect(profile).toMatch(/readOnly=\{remoteReadPilot\}/);
    expect(quickView).toMatch(/行事曆遠端讀取試點為唯讀/);
    expect(calendar).toMatch(/submitCalendarRemoteAppointmentCancel/);
    expect(calendar).not.toMatch(/runAuthenticatedAppointmentWriteMutate|BEAUTY_OS_APPOINTMENT_REMOTE_MUTATE_PILOT/);
    expect(today).not.toMatch(/runAuthenticatedAppointmentWriteMutate|BEAUTY_OS_APPOINTMENT_REMOTE_MUTATE_PILOT|submitCalendarRemoteAppointmentCancel/);
    expect(profile).not.toMatch(/runAuthenticatedAppointmentWriteMutate|BEAUTY_OS_APPOINTMENT_REMOTE_MUTATE_PILOT|submitCalendarRemoteAppointmentCancel/);
    expect(page).not.toMatch(/appointment-remote-mutate-pilot|runAuthenticatedAppointmentWriteMutate/);
    expect(flag).not.toMatch(
      /AppointmentRemoteAdapter|AuthenticatedAppointmentTableStore|loadAuthenticatedIdentityCatalog/,
    );
    expect(factory).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY|\.upsert\(/);
    expect(factory).not.toMatch(/hasAppointmentConflict\(|allowConflict:|localStorage\./);
    expect(factory).toMatch(/assertAppointmentWriteCancelRole/);
    expect(factory).not.toMatch(/assertAppointmentWritePilotOwner/);
    expect(factory).toMatch(/emitAppointmentRemoteWriteRefresh/);
    expect(factory).toMatch(/Does not enable BEAUTY_OS_PERSISTENCE/);
    expect(existsSync(path.join(process.cwd(), "app/staff/appointment-mutate/page.tsx"))).toBe(false);
    for (const file of [
      "features/treatments/TreatmentWorkspace.tsx",
      "features/checkout/CheckoutPageClient.tsx",
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(
        /runAuthenticatedAppointmentWriteMutate|BEAUTY_OS_APPOINTMENT_REMOTE_MUTATE_PILOT/,
      );
    }
  });
});
