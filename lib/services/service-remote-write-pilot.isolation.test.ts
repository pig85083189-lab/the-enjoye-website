import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SERVICE_REMOTE_WRITE_PILOT_ENV,
  ServiceWriteCreateOnlyError,
  ServiceWritePilotOffError,
  ServiceWriteUnauthorizedError,
  createAuthenticatedServiceWritePersistence,
  isServiceRemoteWritePilotEnabled,
  runAuthenticatedServiceWriteCreate,
} from "./service-remote-write-pilot";
import { SERVICE_REMOTE_READ_PILOT_ENV } from "./service-remote-read-flag";
import { SERVICE_WRITE_UI, serviceWriteUserMessage } from "./service-write-ui-error";
import { SERVICE_WRITE_INSERT_ONLY_MESSAGE } from "@/lib/persistence/authenticated-service-write-store";
import { REMOTE_SERVICE_COLUMNS } from "@/lib/persistence/service-mapping";
import type { ServiceWriteClient } from "./service-remote-write-pilot";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
} from "@/lib/persistence/authenticated-identity-catalog";
import { IdentityCatalogError, UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { isGeneratedServiceAppId } from "@/lib/persistence/demo-firewall";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import { getServicesForOrganization } from "@/lib/services/store";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const AUTH_STAFF = "11111111-1111-4111-8111-111111111111";
const ORG_APP = "org-the-enjoye";
const ORG_UUID = "62bd49b6-a4c3-4da1-b53e-4746923685f1";
const LOC_APP = "loc-enjoye-main";
const LOC_UUID = "c46b700c-bb42-45ce-be53-4484e217c3f8";
const STAFF_APP = "staff-001";
const STAFF_TECH = "staff-002";

type Row = Record<string, unknown>;

const WRITE_ON = {
  [SERVICE_REMOTE_WRITE_PILOT_ENV]: "1",
  [SERVICE_REMOTE_READ_PILOT_ENV]: "1",
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
    services: [],
    ...overrides,
  };
}

function fakeClient(input: {
  userId: string | null;
  tables: Record<string, Row[]>;
  insertError?: string;
}): ServiceWriteClient {
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

describe("Service remote write pilot flag", () => {
  it("stays off unless write + read are both 1", () => {
    expect(isServiceRemoteWritePilotEnabled({})).toBe(false);
    expect(
      isServiceRemoteWritePilotEnabled({
        [SERVICE_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(false);
    expect(isServiceRemoteWritePilotEnabled(WRITE_ON)).toBe(true);
    expect(
      isServiceRemoteWritePilotEnabled({
        ...WRITE_ON,
        VERCEL_ENV: "production",
      }),
    ).toBe(true);
    expect(getPersistenceDriver(WRITE_ON)).toBe("local");
  });
});

describe("Service remote write create", () => {
  it("refuses create when the pilot is off", async () => {
    await expect(
      runAuthenticatedServiceWriteCreate(
        ownerClient(),
        {
          organizationId: ORG_APP,
          name: "正式美胸 SPA",
          durationMinutes: 100,
          priceMinor: 3200,
          createdByStaffId: STAFF_APP,
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ServiceWritePilotOffError);
  });

  it("requires an authenticated staff session", async () => {
    await expect(
      runAuthenticatedServiceWriteCreate(
        fakeClient({ userId: null, tables: validTables() }),
        {
          organizationId: ORG_APP,
          name: "正式美胸 SPA",
          durationMinutes: 100,
          priceMinor: 3200,
          createdByStaffId: STAFF_APP,
        },
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(IdentityCatalogError);
  });

  it("lets OWNER create an official service with generated svc-* and price_minor", async () => {
    const tables = validTables();
    const created = await runAuthenticatedServiceWriteCreate(
      fakeClient({ userId: AUTH_UUID, tables }),
      {
        organizationId: ORG_APP,
        name: "性感美胸 SPA",
        durationMinutes: 100,
        priceMinor: 3200,
        createdByStaffId: STAFF_APP,
        category: "美胸",
      },
      WRITE_ON,
    );
    expect(isGeneratedServiceAppId(created.id)).toBe(true);
    expect(created.id.startsWith("svc-")).toBe(true);
    expect(created.id).not.toBe("svc-breast");
    expect(created.organizationId).toBe(ORG_APP);
    expect(created.name).toBe("性感美胸 SPA");
    expect(created.durationMinutes).toBe(100);
    expect(created.priceMinor).toBe(3200);
    const row = tables.services.find((item) => item.app_id === created.id);
    expect(row).toBeTruthy();
    expect(row?.id).not.toBe(created.id);
    expect(String(row?.id)).toMatch(/^[0-9a-f-]{36}$/i);
    expect(row?.organization_id).toBe(ORG_UUID);
    expect(row?.price_minor).toBe(3200);
    expect(row?.name).toBe("性感美胸 SPA");
    expect(REMOTE_SERVICE_COLUMNS).toContain("price_minor");
    expect(REMOTE_SERVICE_COLUMNS).not.toContain("price");
  });

  it("blocks QA / demo names and seed ids", async () => {
    await expect(
      runAuthenticatedServiceWriteCreate(
        ownerClient(),
        {
          organizationId: ORG_APP,
          name: "Remote QA Bust Care",
          durationMinutes: 100,
          priceMinor: 3200,
          createdByStaffId: STAFF_APP,
        },
        WRITE_ON,
      ),
    ).rejects.toThrow(/Demo \/ seed services/);
  });

  it("refuses STAFF and keeps create-only", async () => {
    await expect(
      runAuthenticatedServiceWriteCreate(
        staffClient(),
        {
          organizationId: ORG_APP,
          name: "正式曲線 SPA",
          durationMinutes: 100,
          priceMinor: 3500,
          createdByStaffId: STAFF_TECH,
        },
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(ServiceWriteUnauthorizedError);
    const tables = validTables();
    const persistence = await createAuthenticatedServiceWritePersistence(
      fakeClient({ userId: AUTH_UUID, tables }),
    );
    expect(() => persistence.update()).toThrow(ServiceWriteCreateOnlyError);
    expect(() => persistence.deactivate()).toThrow(ServiceWriteCreateOnlyError);
    const created = await persistence.services.create(ORG_APP, {
      name: "先建立再改",
      durationMinutes: 60,
      priceMinor: 1800,
      createdByStaffId: STAFF_APP,
    });
    await expect(
      persistence.services.upsert(
        ORG_APP,
        {
          ...created,
          name: "不應改名",
        },
        STAFF_APP,
      ),
    ).rejects.toBeInstanceOf(ServiceWriteCreateOnlyError);
  });

  it("does not fall back to localStorage when remote insert fails", async () => {
    const before = getServicesForOrganization(ORG_ENJOYE_ID).length;
    await expect(
      runAuthenticatedServiceWriteCreate(
        ownerClient(undefined, "permission denied for table services"),
        {
          organizationId: ORG_APP,
          name: "失敗服務",
          durationMinutes: 60,
          priceMinor: 1800,
          createdByStaffId: STAFF_APP,
        },
        WRITE_ON,
      ),
    ).rejects.toThrow(/permission denied for table services/);
    expect(getServicesForOrganization(ORG_ENJOYE_ID)).toHaveLength(before);
    expect(
      getServicesForOrganization(ORG_ENJOYE_ID).some((row) => row.name === "失敗服務"),
    ).toBe(false);
  });

  it("keeps a foreign organization out of the write", async () => {
    await expect(
      runAuthenticatedServiceWriteCreate(
        ownerClient(),
        {
          organizationId: "org-unrelated",
          name: "跨機構",
          durationMinutes: 60,
          priceMinor: 1000,
          createdByStaffId: STAFF_APP,
        },
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
  });

  it("maps user-safe errors and insert-only collisions", () => {
    expect(serviceWriteUserMessage(new ServiceWritePilotOffError())).toBe(SERVICE_WRITE_UI.off);
    expect(serviceWriteUserMessage(new ServiceWriteUnauthorizedError())).toBe(
      SERVICE_WRITE_UI.unauthorized,
    );
    expect(SERVICE_WRITE_INSERT_ONLY_MESSAGE).toMatch(/insert-only/);
  });

  it("does not use service-role or dual-write localStorage", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/services/service-remote-write-pilot.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(source).not.toMatch(/localStorage\.setItem|from ["']@\/lib\/services\/store["']/);
    expect(source).toMatch(/createServiceRecord/);
  });
});
