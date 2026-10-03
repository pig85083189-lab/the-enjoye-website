import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filterAppointmentWriteCustomers } from "./appointment-write-customer-search";
import {
  filterAppointmentWriteStaff,
  loadAppointmentWriteFormCatalog,
} from "./appointment-write-form-catalog";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
  IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const ORG_APP = "org-the-enjoye";
const ORG_UUID = "62bd49b6-a4c3-4da1-b53e-4746923685f1";
const FOREIGN_ORG_UUID = "99999999-9999-4999-8999-999999999999";
const LOC_APP = "loc-enjoye-main";
const LOC_UUID = "c46b700c-bb42-45ce-be53-4484e217c3f8";
const STAFF_APP = "staff-001";
const QA_APP_ID = "cust-muqh2jn6-xpjssl";
const QA_DB_ID = "f4be267b-8159-4b7b-920c-44ac996b3d8e";

type Row = Record<string, unknown>;

class FakeQuery implements IdentityQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly filters: Array<{ column: string; value?: string; values?: string[] }> = [],
    private readonly error: { message: string } | null = null,
  ) {}

  eq(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value }], this.error);
  }

  in(column: string, values: string[]): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, values }], this.error);
  }

  gte(column: string, value: string): IdentityQueryBuilder {
    return this.eq(column, value);
  }

  lte(column: string, value: string): IdentityQueryBuilder {
    return this.eq(column, value);
  }

  gt(column: string, value: string): IdentityQueryBuilder {
    return this.eq(column, value);
  }

  lt(column: string, value: string): IdentityQueryBuilder {
    return this.eq(column, value);
  }

  then<TResult1 = IdentityQueryResult, TResult2 = never>(
    onfulfilled?: ((value: IdentityQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.error) {
      return Promise.resolve({ data: null, error: this.error }).then(onfulfilled, onrejected);
    }
    const data = this.rows.filter((row) =>
      this.filters.every((filter) => {
        const current = row[filter.column];
        if (filter.values) return filter.values.includes(String(current));
        return current === filter.value;
      }),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
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

function qaCustomerRow(overrides: Row = {}): Row {
  return {
    id: QA_DB_ID,
    organization_id: ORG_UUID,
    app_id: QA_APP_ID,
    full_name: "Remote QA Customer",
    phone: "0911000001",
    email: null,
    birthday: null,
    gender: null,
    line_user_id: null,
    source: null,
    membership_tier: "new",
    is_vip: false,
    primary_staff_id: STAFF_APP,
    status: "ACTIVE",
    notes: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function validTables(overrides?: Partial<Record<string, Row[]>>): Record<string, Row[]> {
  return {
    staff_auth_memberships: [
      {
        id: "mem-enjoye-owner",
        user_id: STAFF_APP,
        auth_user_id: AUTH_UUID,
        organization_id: ORG_APP,
        role: "OWNER",
        is_active: true,
        display_name: "測試帳號",
      },
    ],
    organizations: [{ id: ORG_UUID, app_id: ORG_APP }],
    locations: [{ id: LOC_UUID, app_id: LOC_APP, organization_id: ORG_UUID }],
    customers: [qaCustomerRow()],
    services: [
      {
        id: "bd4c1822-5375-48b6-a4f4-dd231da10ef2",
        organization_id: ORG_UUID,
        app_id: "svc-muqm5pht-nqlpr3",
        name: "Remote QA Service",
        duration_minutes: 100,
      },
    ],
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

describe("Phase 1C-6C appointment write customer catalog", () => {
  it("loads the same remote customer name and phone as /staff/customers", async () => {
    const catalog = await loadAppointmentWriteFormCatalog(ownerClient());
    expect(catalog.canCreate).toBe(true);
    expect(catalog.customers).toEqual([
      {
        id: QA_APP_ID,
        name: "Remote QA Customer",
        phone: "0911000001",
      },
    ]);
  });

  it("makes Remote QA Customer searchable by name and phone", () => {
    const customers = [
      { id: QA_APP_ID, name: "Remote QA Customer", phone: "0911000001" },
    ];
    expect(filterAppointmentWriteCustomers(customers, "").map((c) => c.id)).toEqual([
      QA_APP_ID,
    ]);
    expect(filterAppointmentWriteCustomers(customers, "Remote QA").map((c) => c.id)).toEqual([
      QA_APP_ID,
    ]);
    expect(filterAppointmentWriteCustomers(customers, "0911000001").map((c) => c.id)).toEqual([
      QA_APP_ID,
    ]);
    expect(filterAppointmentWriteCustomers(customers, "0911-000-001").map((c) => c.id)).toEqual([
      QA_APP_ID,
    ]);
    expect(filterAppointmentWriteCustomers(customers, "王小美")).toEqual([]);
  });

  it("keeps unrelated organization customers out of the write catalog", async () => {
    const catalog = await loadAppointmentWriteFormCatalog(
      ownerClient({
        customers: [
          qaCustomerRow(),
          qaCustomerRow({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            organization_id: FOREIGN_ORG_UUID,
            app_id: "cust-foreign-org",
            full_name: "Foreign Tenant Customer",
            phone: "0900000000",
          }),
        ],
      }),
    );
    expect(catalog.customers.map((customer) => customer.id)).toEqual([QA_APP_ID]);
  });

  it("does not fall back to localStorage customer search in Calendar remote create", () => {
    const calendar = readFileSync(
      path.join(process.cwd(), "features/calendar/CalendarPage.tsx"),
      "utf8",
    );
    const catalog = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-write-form-catalog.ts"),
      "utf8",
    );
    expect(catalog).toMatch(/CustomerRemoteAdapter/);
    expect(catalog).toMatch(/AuthenticatedCustomerReadStore/);
    expect(calendar).toMatch(/appointment-write-customer-search/);
    expect(calendar).toMatch(/filterAppointmentWriteCustomers/);
    expect(calendar).not.toMatch(/phone: ""/);
    const remoteMap = calendar.slice(
      calendar.indexOf("? remoteCreate.customers.map"),
      calendar.indexOf(": localCustomerRepository.list"),
    );
    expect(remoteMap).toMatch(/phone: c\.phone/);
    expect(remoteMap).not.toMatch(/localCustomerRepository/);
  });
});

describe("Phase 1C-6D.2A appointment write staff catalog", () => {
  it("lists every eligible org staff instead of only the authenticated Owner", async () => {
    const catalog = await loadAppointmentWriteFormCatalog(
      ownerClient({
        staff_auth_memberships: [
          {
            id: "mem-enjoye-owner",
            user_id: STAFF_APP,
            auth_user_id: AUTH_UUID,
            organization_id: ORG_APP,
            role: "OWNER",
            is_active: true,
            display_name: "測試帳號",
          },
          {
            id: "mem-enjoye-colleague",
            user_id: "staff-002",
            auth_user_id: null,
            organization_id: ORG_APP,
            role: "STAFF",
            is_active: true,
            display_name: "小美",
          },
          {
            id: "mem-inactive",
            user_id: "staff-003",
            auth_user_id: null,
            organization_id: ORG_APP,
            role: "STAFF",
            is_active: false,
            display_name: "Amy",
          },
          {
            id: "mem-foreign",
            user_id: "staff-foreign",
            auth_user_id: null,
            organization_id: "org-other",
            role: "STAFF",
            is_active: true,
            display_name: "語柔",
          },
        ],
        staff_auth_membership_locations: [
          { membership_id: "mem-enjoye-owner", location_id: LOC_APP },
          { membership_id: "mem-enjoye-colleague", location_id: LOC_APP },
          { membership_id: "mem-foreign", location_id: "loc-other" },
        ],
      }),
    );
    expect(catalog.staff.map((row) => row.id).sort()).toEqual(["staff-001", "staff-002"]);
    expect(catalog.staff.map((row) => row.name).sort()).toEqual(["小美", "測試帳號"]);
    expect(catalog.staff.some((row) => row.name === "測試帳號" && catalog.staff.length === 1)).toBe(
      false,
    );
    expect(filterAppointmentWriteStaff(catalog.staff, LOC_APP).map((row) => row.id).sort()).toEqual([
      "staff-001",
      "staff-002",
    ]);
    expect(filterAppointmentWriteStaff(catalog.staff, "loc-other")).toEqual([]);
    expect(catalog.identity.operationalStaffId).toBe(STAFF_APP);
    expect(catalog.identity.mapper.requireOperationalStaffId(ORG_APP, "staff-002")).toBe(
      "staff-002",
    );
  });

  it("treats empty location assignment as all locations and keeps capability matrix unused", async () => {
    const catalog = await loadAppointmentWriteFormCatalog(ownerClient());
    expect(catalog.staff).toEqual([
      {
        id: STAFF_APP,
        name: "測試帳號",
        role: "OWNER",
        locationIds: [],
      },
    ]);
    expect(filterAppointmentWriteStaff(catalog.staff, LOC_APP)).toHaveLength(1);
    const capability = readFileSync(
      path.join(process.cwd(), "lib/staff-schedule/capability.ts"),
      "utf8",
    );
    expect(capability).toMatch(/currently all bookable staff can run all services/);
  });

  it("does not hardcode 怡蓁 as the only remote create assignee", () => {
    const catalog = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-write-form-catalog.ts"),
      "utf8",
    );
    const command = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-write-command.ts"),
      "utf8",
    );
    const page = readFileSync(
      path.join(process.cwd(), "features/calendar/CalendarPage.tsx"),
      "utf8",
    );
    const writePilot = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-remote-write-pilot.ts"),
      "utf8",
    );
    expect(catalog).not.toMatch(/staff-001|怡蓁/);
    expect(command).toMatch(/requires authenticated createdBy/);
    expect(command).not.toMatch(/createdBy \?\? input\.staffId/);
    expect(writePilot).toMatch(/createdBy: identity.operationalStaffId/);
    expect(page).toMatch(/filterAppointmentWriteStaff/);
    expect(page).toMatch(/appointmentWriteStaffToMembership/);
    expect(page).not.toMatch(/staffId: membership\?\.userId/);
  });
});
