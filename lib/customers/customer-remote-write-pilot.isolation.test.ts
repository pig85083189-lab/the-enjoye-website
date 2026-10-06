import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_REMOTE_WRITE_PILOT_ENV,
  CustomerDuplicateError,
  CustomerWriteCreateOnlyError,
  CustomerWritePilotOffError,
  createAuthenticatedCustomerWritePersistence,
  isCustomerRemoteWritePilotEnabled,
  runAuthenticatedCustomerWriteCreate,
} from "./customer-remote-write-pilot";
import { CUSTOMER_REMOTE_READ_PILOT_ENV } from "./customer-remote-read-flag";
import { CUSTOMER_WRITE_UI, customerWriteUserMessage } from "./customer-write-ui-error";
import { CUSTOMER_INSERT_ONLY_MESSAGE } from "@/lib/persistence/authenticated-customer-store";
import {
  CUSTOMER_BIRTHDAY_MESSAGE,
  CustomerBirthdayError,
  REMOTE_CUSTOMER_COLUMNS,
  birthdayToRemoteDate,
} from "@/lib/persistence/customer-mapping";
import type { CustomerWriteClient } from "./customer-remote-write-pilot";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
} from "@/lib/persistence/authenticated-identity-catalog";
import { IdentityCatalogError, UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { isGeneratedCustomerAppId } from "@/lib/persistence/demo-firewall";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const AUTH_ACCOUNTANT = "11111111-1111-4111-8111-111111111111";
const ORG_APP = "org-the-enjoye";
const ORG_UUID = "62bd49b6-a4c3-4da1-b53e-4746923685f1";
const FOREIGN_ORG_UUID = "99999999-9999-4999-8999-999999999999";
const LOC_APP = "loc-enjoye-main";
const LOC_UUID = "c46b700c-bb42-45ce-be53-4484e217c3f8";
const STAFF_APP = "staff-001";
const STAFF_ACCOUNTANT = "staff-acct-001";
const QA_APP_ID = "cust-muqh2jn6-xpjssl";
const QA_DB_ID = "f4be267b-8159-4b7b-920c-44ac996b3d8e";

type Row = Record<string, unknown>;

const WRITE_ON = {
  [CUSTOMER_REMOTE_WRITE_PILOT_ENV]: "1",
  [CUSTOMER_REMOTE_READ_PILOT_ENV]: "1",
};

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
    services: [],
    ...overrides,
  };
}

function fakeClient(input: {
  userId: string | null;
  tables: Record<string, Row[]>;
  insertError?: string;
}): CustomerWriteClient {
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
          return new FakeQuery(input.tables[table] ?? []);
        },
        insert(payload: Record<string, unknown>) {
          return {
            select() {
              if (input.insertError) {
                return new FakeQuery([], [], { message: input.insertError });
              }
              const row = {
                ...payload,
                id: typeof payload.id === "string" ? payload.id : crypto.randomUUID(),
              };
              input.tables[table] = [...(input.tables[table] ?? []), row];
              return new FakeQuery([row]);
            },
          };
        },
      };
    },
  };
}

function ownerClient(
  overrides?: Partial<Record<string, Row[]>>,
  insertError?: string,
) {
  return fakeClient({
    userId: AUTH_UUID,
    tables: validTables(overrides),
    insertError,
  });
}

function accountantClient(overrides?: Partial<Record<string, Row[]>>) {
  return fakeClient({
    userId: AUTH_ACCOUNTANT,
    tables: validTables({
      staff_auth_memberships: [
        {
          id: "mem-enjoye-accountant",
          user_id: STAFF_ACCOUNTANT,
          auth_user_id: AUTH_ACCOUNTANT,
          organization_id: ORG_APP,
          role: "ACCOUNTANT",
          is_active: true,
          display_name: "會計",
        },
      ],
      ...overrides,
    }),
  });
}

describe("Customer remote write pilot flag", () => {
  it("stays off unless Preview write + read are both 1", () => {
    expect(isCustomerRemoteWritePilotEnabled({})).toBe(false);
    expect(
      isCustomerRemoteWritePilotEnabled({
        [CUSTOMER_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(false);
    expect(isCustomerRemoteWritePilotEnabled(WRITE_ON)).toBe(true);
    expect(
      isCustomerRemoteWritePilotEnabled({
        ...WRITE_ON,
        VERCEL_ENV: "production",
      }),
    ).toBe(true);
    expect(
      isCustomerRemoteWritePilotEnabled({
        ...WRITE_ON,
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe(true);
    expect(getPersistenceDriver(WRITE_ON)).toBe("local");
  });
});

describe("Customer remote write create", () => {
  it("refuses create when the pilot is off", async () => {
    await expect(
      runAuthenticatedCustomerWriteCreate(
        ownerClient(),
        {
          organizationId: ORG_APP,
          name: "新客人",
          phone: "0911222333",
          primaryStaffId: STAFF_APP,
        },
        {},
      ),
    ).rejects.toBeInstanceOf(CustomerWritePilotOffError);
  });

  it("requires an authenticated staff session", async () => {
    await expect(
      runAuthenticatedCustomerWriteCreate(
        fakeClient({ userId: null, tables: validTables() }),
        {
          organizationId: ORG_APP,
          name: "新客人",
          phone: "0911222333",
          primaryStaffId: STAFF_APP,
        },
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(IdentityCatalogError);
  });

  it("creates a remote customer and returns the generated app id", async () => {
    const tables = validTables({ customers: [] });
    const allocated = "cust-writeqa-abc123";
    const created = await runAuthenticatedCustomerWriteCreate(
      fakeClient({ userId: AUTH_UUID, tables }),
      {
        id: allocated,
        organizationId: ORG_APP,
        locationId: LOC_APP,
        name: "遠端新客",
        phone: "0911555666",
        primaryStaffId: STAFF_APP,
      },
      WRITE_ON,
    );
    expect(created.id).toBe(allocated);
    expect(isGeneratedCustomerAppId(created.id)).toBe(true);
    expect(created.id.startsWith("demo-")).toBe(false);
    expect(created.organizationId).toBe(ORG_APP);
    expect(created.name).toBe("遠端新客");
    expect(created.phone).toBe("0911555666");
    const row = tables.customers.find((item) => item.app_id === allocated);
    expect(row).toBeTruthy();
    expect(row?.id).not.toBe(allocated);
    expect(String(row?.id)).toMatch(/^[0-9a-f-]{36}$/i);
    expect(row?.organization_id).toBe(ORG_UUID);
    expect(row?.full_name).toBe("遠端新客");
  });

  it("keeps a foreign organization and location out of the write", async () => {
    await expect(
      runAuthenticatedCustomerWriteCreate(
        ownerClient(),
        {
          organizationId: "org-unrelated",
          name: "跨機構",
          phone: "0911999000",
          primaryStaffId: STAFF_APP,
        },
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
    const tables = validTables({
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
    const created = await runAuthenticatedCustomerWriteCreate(
      fakeClient({ userId: AUTH_UUID, tables }),
      {
        id: "cust-sameorg-ok0001",
        organizationId: ORG_APP,
        locationId: "loc-enjoye-gongyi",
        name: "同機構新客",
        phone: "0900000000",
        primaryStaffId: STAFF_APP,
        allowDuplicate: true,
      },
      WRITE_ON,
    );
    expect(created.organizationId).toBe(ORG_APP);
    const inserted = tables.customers.find((row) => row.app_id === "cust-sameorg-ok0001");
    expect(inserted).toBeTruthy();
    expect(inserted).not.toHaveProperty("location_id");
    expect(REMOTE_CUSTOMER_COLUMNS).not.toContain("location_id");
    expect(tables.customers.filter((row) => row.app_id === "cust-sameorg-ok0001")).toHaveLength(1);
  });

  it("does not fall back to localStorage when remote insert fails", async () => {
    const before = localCustomerRepository.list({ organizationId: ORG_ENJOYE_ID }).length;
    await expect(
      runAuthenticatedCustomerWriteCreate(
        ownerClient({ customers: [] }, "permission denied for table customers"),
        {
          id: "cust-failclosed-0001",
          organizationId: ORG_APP,
          name: "失敗客戶",
          phone: "0911777888",
          primaryStaffId: STAFF_APP,
        },
        WRITE_ON,
      ),
    ).rejects.toThrow(/permission denied for table customers/);
    expect(localCustomerRepository.list({ organizationId: ORG_ENJOYE_ID })).toHaveLength(before);
    expect(
      localCustomerRepository
        .list({ organizationId: ORG_ENJOYE_ID })
        .some((customer) => customer.id === "cust-failclosed-0001"),
    ).toBe(false);
  });

  it("blocks same-org duplicate phones unless explicitly allowed", async () => {
    await expect(
      runAuthenticatedCustomerWriteCreate(
        ownerClient(),
        {
          organizationId: ORG_APP,
          name: "重複電話",
          phone: "0911000001",
          primaryStaffId: STAFF_APP,
        },
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(CustomerDuplicateError);
  });

  it("refuses update on the write persistence", async () => {
    const persistence = await createAuthenticatedCustomerWritePersistence(ownerClient());
    expect(() => persistence.update()).toThrow(CustomerWriteCreateOnlyError);
    await expect(
      persistence.customers.updateProfile(ORG_APP, QA_APP_ID, { name: "改名" }),
    ).rejects.toBeInstanceOf(CustomerWriteCreateOnlyError);
  });

  it("lets OWNER create an organization-owned customer without a location column", async () => {
    const tables = validTables({ customers: [] });
    const created = await runAuthenticatedCustomerWriteCreate(
      fakeClient({ userId: AUTH_UUID, tables }),
      {
        id: "cust-owner-orgonly01",
        organizationId: ORG_APP,
        name: "店主新客",
        phone: "0912000001",
        primaryStaffId: STAFF_APP,
      },
      WRITE_ON,
    );
    expect(created.organizationId).toBe(ORG_APP);
    expect(created.primaryStaffId).toBe(STAFF_APP);
    const row = tables.customers.find((item) => item.app_id === created.id);
    expect(row?.organization_id).toBe(ORG_UUID);
    expect(row?.primary_staff_id).toBe(STAFF_APP);
    expect(row).not.toHaveProperty("location_id");
    const foundation = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20260918120000_beauty_os_foundation.sql"),
      "utf8",
    );
    const customersTable = foundation.slice(
      foundation.indexOf("create table if not exists public.customers"),
      foundation.indexOf("create table if not exists public.customer_consultations"),
    );
    expect(customersTable).not.toMatch(/location_id/);
    expect(REMOTE_CUSTOMER_COLUMNS).not.toContain("location_id");
  });

  it("resolves OWNER membership and follows the existing ACCOUNTANT create contract", async () => {
    const ownerPersistence = await createAuthenticatedCustomerWritePersistence(ownerClient());
    expect(ownerPersistence.identity.authUserId).toBe(AUTH_UUID);
    expect(ownerPersistence.identity.operationalStaffId).toBe(STAFF_APP);
    expect(ownerPersistence.identity.organizationAppId).toBe(ORG_APP);
    expect(ownerPersistence.identity.organizationDbId).toBe(ORG_UUID);

    const tables = validTables({ customers: [] });
    const created = await runAuthenticatedCustomerWriteCreate(
      accountantClient({ customers: tables.customers }),
      {
        id: "cust-acct-ok0000001",
        organizationId: ORG_APP,
        name: "會計可見新客",
        phone: "0912000002",
        primaryStaffId: STAFF_ACCOUNTANT,
      },
      WRITE_ON,
    );
    expect(created.primaryStaffId).toBe(STAFF_ACCOUNTANT);
    expect(created.organizationId).toBe(ORG_APP);
  });

  it("rejects unauthenticated create and does not insert a partial row", async () => {
    const tables = validTables({ customers: [] });
    await expect(
      runAuthenticatedCustomerWriteCreate(
        fakeClient({ userId: null, tables }),
        {
          id: "cust-unauth-noinsert",
          organizationId: ORG_APP,
          name: "未登入",
          phone: "0912000003",
          primaryStaffId: STAFF_APP,
        },
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(IdentityCatalogError);
    expect(tables.customers).toEqual([]);
  });

  it("rejects invalid birthday before INSERT and maps it off the generic UI", async () => {
    expect(birthdayToRemoteDate(undefined)).toBeNull();
    expect(birthdayToRemoteDate("1992/03/08")).toBe("1992-03-08");
    expect(birthdayToRemoteDate("1990.8.31")).toBe("1990-08-31");
    expect(birthdayToRemoteDate("1991年1月2日")).toBe("1991-01-02");
    expect(() => birthdayToRemoteDate("85/08/31")).toThrow(CustomerBirthdayError);
    expect(() => birthdayToRemoteDate("2026-02-31")).toThrow(CUSTOMER_BIRTHDAY_MESSAGE);

    const tables = validTables({ customers: [] });
    await expect(
      runAuthenticatedCustomerWriteCreate(
        fakeClient({ userId: AUTH_UUID, tables }),
        {
          id: "cust-bad-bday-00001",
          organizationId: ORG_APP,
          name: "生日格式",
          phone: "0912000004",
          primaryStaffId: STAFF_APP,
          birthday: "85/08/31",
        },
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(CustomerBirthdayError);
    expect(tables.customers).toEqual([]);
  });

  it("maps failures to user-safe text", () => {
    expect(customerWriteUserMessage(new CustomerWritePilotOffError())).toBe(CUSTOMER_WRITE_UI.off);
    expect(customerWriteUserMessage(new CustomerDuplicateError([QA_APP_ID]))).toBe(
      CUSTOMER_WRITE_UI.duplicate,
    );
    expect(
      customerWriteUserMessage(new UnmappedIdentityError("location", ORG_APP, "loc-x")),
    ).toBe(CUSTOMER_WRITE_UI.location);
    expect(customerWriteUserMessage(new CustomerBirthdayError())).toBe(CUSTOMER_WRITE_UI.birthday);
    expect(customerWriteUserMessage(new Error("Invalid birthday \"85/08/31\""))).toBe(
      CUSTOMER_WRITE_UI.birthday,
    );
    expect(customerWriteUserMessage(new Error(CUSTOMER_INSERT_ONLY_MESSAGE))).toBe(
      CUSTOMER_WRITE_UI.generic,
    );
    expect(customerWriteUserMessage(new Error("23P01 exclusion"))).toBe(CUSTOMER_WRITE_UI.generic);
  });

  it("keeps the write graph out of Customer RSC and local-only when the wizard is remote", () => {
    const page = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/customers/page.tsx"),
      "utf8",
    );
    const created = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/customers/new/page.tsx"),
      "utf8",
    );
    const wizard = readFileSync(
      path.join(process.cwd(), "features/customers/ConsultationWizard.tsx"),
      "utf8",
    );
    const hook = readFileSync(
      path.join(process.cwd(), "features/customers/use-customer-remote-write.ts"),
      "utf8",
    );
    const flag = readFileSync(
      path.join(process.cwd(), "lib/customers/customer-remote-write-flag.ts"),
      "utf8",
    );
    const pilot = readFileSync(
      path.join(process.cwd(), "lib/customers/customer-remote-write-pilot.ts"),
      "utf8",
    );
    expect(page).not.toMatch(/customer-remote-write-pilot|AuthenticatedCustomerWriteStore/);
    expect(created).not.toMatch(/customer-remote-write-pilot|AuthenticatedCustomerWriteStore/);
    expect(wizard).toMatch(/submitCustomerRemoteCreate/);
    expect(wizard).toMatch(/if \(remoteWritePilot && mode === "new"\)/);
    const remoteSave = wizard.slice(
      wizard.indexOf("async function completeRemoteCreate"),
      wizard.indexOf("function completeLocalCreate"),
    );
    expect(remoteSave).toMatch(/submitCustomerRemoteCreate/);
    expect(remoteSave).not.toMatch(/locationId/);
    expect(remoteSave).not.toMatch(/currentLocation/);
    expect(remoteSave).not.toMatch(/localCustomerRepository/);
    expect(remoteSave).not.toMatch(/localConsultationRepository/);
    expect(remoteSave).not.toMatch(/localStorage/);
    expect(pilot).not.toMatch(/assertLocationBoundary/);
    expect(pilot).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(hook).toMatch(/createBrowserClientOrNull/);
    expect(hook).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(flag).not.toMatch(/CustomerRemoteAdapter|AuthenticatedCustomerWriteStore|loadAuthenticatedIdentityCatalog/);
  });
});
