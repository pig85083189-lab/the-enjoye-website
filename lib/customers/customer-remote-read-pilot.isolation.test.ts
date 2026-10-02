import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CUSTOMER_REMOTE_READ_PILOT_ENV,
  createAuthenticatedCustomerReadPersistence,
  getRemotePilotCustomer,
  isCustomerRemoteReadPilotEnabled,
  listRemotePilotCustomers,
} from "./customer-remote-read-pilot";
import {
  CustomerRemoteReadOnlyError,
  CUSTOMER_REMOTE_READ_ONLY_MESSAGE,
} from "@/lib/persistence/authenticated-customer-read-store";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
  IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import type { Customer } from "@/types";

const AUTH_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORG_APP = "org-the-enjoye";
const ORG_UUID = "62bd49b6-a4c3-4da1-b53e-4746923685f1";
const FOREIGN_ORG_UUID = "99999999-9999-4999-8999-999999999999";
const LOC_APP = "loc-enjoye-main";
const LOC_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
      },
    ],
    organizations: [{ id: ORG_UUID, app_id: ORG_APP }],
    locations: [{ id: LOC_UUID, app_id: LOC_APP, organization_id: ORG_UUID }],
    customers: [qaCustomerRow()],
    services: [],
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

describe("Phase 1C-3 customer remote read pilot", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("A. maps remote list rows onto the existing Customer domain", async () => {
    const rows = await listRemotePilotCustomers(ORG_APP, ownerClient());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: QA_APP_ID,
      organizationId: ORG_APP,
      name: "Remote QA Customer",
      phone: "0911000001",
      membership: "new",
      primaryStaffId: STAFF_APP,
      totalVisits: 0,
      lastVisit: "",
      packages: [],
      lastServiceNotes: [],
    });
  });

  it("B. maps remote detail by domain app id", async () => {
    const row = await getRemotePilotCustomer(ORG_APP, QA_APP_ID, ownerClient());
    expect(row).toMatchObject({
      id: QA_APP_ID,
      name: "Remote QA Customer",
      phone: "0911000001",
      membership: "new",
      primaryStaffId: STAFF_APP,
      totalVisits: 0,
      lastVisit: "",
    });
    expect(row?.packages).toEqual([]);
    expect(row?.tags).toEqual([]);
  });

  it("C. keeps domain app id ↔ database UUID at the mapper boundary", async () => {
    const persistence = await createAuthenticatedCustomerReadPersistence(ownerClient());
    expect(persistence.identity.mapper.resolveCustomerDbId(ORG_APP, QA_APP_ID)).toBe(QA_DB_ID);
    expect(persistence.identity.mapper.toCustomerAppId(QA_DB_ID)).toBe(QA_APP_ID);
    const byAppId = await getRemotePilotCustomer(ORG_APP, QA_APP_ID, ownerClient());
    const byUuid = await getRemotePilotCustomer(ORG_APP, QA_DB_ID, ownerClient());
    expect(byAppId?.id).toBe(QA_APP_ID);
    expect(byAppId?.id).not.toBe(QA_DB_ID);
    expect(byUuid).toBeUndefined();
  });

  it("D. remote empty does not fallback to local demo customers", async () => {
    const local = localCustomerRepository.list({ organizationId: ORG_ENJOYE_ID });
    expect(local.some((customer) => customer.id === "demo-001")).toBe(true);
    const remote = await listRemotePilotCustomers(ORG_APP, ownerClient({ customers: [] }));
    expect(remote).toEqual([]);
    expect(remote.some((customer) => customer.id === "demo-001")).toBe(false);
    expect(remote.some((customer) => customer.name === "王小美")).toBe(false);
  });

  it("E. remote error does not fallback to local store", async () => {
    const local = localCustomerRepository.list({ organizationId: ORG_ENJOYE_ID });
    expect(local.length).toBeGreaterThan(0);
    await expect(
      listRemotePilotCustomers(
        ORG_APP,
        ownerClient(undefined, { customers: "permission denied for table customers" }),
      ),
    ).rejects.toThrow(/permission denied for table customers/);
  });

  it("F. unrelated organization rows stay invisible to the Owner session", async () => {
    const client = ownerClient({
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
    });
    const rows = await listRemotePilotCustomers(ORG_APP, client);
    expect(rows.map((customer) => customer.id)).toEqual([QA_APP_ID]);
    await expect(listRemotePilotCustomers("org-unrelated", client)).rejects.toBeInstanceOf(
      UnmappedIdentityError,
    );
  });

  it("H. Phase 1C-3 has no remote write path", async () => {
    const persistence = await createAuthenticatedCustomerReadPersistence(ownerClient());
    const draft: Customer = {
      id: "cust-should-not-write",
      organizationId: ORG_APP,
      name: "Should Not Write",
      phone: "0911222333",
      birthday: "",
      age: 0,
      membership: "new",
      lastVisit: "",
      totalVisits: 0,
      packages: [],
      lastServiceNotes: [],
      trackingFocus: [],
      alerts: [],
      tags: [],
      joinedAt: "2026/10/01",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    await expect(persistence.customers.upsert(draft)).rejects.toBeInstanceOf(
      CustomerRemoteReadOnlyError,
    );
    await expect(persistence.customers.upsert(draft)).rejects.toThrow(
      CUSTOMER_REMOTE_READ_ONLY_MESSAGE,
    );

    const source = readFileSync(
      path.join(process.cwd(), "lib/customers/customer-remote-read-pilot.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/export async function createCustomer/);
    expect(source).not.toMatch(/export async function updateCustomer/);
    expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(source).not.toMatch(/localCustomerRepository|getOperationalPersistence/);
  });

  it("I. persistence global flags remain unnecessary", () => {
    expect(CUSTOMER_REMOTE_READ_PILOT_ENV).toBe("BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT");
    expect(isCustomerRemoteReadPilotEnabled({})).toBe(false);
    expect(
      isCustomerRemoteReadPilotEnabled({
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe(false);
    expect(
      isCustomerRemoteReadPilotEnabled({
        [CUSTOMER_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isCustomerRemoteReadPilotEnabled({
        [CUSTOMER_REMOTE_READ_PILOT_ENV]: "1",
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
    expect(getPersistenceDriver({ [CUSTOMER_REMOTE_READ_PILOT_ENV]: "1" })).toBe("local");
    expect(getPersistenceDriver({})).toBe("local");
  });

  it("G. other live surfaces stay on local customer stores", () => {
    const surfaces = [
      "features/today/TodayDashboard.tsx",
      "features/calendar/CalendarPage.tsx",
      "features/treatments/TreatmentPageClient.tsx",
      "features/treatments/TreatmentsListPageClient.tsx",
      "features/checkout/CheckoutPageClient.tsx",
      "features/packages/PackagesPageClient.tsx",
      "features/transactions/TransactionsPageClient.tsx",
    ];
    for (const file of surfaces) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).toMatch(/localCustomerRepository|getCustomerById/);
      expect(source).not.toMatch(/listRemotePilotCustomers|getRemotePilotCustomer/);
    }
    const listPage = readFileSync(
      path.join(process.cwd(), "features/customers/CustomerListPage.tsx"),
      "utf8",
    );
    const detailPage = readFileSync(
      path.join(process.cwd(), "features/customers/CustomerProfilePage.tsx"),
      "utf8",
    );
    expect(listPage).toMatch(/useCustomerRemoteList/);
    expect(detailPage).toMatch(/useCustomerRemoteDetail/);
    expect(listPage).toMatch(/remoteReadPilot[\s\S]*\? \(\[\] as Customer\[\]\)/);
    expect(detailPage).toMatch(/remoteReadPilot[\s\S]*\? null/);
    expect(listPage).toMatch(/customersFromRemoteListState/);
    expect(listPage).not.toMatch(/localCustomers[\s\S]*remote\.status === "empty"/);
  });
});
