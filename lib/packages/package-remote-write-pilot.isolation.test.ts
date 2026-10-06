import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PACKAGE_REMOTE_WRITE_PILOT_ENV,
  PackageWriteCreateOnlyError,
  PackageWritePilotOffError,
  PackageWriteUnauthorizedError,
  createAuthenticatedPackageWritePersistence,
  isPackageRemoteWritePilotEnabled,
  runAuthenticatedPackageWriteCreate,
} from "./package-remote-write-pilot";
import { PACKAGE_REMOTE_READ_PILOT_ENV } from "./package-remote-read-flag";
import { PACKAGE_WRITE_UI, packageWriteUserMessage } from "./package-write-ui-error";
import { PACKAGE_WRITE_INSERT_ONLY_MESSAGE } from "@/lib/persistence/authenticated-package-write-store";
import { REMOTE_PACKAGE_DEFINITION_COLUMNS } from "@/lib/persistence/package-mapping";
import type { PackageWriteClient } from "./package-remote-write-pilot";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
} from "@/lib/persistence/authenticated-identity-catalog";
import { IdentityCatalogError, UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { isGeneratedPackageDefinitionAppId } from "@/lib/persistence/demo-firewall";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import { listPackageDefinitions } from "@/lib/packages/store";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const AUTH_STAFF = "11111111-1111-4111-8111-111111111111";
const ORG_APP = "org-the-enjoye";
const ORG_UUID = "62bd49b6-a4c3-4da1-b53e-4746923685f1";
const LOC_APP = "loc-enjoye-main";
const LOC_UUID = "c46b700c-bb42-45ce-be53-4484e217c3f8";
const STAFF_APP = "staff-001";
const STAFF_TECH = "staff-002";
const SERVICE_APP = "svc-muw54el4-7omtyn";
const SERVICE_UUID = "07bce7ab-10fb-4295-88f2-435fc06a99d2";

type Row = Record<string, unknown>;

const WRITE_ON = {
  [PACKAGE_REMOTE_WRITE_PILOT_ENV]: "1",
  [PACKAGE_REMOTE_READ_PILOT_ENV]: "1",
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
    customers: [],
    services: [
      { id: SERVICE_UUID, app_id: SERVICE_APP, organization_id: ORG_UUID },
    ],
    package_definitions: [],
    ...overrides,
  };
}

function fakeClient(input: {
  userId: string | null;
  tables: Record<string, Row[]>;
  insertError?: string;
}): PackageWriteClient {
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

function ownerClient(overrides?: Partial<Record<string, Row[]>>, insertError?: string) {
  return fakeClient({
    userId: AUTH_UUID,
    tables: validTables(overrides),
    insertError,
  });
}

function staffClient() {
  return fakeClient({
    userId: AUTH_STAFF,
    tables: validTables({
      staff_auth_memberships: [
        {
          id: "mem-enjoye-staff",
          user_id: STAFF_TECH,
          auth_user_id: AUTH_STAFF,
          organization_id: ORG_APP,
          role: "STAFF",
          is_active: true,
          display_name: "美容師",
        },
      ],
    }),
  });
}

const CREATE_INPUT = {
  organizationId: ORG_APP,
  name: "性感美胸10堂",
  includedServiceIds: [SERVICE_APP],
  sessionCount: 10,
  priceMinor: 22000,
  createdByStaffId: STAFF_APP,
};

describe("Package remote write pilot flag", () => {
  it("stays off unless write + read are both 1", () => {
    expect(isPackageRemoteWritePilotEnabled({})).toBe(false);
    expect(
      isPackageRemoteWritePilotEnabled({
        [PACKAGE_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(false);
    expect(isPackageRemoteWritePilotEnabled(WRITE_ON)).toBe(true);
    expect(getPersistenceDriver(WRITE_ON)).toBe("local");
  });
});

describe("Package remote write create", () => {
  it("refuses create when the pilot is off", async () => {
    await expect(
      runAuthenticatedPackageWriteCreate(ownerClient(), CREATE_INPUT, {}),
    ).rejects.toBeInstanceOf(PackageWritePilotOffError);
  });

  it("requires an authenticated staff session", async () => {
    await expect(
      runAuthenticatedPackageWriteCreate(
        fakeClient({ userId: null, tables: validTables() }),
        CREATE_INPUT,
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(IdentityCatalogError);
  });

  it("lets OWNER create an official package definition with generated pkgdef-*", async () => {
    const tables = validTables();
    const created = await runAuthenticatedPackageWriteCreate(
      fakeClient({ userId: AUTH_UUID, tables }),
      CREATE_INPUT,
      WRITE_ON,
    );
    expect(isGeneratedPackageDefinitionAppId(created.id)).toBe(true);
    expect(created.id.startsWith("pkgdef-")).toBe(true);
    expect(created.organizationId).toBe(ORG_APP);
    expect(created.name).toBe("性感美胸10堂");
    expect(created.sessionCount).toBe(10);
    expect(created.priceMinor).toBe(22000);
    expect(created.includedServices[0]?.serviceId).toBe(SERVICE_APP);
    expect(created.isActive).toBe(true);
    const row = tables.package_definitions.find((item) => item.app_id === created.id);
    expect(row).toBeTruthy();
    expect(row?.id).not.toBe(created.id);
    expect(String(row?.id)).toMatch(/^[0-9a-f-]{36}$/i);
    expect(row?.organization_id).toBe(ORG_UUID);
    expect(row?.price_minor).toBe(22000);
    expect(row?.session_count).toBe(10);
    expect(REMOTE_PACKAGE_DEFINITION_COLUMNS).toContain("price_minor");
    expect(REMOTE_PACKAGE_DEFINITION_COLUMNS).not.toContain("remaining_sessions");
  });

  it("blocks QA / demo names and seed service ids", async () => {
    await expect(
      runAuthenticatedPackageWriteCreate(
        ownerClient(),
        { ...CREATE_INPUT, name: "Remote QA Package" },
        WRITE_ON,
      ),
    ).rejects.toThrow(/Demo \/ seed packages/);
    await expect(
      runAuthenticatedPackageWriteCreate(
        ownerClient(),
        { ...CREATE_INPUT, includedServiceIds: ["svc-breast"] },
        WRITE_ON,
      ),
    ).rejects.toThrow(/Demo \/ seed services/);
  });

  it("refuses STAFF and keeps create-only", async () => {
    await expect(
      runAuthenticatedPackageWriteCreate(
        staffClient(),
        { ...CREATE_INPUT, createdByStaffId: STAFF_TECH },
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(PackageWriteUnauthorizedError);
    const persistence = await createAuthenticatedPackageWritePersistence(ownerClient());
    expect(() => persistence.fulfill()).toThrow(PackageWriteCreateOnlyError);
    expect(() => persistence.redeem()).toThrow(PackageWriteCreateOnlyError);
    expect(() => persistence.adjustLedger()).toThrow(PackageWriteCreateOnlyError);
    expect(() => persistence.packages.insertCustomerPackage()).toThrow(
      PackageWriteCreateOnlyError,
    );
  });

  it("does not fall back to localStorage when remote insert fails", async () => {
    const before = listPackageDefinitions(ORG_ENJOYE_ID).length;
    await expect(
      runAuthenticatedPackageWriteCreate(
        ownerClient(undefined, "permission denied for table package_definitions"),
        CREATE_INPUT,
        WRITE_ON,
      ),
    ).rejects.toThrow(/permission denied for table package_definitions/);
    expect(listPackageDefinitions(ORG_ENJOYE_ID)).toHaveLength(before);
    expect(
      listPackageDefinitions(ORG_ENJOYE_ID).some((row) => row.name === "性感美胸10堂"),
    ).toBe(false);
  });

  it("keeps a foreign organization out of the write", async () => {
    await expect(
      runAuthenticatedPackageWriteCreate(
        ownerClient(),
        { ...CREATE_INPUT, organizationId: "org-unrelated" },
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
  });

  it("maps user-safe errors and insert-only collisions", () => {
    expect(packageWriteUserMessage(new PackageWritePilotOffError())).toBe(PACKAGE_WRITE_UI.off);
    expect(packageWriteUserMessage(new PackageWriteUnauthorizedError())).toBe(
      PACKAGE_WRITE_UI.unauthorized,
    );
    expect(PACKAGE_WRITE_INSERT_ONLY_MESSAGE).toMatch(/insert-only/);
  });

  it("does not use service-role or dual-write localStorage", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/packages/package-remote-write-pilot.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(source).not.toMatch(/localStorage\.setItem|from ["']@\/lib\/packages\/store["']/);
    expect(source).toMatch(/insertDefinition/);
  });
});
