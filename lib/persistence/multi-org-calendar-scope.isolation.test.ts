import { describe, expect, it } from "vitest";
import { listRemoteCalendarAppointmentsByLocationAndRange } from "@/lib/appointments/calendar-remote-read-pilot";
import { guestUnverifiedCalendarLabel } from "@/lib/appointments/domain";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentityQueryBuilder,
  type IdentityQueryResult,
  type IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import { IdentityCatalogError } from "@/lib/persistence/identity-errors";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const TEST_ORG = "org-beauty-os-test";
const ENJOYE_ORG = "org-the-enjoye";
const TEST_ORG_DB = "77a65221-46ab-4156-bda9-72736a527c7f";
const ENJOYE_ORG_DB = "62bd49b6-a4c3-4da1-b53e-4746923685f1";
const TEST_LOC = "loc-beauty-os-test-main";
const ENJOYE_LOC = "loc-enjoye-main";
const TEST_LOC_DB = "69a76a41-19f8-439a-b23f-a36b4a170a8b";
const ENJOYE_LOC_DB = "c46b700c-bb42-45ce-be53-4484e217c3f8";
const SERVICE_DB = "efda4e57-0397-4f75-8970-401feb9f691a";
const CUSTOMER_DB = "5dc8d528-fbc0-45f6-a9db-c1c9f498d2d0";
const ENJOYE_CUSTOMER_DB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENJOYE_SERVICE_DB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Row = Record<string, unknown>;
type FilterOp = "eq" | "in" | "gt" | "lt" | "gte" | "lte";

class FakeQuery implements IdentityQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly filters: Array<{
      column: string;
      value?: string;
      values?: string[];
      op: FilterOp;
    }> = [],
  ) {}

  eq(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "eq" }]);
  }

  in(column: string, values: string[]): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, values, op: "in" }]);
  }

  gte(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "gte" }]);
  }

  lte(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "lte" }]);
  }

  gt(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "gt" }]);
  }

  lt(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "lt" }]);
  }

  then<TResult1 = IdentityQueryResult, TResult2 = never>(
    onfulfilled?: ((value: IdentityQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const data = this.rows.filter((row) =>
      this.filters.every((filter) => {
        const current = row[filter.column];
        if (filter.values) return filter.values.includes(String(current));
        if (filter.op === "eq") return current === filter.value;
        const left = Date.parse(String(current));
        const right = Date.parse(String(filter.value));
        if (filter.op === "gt") return left > right;
        if (filter.op === "lt") return left < right;
        if (filter.op === "gte") return left >= right;
        return left <= right;
      }),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function client(tables: Record<string, Row[]>): IdentitySupabaseClient {
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
      };
    },
  };
}

function appointment(input: {
  id: string;
  organizationId: string;
  locationId: string;
  customerId: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  statusReason?: string | null;
}): Row {
  return {
    id: input.id,
    organization_id: input.organizationId,
    location_id: input.locationId,
    customer_id: input.customerId,
    service_id: input.serviceId,
    staff_id: "staff-001",
    app_id: `apt-${input.id.slice(0, 8)}`,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    duration_minutes: 60,
    status: "BOOKED",
    customer_note: null,
    internal_note: null,
    customer_name_snapshot: "訪客",
    service_name_snapshot: "【假資料】2D2 測試課程",
    staff_name_snapshot: "測試帳號",
    status_reason: input.statusReason ?? null,
    cancelled_at: null,
    cancelled_by: null,
    created_by: "staff-001",
    updated_by: null,
    created_at: "2026-11-03T09:00:00.000Z",
    updated_at: "2026-11-03T09:00:00.000Z",
  };
}

function tables(locationGrants?: Row[]): Record<string, Row[]> {
  return {
    staff_auth_memberships: [
      {
        id: "mem-beauty-os-test-owner",
        user_id: "staff-001",
        auth_user_id: AUTH_UUID,
        organization_id: TEST_ORG,
        role: "OWNER",
        is_active: true,
      },
      {
        id: "mem-enjoye-owner",
        user_id: "staff-001",
        auth_user_id: AUTH_UUID,
        organization_id: ENJOYE_ORG,
        role: "OWNER",
        is_active: true,
      },
    ],
    staff_auth_membership_locations: locationGrants ?? [
      { membership_id: "mem-beauty-os-test-owner", location_id: TEST_LOC },
      { membership_id: "mem-enjoye-owner", location_id: ENJOYE_LOC },
    ],
    organizations: [
      { id: TEST_ORG_DB, app_id: TEST_ORG },
      { id: ENJOYE_ORG_DB, app_id: ENJOYE_ORG },
    ],
    locations: [
      { id: TEST_LOC_DB, app_id: TEST_LOC, organization_id: TEST_ORG_DB },
      { id: ENJOYE_LOC_DB, app_id: ENJOYE_LOC, organization_id: ENJOYE_ORG_DB },
    ],
    customers: [
      { id: CUSTOMER_DB, app_id: "cus-test", organization_id: TEST_ORG_DB },
      { id: ENJOYE_CUSTOMER_DB, app_id: "cus-enjoye", organization_id: ENJOYE_ORG_DB },
    ],
    services: [
      { id: SERVICE_DB, app_id: "svc-test", organization_id: TEST_ORG_DB },
      { id: ENJOYE_SERVICE_DB, app_id: "svc-enjoye", organization_id: ENJOYE_ORG_DB },
    ],
    appointments: [
      appointment({
        id: "36b66f24-d721-45fe-ae05-f0d59bfd4d85",
        organizationId: TEST_ORG_DB,
        locationId: TEST_LOC_DB,
        customerId: CUSTOMER_DB,
        serviceId: SERVICE_DB,
        startsAt: "2026-11-05T02:00:00.000Z",
        endsAt: "2026-11-05T03:00:00.000Z",
        statusReason: "GUEST_UNVERIFIED",
      }),
      appointment({
        id: "2392ff55-caa3-4658-b05e-73501a5d6dd3",
        organizationId: TEST_ORG_DB,
        locationId: TEST_LOC_DB,
        customerId: CUSTOMER_DB,
        serviceId: SERVICE_DB,
        startsAt: "2026-11-05T03:00:00.000Z",
        endsAt: "2026-11-05T04:00:00.000Z",
        statusReason: "GUEST_UNVERIFIED",
      }),
      appointment({
        id: "9d4d150c-5211-44c3-be51-51b15d519e3b",
        organizationId: TEST_ORG_DB,
        locationId: TEST_LOC_DB,
        customerId: CUSTOMER_DB,
        serviceId: SERVICE_DB,
        startsAt: "2026-11-05T04:00:00.000Z",
        endsAt: "2026-11-05T05:00:00.000Z",
        statusReason: "GUEST_UNVERIFIED",
      }),
      appointment({
        id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        organizationId: ENJOYE_ORG_DB,
        locationId: ENJOYE_LOC_DB,
        customerId: ENJOYE_CUSTOMER_DB,
        serviceId: ENJOYE_SERVICE_DB,
        startsAt: "2026-11-05T04:00:00.000Z",
        endsAt: "2026-11-05T05:00:00.000Z",
        statusReason: "GUEST_UNVERIFIED",
      }),
    ],
  };
}

const dayStart = "2026-11-04T16:00:00.000Z";
const dayEnd = "2026-11-05T16:00:00.000Z";

describe("multi-organization calendar scope", () => {
  it("refuses to pick the first organization when none is selected", async () => {
    await expect(loadAuthenticatedIdentityCatalog(client(tables()))).rejects.toMatchObject({
      name: "IdentityCatalogError",
      reason: "ambiguous_membership",
    });
  });

  it("uses the selected organization and refuses a different one", async () => {
    const loaded = await loadAuthenticatedIdentityCatalog(client(tables()), {
      organizationAppId: TEST_ORG,
      locationAppId: TEST_LOC,
    });
    expect(loaded.organizationAppId).toBe(TEST_ORG);
    expect(loaded.organizationDbId).toBe(TEST_ORG_DB);
    expect(() => loaded.mapper.resolveLocationDbId(ENJOYE_ORG, ENJOYE_LOC)).toThrow();

    await expect(
      loadAuthenticatedIdentityCatalog(client(tables()), {
        organizationAppId: "org-not-assigned",
        locationAppId: TEST_LOC,
      }),
    ).rejects.toMatchObject({ reason: "missing_membership" });
  });

  it("refuses a location the membership is not assigned to", async () => {
    await expect(
      listRemoteCalendarAppointmentsByLocationAndRange(
        TEST_ORG,
        ENJOYE_LOC,
        dayStart,
        dayEnd,
        client(tables()),
      ),
    ).rejects.toBeInstanceOf(IdentityCatalogError);
    await expect(
      listRemoteCalendarAppointmentsByLocationAndRange(
        TEST_ORG,
        ENJOYE_LOC,
        dayStart,
        dayEnd,
        client(tables()),
      ),
    ).rejects.toMatchObject({ reason: "location_forbidden" });
  });

  it("refuses a calendar read when organization or location is blank", async () => {
    await expect(
      listRemoteCalendarAppointmentsByLocationAndRange(
        "",
        TEST_LOC,
        dayStart,
        dayEnd,
        client(tables()),
      ),
    ).rejects.toMatchObject({ reason: "missing_scope" });
    await expect(
      listRemoteCalendarAppointmentsByLocationAndRange(
        TEST_ORG,
        " ",
        dayStart,
        dayEnd,
        client(tables()),
      ),
    ).rejects.toMatchObject({ reason: "missing_scope" });
  });

  it("shows only the selected organization's unverified bookings", async () => {
    const testRows = await listRemoteCalendarAppointmentsByLocationAndRange(
      TEST_ORG,
      TEST_LOC,
      dayStart,
      dayEnd,
      client(tables()),
    );
    expect(testRows.map((row) => row.id)).toEqual([
      "apt-36b66f24",
      "apt-2392ff55",
      "apt-9d4d150c",
    ]);
    expect(testRows.every((row) => row.status === "BOOKED")).toBe(true);
    expect(testRows.every((row) => guestUnverifiedCalendarLabel(row.statusReason) === "新客／未驗證")).toBe(
      true,
    );
    expect(testRows.every((row) => row.organizationId === TEST_ORG)).toBe(true);

    const enjoyeRows = await listRemoteCalendarAppointmentsByLocationAndRange(
      ENJOYE_ORG,
      ENJOYE_LOC,
      dayStart,
      dayEnd,
      client(tables()),
    );
    expect(enjoyeRows.map((row) => row.id)).toEqual(["apt-aaaaaaaa"]);
    expect(enjoyeRows.some((row) => row.id === "apt-9d4d150c")).toBe(false);
  });

  it("allows every location in the organization when no location grant is stored", async () => {
    const rows = await listRemoteCalendarAppointmentsByLocationAndRange(
      TEST_ORG,
      TEST_LOC,
      dayStart,
      dayEnd,
      client(tables([])),
    );
    expect(rows).toHaveLength(3);
  });
});
