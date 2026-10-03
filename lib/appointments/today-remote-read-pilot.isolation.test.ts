import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  TodayRemoteReadErrorBoundary,
  TodayRemoteReadErrorFallback,
} from "@/features/today/today-remote-read-boundary";
import {
  APPOINTMENT_REMOTE_READ_PILOT_ENV,
  isAppointmentRemoteReadPilotEnabled,
} from "@/lib/appointments/appointment-remote-read-flag";
import {
  CALENDAR_REMOTE_READ_PILOT_ENV,
  isCalendarRemoteReadPilotEnabled,
} from "@/lib/appointments/calendar-remote-read-flag";
import { todayBucket, type ScheduleAppointment } from "@/lib/appointments/domain";
import { listAppointments, listTodayAppointments } from "@/lib/appointments/store";
import {
  TODAY_REMOTE_READ_PILOT_ENV,
  AppointmentRemoteReadOnlyError,
  APPOINTMENT_REMOTE_READ_ONLY_MESSAGE,
  isTodayRemoteReadPilotEnabled,
  listRemoteTodayAppointmentsByLocation,
} from "./today-remote-read-pilot";
import { createAuthenticatedAppointmentReadPersistence } from "./appointment-remote-read-pilot";
import { FUTURE_QA_APPOINTMENT, futureQaAppointmentUtcRange } from "./remote-readiness";
import {
  todayRemoteQueryRangeFromInstant,
} from "@/lib/calendar/calendar-appointment-time";
import { CUSTOMER_REMOTE_READ_PILOT_ENV } from "@/lib/customers/customer-remote-read-pilot";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-pilot";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
  IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import { collectAttentionNotes, lastServiceSummary } from "@/lib/today/briefing";
import { scheduleAppointmentToTodayView } from "@/lib/today/today-appointment-view";
import { LOC_ENJOYE_PRIMARY_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const APT_APP_ID = "apt-muqrindw-yt0l5z";
const APT_DB_ID = "b92c54a1-000e-4cf1-bbd3-837ce3312559";

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

describe("Phase 1C-5E Today remote read pilot", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("pilot flag is Preview-only and independent of other pilots", () => {
    expect(TODAY_REMOTE_READ_PILOT_ENV).toBe("BEAUTY_OS_TODAY_REMOTE_READ_PILOT");
    expect(isTodayRemoteReadPilotEnabled({})).toBe(false);
    expect(
      isTodayRemoteReadPilotEnabled({
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe(false);
    expect(isTodayRemoteReadPilotEnabled({ [TODAY_REMOTE_READ_PILOT_ENV]: "1" })).toBe(true);
    expect(
      isTodayRemoteReadPilotEnabled({
        [TODAY_REMOTE_READ_PILOT_ENV]: "1",
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
    expect(
      isTodayRemoteReadPilotEnabled({
        [TODAY_REMOTE_READ_PILOT_ENV]: "1",
        VERCEL_TARGET_ENV: "production",
      }),
    ).toBe(false);
    expect(getPersistenceDriver({ [TODAY_REMOTE_READ_PILOT_ENV]: "1" })).toBe("local");
    expect(isCalendarRemoteReadPilotEnabled({ [TODAY_REMOTE_READ_PILOT_ENV]: "1" })).toBe(false);
    expect(isAppointmentRemoteReadPilotEnabled({ [TODAY_REMOTE_READ_PILOT_ENV]: "1" })).toBe(false);
    expect(isCustomerRemoteReadPilotEnabled({ [TODAY_REMOTE_READ_PILOT_ENV]: "1" })).toBe(false);
    expect(
      isTodayRemoteReadPilotEnabled({
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
        [APPOINTMENT_REMOTE_READ_PILOT_ENV]: "1",
        [CUSTOMER_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(false);
  });

  it("uses location + Taipei day range, not browser UTC midnight", async () => {
    const oct9 = todayRemoteQueryRangeFromInstant("2026-10-09T02:00:00.000Z");
    expect(oct9.dateYmd).toBe("2026-10-09");
    expect(oct9.startsAt).toBe("2026-10-08T16:00:00.000Z");
    expect(oct9.endsAt).toBe("2026-10-09T16:00:00.000Z");

    const rows = await listRemoteTodayAppointmentsByLocation(
      ORG_ENJOYE_ID,
      LOC_ENJOYE_PRIMARY_ID,
      "2026-10-09T04:00:00.000Z",
      ownerClient(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(APT_APP_ID);
    expect(rows[0]?.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
  });

  it("keeps Taipei midnight and UTC crossover on the Taipei business day", async () => {
    const afterMidnight = todayRemoteQueryRangeFromInstant("2026-10-03T16:30:00.000Z");
    expect(afterMidnight.dateYmd).toBe("2026-10-04");
    expect(afterMidnight.startsAt).toBe("2026-10-03T16:00:00.000Z");
    expect(afterMidnight.endsAt).toBe("2026-10-04T16:00:00.000Z");

    const beforeMidnight = todayRemoteQueryRangeFromInstant("2026-10-03T15:30:00.000Z");
    expect(beforeMidnight.dateYmd).toBe("2026-10-03");
    expect(beforeMidnight.startsAt).toBe("2026-10-02T16:00:00.000Z");
    expect(beforeMidnight.endsAt).toBe("2026-10-03T16:00:00.000Z");

    const onOct3 = await listRemoteTodayAppointmentsByLocation(
      ORG_ENJOYE_ID,
      LOC_ENJOYE_PRIMARY_ID,
      "2026-10-03T04:00:00.000Z",
      ownerClient(),
    );
    expect(onOct3).toEqual([]);
  });

  it("remote-only Today list does not merge or fallback to local", async () => {
    const local = listTodayAppointments(
      ORG_ENJOYE_ID,
      LOC_ENJOYE_PRIMARY_ID,
      new Date(2026, 9, 9),
    );
    expect(local.some((row) => row.id !== APT_APP_ID) || local.length !== 1).toBe(true);
    const remote = await listRemoteTodayAppointmentsByLocation(
      ORG_ENJOYE_ID,
      LOC_ENJOYE_PRIMARY_ID,
      "2026-10-09T04:00:00.000Z",
      ownerClient(),
    );
    expect(remote.map((row) => row.id)).toEqual([APT_APP_ID]);
    const empty = await listRemoteTodayAppointmentsByLocation(
      ORG_ENJOYE_ID,
      LOC_ENJOYE_PRIMARY_ID,
      "2026-10-09T04:00:00.000Z",
      ownerClient({ appointments: [] }),
    );
    expect(empty).toEqual([]);
    expect(empty.length).not.toBe(listAppointments({ organizationId: ORG_ENJOYE_ID }).length);
    await expect(
      listRemoteTodayAppointmentsByLocation(
        ORG_ENJOYE_ID,
        LOC_ENJOYE_PRIMARY_ID,
        "2026-10-09T04:00:00.000Z",
        ownerClient(undefined, { appointments: "permission denied for table appointments" }),
      ),
    ).rejects.toThrow(/permission denied for table appointments/);
  });

  it("BOOKED remote appointment uses the existing waiting bucket and snapshots", async () => {
    const rows = await listRemoteTodayAppointmentsByLocation(
      ORG_ENJOYE_ID,
      LOC_ENJOYE_PRIMARY_ID,
      "2026-10-09T04:00:00.000Z",
      ownerClient(),
    );
    const item: ScheduleAppointment = rows[0]!;
    expect(item.status).toBe("BOOKED");
    expect(todayBucket(item.status)).toBe("waiting");
    expect(todayBucket("ARRIVED")).toBe("waiting");
    expect(todayBucket("IN_SERVICE")).toBe("active");
    expect(todayBucket("COMPLETED")).toBe("done");
    expect(todayBucket("CANCELLED")).toBe("muted");
    const view = scheduleAppointmentToTodayView(item, true);
    expect(view.id).toBe(APT_APP_ID);
    expect(view.id).not.toBe(APT_DB_ID);
    expect(view.customerName).toBe("Remote QA Customer");
    expect(view.serviceName).toBe("Remote QA Bust Care");
    expect(view.staffName).toBe("測試帳號");
    expect(view.time).toBe("10:00");
    expect(view.time).not.toBe("02:00");
  });

  it("remote-only customer enrichment does not throw", async () => {
    const rows = await listRemoteTodayAppointmentsByLocation(
      ORG_ENJOYE_ID,
      LOC_ENJOYE_PRIMARY_ID,
      "2026-10-09T04:00:00.000Z",
      ownerClient(),
    );
    const view = scheduleAppointmentToTodayView(rows[0]!, true);
    expect(() => collectAttentionNotes(ORG_ENJOYE_ID, undefined, view)).not.toThrow();
    expect(collectAttentionNotes(ORG_ENJOYE_ID, undefined, view)).toEqual([]);
    expect(lastServiceSummary(ORG_ENJOYE_ID, undefined)).toBeNull();
  });

  it("containment keeps Today render exceptions out of a global crash", () => {
    const state = TodayRemoteReadErrorBoundary.getDerivedStateFromError(
      new Error("today appointment render exploded"),
    );
    const html = renderToStaticMarkup(
      createElement(TodayRemoteReadErrorFallback, { message: state.message }),
    );
    expect(html).toContain("無法讀取今日預約資料");
    expect(html).toContain("today appointment render exploded");
    expect(html).not.toContain("This page couldn’t load");
  });

  it("Today remote read exposes no writes and no diagnostic/bootstrap route", async () => {
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
      path.join(process.cwd(), "lib/appointments/today-remote-read-pilot.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/export async function createAppointment/);
    expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(existsSync(path.join(process.cwd(), "app/staff/today-bootstrap/page.tsx"))).toBe(false);
    expect(
      existsSync(path.join(process.cwd(), "app/staff/(app)/today-read-diagnostic/page.tsx")),
    ).toBe(false);
    expect(existsSync(path.join(process.cwd(), "app/staff/today-qa/page.tsx"))).toBe(false);
    expect(existsSync(path.join(process.cwd(), "app/staff/(app)/today-qa/page.tsx"))).toBe(false);
    expect(existsSync(path.join(process.cwd(), "features/today/TodayQaPage.tsx"))).toBe(false);
    expect(existsSync(path.join(process.cwd(), "features/today/TodayReadDiagnosticPage.tsx"))).toBe(
      false,
    );
    for (const file of [
      "app/staff/(app)/today/page.tsx",
      "features/today/TodayDashboard.tsx",
      "features/today/use-today-remote-read.ts",
      "features/today/today-remote-read-boundary.tsx",
      "lib/appointments/today-remote-read-flag.ts",
      "lib/appointments/today-remote-read-pilot.ts",
      "lib/today/today-appointment-view.ts",
    ]) {
      const impl = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(impl).not.toMatch(/qaDate|dateOverride|forceTodayDate|QA_TODAY_DATE|todayDateOverride/);
      expect(impl).not.toMatch(/console\.(log|debug|info)/);
    }
  });

  it("keeps Calendar and Customer 360 on independent flags", () => {
    const today = readFileSync(
      path.join(process.cwd(), "features/today/TodayDashboard.tsx"),
      "utf8",
    );
    const calendar = readFileSync(
      path.join(process.cwd(), "features/calendar/CalendarPage.tsx"),
      "utf8",
    );
    const tab = readFileSync(
      path.join(process.cwd(), "features/customers/tabs/AppointmentsTab.tsx"),
      "utf8",
    );
    expect(today).toMatch(/useTodayRemoteAppointments/);
    expect(today).toMatch(/listTodayAppointments/);
    expect(today).not.toMatch(/useCalendarRemoteAppointments|BEAUTY_OS_CALENDAR_REMOTE_READ_PILOT/);
    expect(today).not.toMatch(/AppointmentRemoteAdapter|createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(calendar).not.toMatch(/useTodayRemoteAppointments|BEAUTY_OS_TODAY_REMOTE_READ_PILOT/);
    expect(tab).not.toMatch(/useTodayRemoteAppointments|BEAUTY_OS_TODAY_REMOTE_READ_PILOT/);
    for (const file of [
      "features/calendar/CalendarPage.tsx",
      "features/calendar/AppointmentQuickView.tsx",
      "features/calendar/use-calendar-remote-read.ts",
      "lib/appointments/calendar-remote-read-pilot.ts",
      "lib/appointments/calendar-remote-read-flag.ts",
    ]) {
      expect(readFileSync(path.join(process.cwd(), file), "utf8")).not.toMatch(
        /BEAUTY_OS_TODAY_REMOTE_READ_PILOT|useTodayRemoteAppointments/,
      );
    }
    expect(tab).toMatch(/useCustomerRemoteAppointments/);
    expect(
      readFileSync(path.join(process.cwd(), "features/calendar/AppointmentQuickView.tsx"), "utf8"),
    ).toMatch(/readOnly/);
    expect(
      readFileSync(path.join(process.cwd(), "components/appointments/AppointmentCard.tsx"), "utf8"),
    ).toMatch(/readOnly/);
    expect(
      readFileSync(path.join(process.cwd(), "components/appointments/NextCustomerPanel.tsx"), "utf8"),
    ).toMatch(/readOnly/);
  });

  it("does not let the RSC Today page import the adapter graph", () => {
    const page = readFileSync(path.join(process.cwd(), "app/staff/(app)/today/page.tsx"), "utf8");
    const flag = readFileSync(
      path.join(process.cwd(), "lib/appointments/today-remote-read-flag.ts"),
      "utf8",
    );
    expect(page).toMatch(/from ["']@\/lib\/appointments\/today-remote-read-flag["']/);
    expect(page).not.toMatch(/today-remote-read-pilot/);
    expect(flag).not.toMatch(/AppointmentRemoteAdapter|loadAuthenticatedIdentityCatalog|IdentitySupabaseClient/);
  });
});
