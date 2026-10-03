import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CalendarRemoteReadErrorBoundary,
  CalendarRemoteReadErrorFallback,
} from "@/features/calendar/calendar-remote-read-boundary";
import {
  APPOINTMENT_REMOTE_READ_PILOT_ENV,
  isAppointmentRemoteReadPilotEnabled,
} from "@/lib/appointments/appointment-remote-read-flag";
import {
  CALENDAR_REMOTE_READ_PILOT_ENV,
  AppointmentRemoteReadOnlyError,
  APPOINTMENT_REMOTE_READ_ONLY_MESSAGE,
  isCalendarRemoteReadPilotEnabled,
  listRemoteCalendarAppointmentsByLocationAndRange,
} from "./calendar-remote-read-pilot";
import { createAuthenticatedAppointmentReadPersistence } from "./appointment-remote-read-pilot";
import { FUTURE_QA_APPOINTMENT, futureQaAppointmentUtcRange } from "./remote-readiness";
import type { ScheduleAppointment } from "./domain";
import { listAppointments, listTodayAppointments } from "./store";
import {
  absoluteTaipeiMinutesFromIso,
  calendarViewRangeUtc,
  formatCalendarAppointmentDisplay,
  layoutCalendarAppointmentBlock,
} from "@/lib/calendar/calendar-appointment-time";
import { resolveSelectedAppointment } from "@/lib/calendar/selection";
import { CUSTOMER_REMOTE_READ_PILOT_ENV } from "@/lib/customers/customer-remote-read-pilot";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-pilot";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
  IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import { formatTaipeiAppointmentDisplay } from "@/lib/persistence/appointment-time";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { LOC_ENJOYE_PRIMARY_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const APT_APP_ID = "apt-muqrindw-yt0l5z";
const APT_DB_ID = "b92c54a1-000e-4cf1-bbd3-837ce3312559";
const OTHER_LOC_APP = "loc-other-branch";
const OTHER_LOC_DB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_APT_APP = "apt-otherloc-zzzzzz";

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
      {
        id: OTHER_LOC_DB,
        app_id: OTHER_LOC_APP,
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

async function listQaDay(client: IdentitySupabaseClient = ownerClient()) {
  const range = calendarViewRangeUtc({
    view: "day",
    dayYmd: FUTURE_QA_APPOINTMENT.localDateYmd,
    weekStartYmd: "2026-10-05",
  });
  return listRemoteCalendarAppointmentsByLocationAndRange(
    ORG_ENJOYE_ID,
    LOC_ENJOYE_PRIMARY_ID,
    range.startsAt,
    range.endsAt,
    client,
  );
}

describe("Phase 1C-5D calendar remote read pilot", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("pilot flag is Preview-only and independent of global persistence", () => {
    expect(CALENDAR_REMOTE_READ_PILOT_ENV).toBe("BEAUTY_OS_CALENDAR_REMOTE_READ_PILOT");
    expect(isCalendarRemoteReadPilotEnabled({})).toBe(false);
    expect(
      isCalendarRemoteReadPilotEnabled({
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe(false);
    expect(
      isCalendarRemoteReadPilotEnabled({
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isCalendarRemoteReadPilotEnabled({
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
    expect(
      isCalendarRemoteReadPilotEnabled({
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
        VERCEL_TARGET_ENV: "production",
      }),
    ).toBe(false);
    expect(getPersistenceDriver({ [CALENDAR_REMOTE_READ_PILOT_ENV]: "1" })).toBe("local");
  });

  it("does not require or replace Customer / Appointment 360 pilots", () => {
    expect(
      isCalendarRemoteReadPilotEnabled({
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isCustomerRemoteReadPilotEnabled({
        [CUSTOMER_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isAppointmentRemoteReadPilotEnabled({
        [APPOINTMENT_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isCustomerRemoteReadPilotEnabled({
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(false);
    expect(
      isAppointmentRemoteReadPilotEnabled({
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(false);
    expect(
      isCalendarRemoteReadPilotEnabled({
        [APPOINTMENT_REMOTE_READ_PILOT_ENV]: "1",
        [CUSTOMER_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(false);
  });

  it("maps location app id to UUID and queries only that location/range", async () => {
    const persistence = await createAuthenticatedAppointmentReadPersistence(ownerClient());
    expect(
      persistence.identity.mapper.resolveLocationDbId(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID),
    ).toBe(FUTURE_QA_APPOINTMENT.locationDbId);

    const client = ownerClient({
      appointments: [
        qaAppointmentRow(),
        qaAppointmentRow({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          app_id: OTHER_APT_APP,
          location_id: OTHER_LOC_DB,
          starts_at: "2026-10-09T02:00:00.000Z",
          ends_at: "2026-10-09T03:00:00.000Z",
        }),
        qaAppointmentRow({
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          app_id: "apt-out-of-range",
          starts_at: "2026-10-16T02:00:00.000Z",
          ends_at: "2026-10-16T03:00:00.000Z",
        }),
      ],
    });
    const day = await listQaDay(client);
    expect(day.map((row) => row.id)).toEqual([APT_APP_ID]);
    expect(day[0]?.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    expect(day[0]?.locationId).not.toBe(FUTURE_QA_APPOINTMENT.locationDbId);

    const other = await listRemoteCalendarAppointmentsByLocationAndRange(
      ORG_ENJOYE_ID,
      OTHER_LOC_APP,
      calendarViewRangeUtc({
        view: "day",
        dayYmd: "2026-10-09",
        weekStartYmd: "2026-10-05",
      }).startsAt,
      calendarViewRangeUtc({
        view: "day",
        dayYmd: "2026-10-09",
        weekStartYmd: "2026-10-05",
      }).endsAt,
      client,
    );
    expect(other.map((row) => row.id)).toEqual([OTHER_APT_APP]);
  });

  it("uses Taipei day/week windows instead of browser UTC midnight", () => {
    const day = calendarViewRangeUtc({
      view: "day",
      dayYmd: "2026-10-09",
      weekStartYmd: "2026-10-05",
    });
    expect(day.startsAt).toBe("2026-10-08T16:00:00.000Z");
    expect(day.endsAt).toBe("2026-10-09T16:00:00.000Z");
    const week = calendarViewRangeUtc({
      view: "week",
      dayYmd: "2026-10-09",
      weekStartYmd: "2026-10-05",
    });
    expect(week.startsAt).toBe("2026-10-04T16:00:00.000Z");
    expect(week.endsAt).toBe("2026-10-11T16:00:00.000Z");
  });

  it("positions 02:00Z at Taipei 10:00, never 02:00", async () => {
    const rows = await listQaDay();
    const item = rows[0]!;
    expect(item.startAt).toMatch(/2026-10-09T02:00:00/);
    expect(absoluteTaipeiMinutesFromIso(item.startAt)).toBe(10 * 60);
    expect(absoluteTaipeiMinutesFromIso(item.endAt)).toBe(11 * 60 + 40);
    const layout = layoutCalendarAppointmentBlock(item.startAt, item.endAt, true);
    expect(layout.visible).toBe(true);
    expect(layout.topPx).toBe(60);
    expect(formatTaipeiAppointmentDisplay(item.startAt, item.endAt)).toEqual({
      date: "2026/10/09",
      time: "10:00–11:40",
    });
    expect(formatTaipeiAppointmentDisplay(item.startAt, item.endAt).time).not.toMatch(
      /02:00|03:40/,
    );
  });

  it("parses +00:00 timestamptz for Calendar positioning", () => {
    const layout = layoutCalendarAppointmentBlock(
      "2026-10-09T02:00:00+00:00",
      "2026-10-09T03:40:00+00:00",
      true,
    );
    expect(layout.visible).toBe(true);
    expect(layout.topPx).toBe(60);
    expect(absoluteTaipeiMinutesFromIso("2026-10-09T02:00:00.123456+00:00")).toBe(600);
  });

  it("remote-only Calendar list does not merge local demo appointments", async () => {
    const local = listAppointments({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
    });
    expect(local.length).toBeGreaterThan(1);
    const remote = await listQaDay();
    expect(remote).toHaveLength(1);
    expect(remote[0]?.id).toBe(APT_APP_ID);
    expect(remote.some((row) => row.id.startsWith("apt-demo") || row.id === "apt-001")).toBe(
      false,
    );
    const empty = await listQaDay(ownerClient({ appointments: [] }));
    expect(empty).toEqual([]);
    expect(empty.length).not.toBe(local.length);
  });

  it("remote empty and error do not fallback to local store", async () => {
    const empty = await listQaDay(ownerClient({ appointments: [] }));
    expect(empty).toEqual([]);
    await expect(
      listQaDay(ownerClient(undefined, { appointments: "permission denied for table appointments" })),
    ).rejects.toThrow(/permission denied for table appointments/);
  });

  it("selectedId stays the appointment app id and Quick View uses snapshots", async () => {
    const rows = await listQaDay();
    const item: ScheduleAppointment = rows[0]!;
    expect(item.id).toBe(APT_APP_ID);
    expect(item.id).not.toBe(APT_DB_ID);
    expect(resolveSelectedAppointment(rows, APT_APP_ID)?.id).toBe(APT_APP_ID);
    expect(resolveSelectedAppointment(rows, APT_DB_ID)).toBeNull();
    expect(item.customerName).toBe("Remote QA Customer");
    expect(item.serviceName).toBe("Remote QA Bust Care");
    expect(item.staffName).toBe("怡蓁");
    expect(item.status).toBe("BOOKED");
    expect(formatCalendarAppointmentDisplay(item.startAt, item.endAt, true)).toEqual({
      date: "2026/10/09",
      time: "10:00–11:40",
    });

    const quickView = readFileSync(
      path.join(process.cwd(), "features/calendar/AppointmentQuickView.tsx"),
      "utf8",
    );
    expect(quickView).toMatch(/readOnly/);
    expect(quickView).toMatch(/useTaipeiTime/);
    expect(quickView).toMatch(/item\.customerName/);
    expect(quickView).toMatch(/item\.serviceName/);
    expect(quickView).toMatch(/item\.staffName/);
    expect(quickView).toMatch(/formatCalendarAppointmentDisplay/);
    expect(quickView).toMatch(/行事曆遠端讀取試點為唯讀/);
  });

  it("unknown staff is ignored and never dumped into the first column", async () => {
    const rows = await listQaDay(
      ownerClient({
        appointments: [qaAppointmentRow({ staff_id: "staff-unknown-99" })],
      }),
    );
    expect(rows[0]?.staffId).toBe("staff-unknown-99");
    const roster = new Set(["staff-001", "staff-002"]);
    const column = rows.filter((row) => roster.has(row.staffId));
    const unmapped = rows.filter((row) => row.staffId && !roster.has(row.staffId));
    expect(column).toEqual([]);
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]?.staffId).not.toBe("staff-001");
  });

  it("containment keeps render exceptions out of a global crash", () => {
    const state = CalendarRemoteReadErrorBoundary.getDerivedStateFromError(
      new Error("calendar appointment render exploded"),
    );
    expect(state.message).toBe("calendar appointment render exploded");
    const html = renderToStaticMarkup(
      createElement(CalendarRemoteReadErrorFallback, {
        message: state.message,
      }),
    );
    expect(html).toContain("無法讀取預約資料");
    expect(html).toContain("calendar appointment render exploded");
    expect(html).not.toContain("This page couldn’t load");
  });

  it("Calendar remote read boundary exposes no write methods and no bootstrap", async () => {
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
      path.join(process.cwd(), "lib/appointments/calendar-remote-read-pilot.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/export async function createAppointment/);
    expect(source).not.toMatch(/export async function updateAppointment/);
    expect(source).not.toMatch(/export async function deleteAppointment/);
    expect(source).not.toMatch(/createAppointmentRecord/);
    expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(existsSync(path.join(process.cwd(), "app/staff/appointment-bootstrap/page.tsx"))).toBe(
      false,
    );
    const store = readFileSync(
      path.join(process.cwd(), "lib/persistence/authenticated-appointment-read-store.ts"),
      "utf8",
    );
    expect(store).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    expect(store).toMatch(/listAppointmentsByLocationAndRange/);
  });

  it("Today remains local and does not surface the remote appointment", () => {
    const today = readFileSync(
      path.join(process.cwd(), "features/today/TodayDashboard.tsx"),
      "utf8",
    );
    expect(today).toMatch(/listTodayAppointments/);
    expect(today).not.toMatch(
      /useCalendarRemoteAppointments|listRemoteCalendarAppointmentsByLocationAndRange|AppointmentRemoteAdapter/,
    );
    const listed = listTodayAppointments(
      ORG_ENJOYE_ID,
      LOC_ENJOYE_PRIMARY_ID,
      new Date(2026, 9, 9),
    );
    expect(listed.some((row) => row.id === APT_APP_ID)).toBe(false);
  });

  it("does not let the RSC calendar page import the adapter graph", () => {
    const page = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/calendar/page.tsx"),
      "utf8",
    );
    const calendar = readFileSync(
      path.join(process.cwd(), "features/calendar/CalendarPage.tsx"),
      "utf8",
    );
    expect(page).toMatch(/from ["']@\/lib\/appointments\/calendar-remote-read-flag["']/);
    expect(page).not.toMatch(/calendar-remote-read-pilot/);
    expect(calendar).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(calendar).not.toMatch(/AppointmentRemoteAdapter/);
  });

  it("unmapped location fails closed instead of scanning all rows", async () => {
    await expect(
      listRemoteCalendarAppointmentsByLocationAndRange(
        ORG_ENJOYE_ID,
        "loc-does-not-exist",
        "2026-10-08T16:00:00.000Z",
        "2026-10-09T16:00:00.000Z",
        ownerClient(),
      ),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
  });
});
