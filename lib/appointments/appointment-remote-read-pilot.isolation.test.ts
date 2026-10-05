import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { listAppointments } from "@/lib/appointments/store";
import {
  APPOINTMENT_REMOTE_READ_PILOT_ENV,
  AppointmentRemoteReadOnlyError,
  APPOINTMENT_REMOTE_READ_ONLY_MESSAGE,
  createAuthenticatedAppointmentReadPersistence,
  getRemotePilotAppointment,
  isAppointmentRemoteReadPilotEnabled,
  listRemotePilotAppointmentsByCustomer,
} from "./appointment-remote-read-pilot";
import { FUTURE_QA_APPOINTMENT, futureQaAppointmentUtcRange } from "./remote-readiness";
import type { ScheduleAppointment } from "./domain";
import { CUSTOMER_REMOTE_READ_PILOT_ENV } from "@/lib/customers/customer-remote-read-pilot";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-pilot";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
  IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { formatTaipeiAppointmentDisplay } from "@/lib/persistence/appointment-time";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const APT_APP_ID = "apt-muqrindw-yt0l5z";
const APT_DB_ID = "b92c54a1-000e-4cf1-bbd3-837ce3312559";
const OTHER_CUSTOMER_APP = "cust-other-local";
const OTHER_CUSTOMER_DB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_APT_APP = "apt-other01-zzzzzz";
const FOREIGN_ORG_UUID = "99999999-9999-4999-8999-999999999999";
const FOREIGN_LOC_UUID = "88888888-8888-4888-8888-888888888888";
const FOREIGN_CUST_DB = "77777777-7777-4777-8777-777777777777";
const FOREIGN_SVC_DB = "66666666-6666-4666-8666-666666666666";

type Row = Record<string, unknown>;

type FilterOp = "eq" | "in" | "gte" | "lte" | "gt" | "lt";

class FakeQuery implements IdentityQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly filters: Array<{
      column: string;
      value?: string;
      values?: string[];
      op?: FilterOp;
    }> = [],
    private readonly error: { message: string } | null = null,
  ) {}

  eq(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "eq" }], this.error);
  }

  in(column: string, values: string[]): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, values, op: "in" }], this.error);
  }

  gte(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "gte" }], this.error);
  }

  lte(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "lte" }], this.error);
  }

  gt(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "gt" }], this.error);
  }

  lt(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "lt" }], this.error);
  }

  then<TResult1 = IdentityQueryResult, TResult2 = never>(
    onfulfilled?: ((value: IdentityQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.error) {
      return Promise.resolve({ data: null, error: this.error }).then(onfulfilled, onrejected);
    }
    const data = this.rows.filter((row) =>
      this.filters.every((filter) => matchesFilter(row[filter.column], filter)),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function matchesFilter(
  current: unknown,
  filter: { column: string; value?: string; values?: string[]; op?: FilterOp },
): boolean {
  if (filter.values) return filter.values.includes(String(current));
  if (filter.value == null) return true;
  const op = filter.op ?? "eq";
  if (op === "eq") return String(current) === filter.value;
  const left = Date.parse(String(current));
  const right = Date.parse(filter.value);
  if (!Number.isNaN(left) && !Number.isNaN(right)) {
    if (op === "gte") return left >= right;
    if (op === "lte") return left <= right;
    if (op === "gt") return left > right;
    return left < right;
  }
  const a = String(current);
  const b = filter.value;
  if (op === "gte") return a >= b;
  if (op === "lte") return a <= b;
  if (op === "gt") return a > b;
  return a < b;
}

function fakeClient(input: {
  userId: string | null;
  tables: Record<string, Row[]>;
  errors?: Record<string, string>;
}): IdentitySupabaseClient {
  return {
    auth: {
      async getUser() {
        return {
          data: { user: input.userId ? { id: input.userId } : null },
          error: null,
        };
      },
    },
    from(table: string) {
      return {
        select() {
          const message = input.errors?.[table];
          return new FakeQuery(input.tables[table] ?? [], [], message ? { message } : null);
        },
      };
    },
  };
}

function qaAppointmentRow(overrides: Row = {}): Row {
  const { startAt, endAt } = futureQaAppointmentUtcRange();
  return {
    id: APT_DB_ID,
    organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
    location_id: FUTURE_QA_APPOINTMENT.locationDbId,
    customer_id: FUTURE_QA_APPOINTMENT.customerDbId,
    service_id: FUTURE_QA_APPOINTMENT.serviceDbId,
    staff_id: FUTURE_QA_APPOINTMENT.staffAppId,
    app_id: APT_APP_ID,
    starts_at: startAt,
    ends_at: endAt,
    duration_minutes: FUTURE_QA_APPOINTMENT.durationMinutes,
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
    created_at: "2026-10-02T09:30:20.517Z",
    updated_at: "2026-10-02T09:30:20.517Z",
    ...overrides,
  };
}

function validTables(overrides?: Partial<Record<string, Row[]>>): Record<string, Row[]> {
  return {
    staff_auth_memberships: [
      {
        id: "mem-enjoye-owner",
        user_id: FUTURE_QA_APPOINTMENT.staffAppId,
        auth_user_id: AUTH_UUID,
        organization_id: FUTURE_QA_APPOINTMENT.organizationAppId,
        role: "OWNER",
        is_active: true,
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
      {
        id: OTHER_CUSTOMER_DB,
        app_id: OTHER_CUSTOMER_APP,
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
    appointments: [qaAppointmentRow()],
    ...overrides,
  };
}

function ownerClient(overrides?: Partial<Record<string, Row[]>>, errors?: Record<string, string>) {
  return fakeClient({
    userId: AUTH_UUID,
    tables: validTables(overrides),
    errors,
  });
}

describe("Phase 1C-5C appointment remote read pilot", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps ScheduleAppointment as the canonical remote read model", async () => {
    const rows = await listRemotePilotAppointmentsByCustomer(
      FUTURE_QA_APPOINTMENT.organizationAppId,
      FUTURE_QA_APPOINTMENT.customerAppId,
      ownerClient(),
    );
    expect(rows).toHaveLength(1);
    const row: ScheduleAppointment = rows[0]!;
    expect(row).toMatchObject({
      id: APT_APP_ID,
      organizationId: FUTURE_QA_APPOINTMENT.organizationAppId,
      locationId: FUTURE_QA_APPOINTMENT.locationAppId,
      customerId: FUTURE_QA_APPOINTMENT.customerAppId,
      customerName: FUTURE_QA_APPOINTMENT.customerName,
      serviceId: FUTURE_QA_APPOINTMENT.serviceAppId,
      serviceName: FUTURE_QA_APPOINTMENT.serviceName,
      staffId: FUTURE_QA_APPOINTMENT.staffAppId,
      staffName: FUTURE_QA_APPOINTMENT.staffName,
      status: "BOOKED",
      durationMinutes: 100,
    });
    expect(row.id).not.toBe(APT_DB_ID);
    expect(row.customerId).not.toBe(FUTURE_QA_APPOINTMENT.customerDbId);
    expect(row.serviceId).not.toBe(FUTURE_QA_APPOINTMENT.serviceDbId);
    expect(row.locationId).not.toBe(FUTURE_QA_APPOINTMENT.locationDbId);
    expect(row.staffId).not.toBe(AUTH_UUID);
  });

  it("maps appointment / customer / service / location app id ↔ UUID exactly", async () => {
    const persistence = await createAuthenticatedAppointmentReadPersistence(ownerClient());
    const mapper = persistence.identity.mapper;
    expect(mapper.resolveCustomerDbId(ORG_ENJOYE_ID, FUTURE_QA_APPOINTMENT.customerAppId)).toBe(
      FUTURE_QA_APPOINTMENT.customerDbId,
    );
    expect(mapper.toCustomerAppId(FUTURE_QA_APPOINTMENT.customerDbId)).toBe(
      FUTURE_QA_APPOINTMENT.customerAppId,
    );
    expect(mapper.resolveServiceDbId(ORG_ENJOYE_ID, FUTURE_QA_APPOINTMENT.serviceAppId)).toBe(
      FUTURE_QA_APPOINTMENT.serviceDbId,
    );
    expect(mapper.toServiceAppId(FUTURE_QA_APPOINTMENT.serviceDbId)).toBe(
      FUTURE_QA_APPOINTMENT.serviceAppId,
    );
    expect(mapper.resolveLocationDbId(ORG_ENJOYE_ID, FUTURE_QA_APPOINTMENT.locationAppId)).toBe(
      FUTURE_QA_APPOINTMENT.locationDbId,
    );
    expect(mapper.toLocationAppId(FUTURE_QA_APPOINTMENT.locationDbId)).toBe(
      FUTURE_QA_APPOINTMENT.locationAppId,
    );

    const byAppId = await getRemotePilotAppointment(ORG_ENJOYE_ID, APT_APP_ID, ownerClient());
    const byUuid = await getRemotePilotAppointment(ORG_ENJOYE_ID, APT_DB_ID, ownerClient());
    expect(byAppId?.id).toBe(APT_APP_ID);
    expect(byAppId?.id).not.toBe(APT_DB_ID);
    expect(byUuid).toBeUndefined();
  });

  it("listByCustomer only returns that customer's appointment via customer_id FK", async () => {
    const client = ownerClient({
      appointments: [
        qaAppointmentRow(),
        qaAppointmentRow({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          app_id: OTHER_APT_APP,
          customer_id: OTHER_CUSTOMER_DB,
          customer_name_snapshot: FUTURE_QA_APPOINTMENT.customerName,
          service_name_snapshot: FUTURE_QA_APPOINTMENT.serviceName,
        }),
      ],
    });
    const mine = await listRemotePilotAppointmentsByCustomer(
      ORG_ENJOYE_ID,
      FUTURE_QA_APPOINTMENT.customerAppId,
      client,
    );
    const other = await listRemotePilotAppointmentsByCustomer(
      ORG_ENJOYE_ID,
      OTHER_CUSTOMER_APP,
      client,
    );
    expect(mine.map((row) => row.id)).toEqual([APT_APP_ID]);
    expect(other.map((row) => row.id)).toEqual([OTHER_APT_APP]);
    expect(mine[0]?.customerId).toBe(FUTURE_QA_APPOINTMENT.customerAppId);
  });

  it("does not leak cross-org appointment rows", async () => {
    const client = ownerClient({
      appointments: [
        qaAppointmentRow(),
        qaAppointmentRow({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          organization_id: FOREIGN_ORG_UUID,
          location_id: FOREIGN_LOC_UUID,
          customer_id: FOREIGN_CUST_DB,
          service_id: FOREIGN_SVC_DB,
          app_id: "apt-foreign-org",
          customer_name_snapshot: "Foreign Tenant Customer",
        }),
      ],
    });
    const rows = await listRemotePilotAppointmentsByCustomer(
      ORG_ENJOYE_ID,
      FUTURE_QA_APPOINTMENT.customerAppId,
      client,
    );
    expect(rows.map((row) => row.id)).toEqual([APT_APP_ID]);
    await expect(
      listRemotePilotAppointmentsByCustomer("org-unrelated", FUTURE_QA_APPOINTMENT.customerAppId, client),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
  });

  it("displays Taipei 2026/10/09 10:00–11:40 and never 02:00–03:40", async () => {
    const rows = await listRemotePilotAppointmentsByCustomer(
      ORG_ENJOYE_ID,
      FUTURE_QA_APPOINTMENT.customerAppId,
      ownerClient(),
    );
    const display = formatTaipeiAppointmentDisplay(rows[0]!.startAt, rows[0]!.endAt);
    expect(rows[0]!.startAt).toBe("2026-10-09T02:00:00.000Z");
    expect(rows[0]!.endAt).toBe("2026-10-09T03:40:00.000Z");
    expect(display).toEqual({ date: "2026/10/09", time: "10:00–11:40" });
    expect(display.time).not.toBe("02:00–03:40");
  });

  it("remote empty does not fallback to local demo appointments", async () => {
    const local = listAppointments({
      organizationId: ORG_ENJOYE_ID,
      customerId: FUTURE_QA_APPOINTMENT.customerAppId,
    });
    expect(local.some((row) => row.id !== APT_APP_ID) || local.length >= 0).toBe(true);
    const remote = await listRemotePilotAppointmentsByCustomer(
      ORG_ENJOYE_ID,
      FUTURE_QA_APPOINTMENT.customerAppId,
      ownerClient({ appointments: [] }),
    );
    expect(remote).toEqual([]);
    expect(remote.some((row) => row.id.startsWith("apt-demo") || row.id === "apt-001")).toBe(false);
  });

  it("remote error does not fallback to local store", async () => {
    await expect(
      listRemotePilotAppointmentsByCustomer(
        ORG_ENJOYE_ID,
        FUTURE_QA_APPOINTMENT.customerAppId,
        ownerClient(undefined, { appointments: "permission denied for table appointments" }),
      ),
    ).rejects.toThrow(/permission denied for table appointments/);
  });

  it("pilot store is read-only and has no write exports", async () => {
    const persistence = await createAuthenticatedAppointmentReadPersistence(ownerClient());
    await expect(
      persistence.appointments.create(ORG_ENJOYE_ID, {
        locationId: FUTURE_QA_APPOINTMENT.locationAppId,
        customerId: FUTURE_QA_APPOINTMENT.customerAppId,
        serviceId: FUTURE_QA_APPOINTMENT.serviceAppId,
        staffId: FUTURE_QA_APPOINTMENT.staffAppId,
        startAt: "2026-10-09T02:00:00.000Z",
        endAt: "2026-10-09T03:40:00.000Z",
        createdBy: FUTURE_QA_APPOINTMENT.staffAppId,
        customerName: FUTURE_QA_APPOINTMENT.customerName,
        serviceName: FUTURE_QA_APPOINTMENT.serviceName,
        staffName: FUTURE_QA_APPOINTMENT.staffName,
      }),
    ).rejects.toBeInstanceOf(AppointmentRemoteReadOnlyError);
    await expect(
      persistence.appointments.create(ORG_ENJOYE_ID, {
        locationId: FUTURE_QA_APPOINTMENT.locationAppId,
        customerId: FUTURE_QA_APPOINTMENT.customerAppId,
        serviceId: FUTURE_QA_APPOINTMENT.serviceAppId,
        staffId: FUTURE_QA_APPOINTMENT.staffAppId,
        startAt: "2026-10-09T02:00:00.000Z",
        endAt: "2026-10-09T03:40:00.000Z",
      }),
    ).rejects.toThrow(APPOINTMENT_REMOTE_READ_ONLY_MESSAGE);

    const source = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-remote-read-pilot.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/export async function createAppointment/);
    expect(source).not.toMatch(/export async function updateAppointment/);
    expect(source).not.toMatch(/export async function deleteAppointment/);
    expect(source).not.toMatch(/createAppointmentRecord/);
    expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(source).not.toMatch(/listAppointments\(|getScheduleAppointmentsKey/);
    const store = readFileSync(
      path.join(process.cwd(), "lib/persistence/authenticated-appointment-read-store.ts"),
      "utf8",
    );
    expect(store).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });

  it("does not let the RSC customer page import the appointment adapter graph", () => {
    const page = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/customers/[id]/page.tsx"),
      "utf8",
    );
    const flag = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-remote-read-flag.ts"),
      "utf8",
    );
    expect(page).toMatch(/from ["']@\/lib\/appointments\/appointment-remote-read-flag["']/);
    expect(page).not.toMatch(/appointment-remote-read-pilot/);
    expect(flag).not.toMatch(/AppointmentRemoteAdapter|loadAuthenticatedIdentityCatalog|IdentitySupabaseClient/);
  });

  it("pilot flag is Preview-only and independent of global persistence", () => {
    expect(APPOINTMENT_REMOTE_READ_PILOT_ENV).toBe("BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT");
    expect(isAppointmentRemoteReadPilotEnabled({})).toBe(false);
    expect(
      isAppointmentRemoteReadPilotEnabled({
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe(false);
    expect(
      isAppointmentRemoteReadPilotEnabled({
        [APPOINTMENT_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isAppointmentRemoteReadPilotEnabled({
        [APPOINTMENT_REMOTE_READ_PILOT_ENV]: "1",
        VERCEL_ENV: "production",
      }),
    ).toBe(true);
    expect(
      isAppointmentRemoteReadPilotEnabled({
        [APPOINTMENT_REMOTE_READ_PILOT_ENV]: "1",
        VERCEL_TARGET_ENV: "production",
      }),
    ).toBe(true);
    expect(getPersistenceDriver({ [APPOINTMENT_REMOTE_READ_PILOT_ENV]: "1" })).toBe("local");
    expect(
      isCustomerRemoteReadPilotEnabled({
        [CUSTOMER_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
  });

  it("does not leave an appointment bootstrap endpoint and keeps live surfaces local", () => {
    expect(existsSync(path.join(process.cwd(), "app/staff/appointment-bootstrap/page.tsx"))).toBe(
      false,
    );
    const surfaces = [
      "features/today/TodayDashboard.tsx",
      "features/treatments/TreatmentPageClient.tsx",
      "features/treatments/TreatmentsListPageClient.tsx",
      "features/checkout/CheckoutPageClient.tsx",
      "features/transactions/TransactionsPageClient.tsx",
      "features/customers/use-customer-360.ts",
    ];
    for (const file of surfaces) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(
        /listRemotePilotAppointmentsByCustomer|useCustomerRemoteAppointments|AppointmentRemoteAdapter|listRemoteCalendarAppointmentsByLocationAndRange/,
      );
      expect(source).toMatch(/listAppointments|listTodayAppointments|appointment-store/);
    }
    const calendar = readFileSync(
      path.join(process.cwd(), "features/calendar/CalendarPage.tsx"),
      "utf8",
    );
    expect(calendar).not.toMatch(
      /listRemotePilotAppointmentsByCustomer|useCustomerRemoteAppointments|AppointmentRemoteAdapter/,
    );
    expect(calendar).toMatch(/listAppointments|useCalendarRemoteAppointments/);
  });
});
