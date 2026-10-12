import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SERVICE_REMOTE_READ_PILOT_ENV,
  createAuthenticatedServiceReadPersistence,
  getRemotePilotService,
  isServiceRemoteReadPilotEnabled,
  listRemotePilotServices,
} from "./service-remote-read-pilot";
import {
  SERVICE_REMOTE_READ_ONLY_MESSAGE,
  ServiceRemoteReadOnlyError,
} from "@/lib/persistence/authenticated-service-read-store";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
  IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import { getServicesForOrganization } from "@/lib/services/store";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const AUTH_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORG_APP = "org-the-enjoye";
const ORG_UUID = "62bd49b6-a4c3-4da1-b53e-4746923685f1";
const FOREIGN_ORG_UUID = "99999999-9999-4999-8999-999999999999";
const LOC_APP = "loc-enjoye-main";
const LOC_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STAFF_APP = "staff-001";
const SVC_APP_ID = "svc-muqm5pht-nqlpr3";
const SVC_DB_ID = "bd4c1822-5375-48b6-a4f4-dd231da10ef2";

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

function officialServiceRow(overrides: Row = {}): Row {
  return {
    id: SVC_DB_ID,
    organization_id: ORG_UUID,
    app_id: SVC_APP_ID,
    name: "正式美胸 SPA",
    service_type: "BREAST",
    duration_minutes: 100,
    price_minor: 3200,
    currency: "TWD",
    category: "美胸",
    is_active: true,
    created_at: "2026-10-06T00:00:00.000Z",
    updated_at: "2026-10-06T00:00:00.000Z",
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
    customers: [],
    services: [officialServiceRow()],
    ...overrides,
  };
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

function ownerClient(overrides?: Partial<Record<string, Row[]>>, errors?: Record<string, string>) {
  return fakeClient({
    userId: AUTH_UUID,
    tables: validTables(overrides),
    errors,
  });
}

describe("Service remote read pilot", () => {
  it("stays off unless the env is exactly 1", () => {
    expect(SERVICE_REMOTE_READ_PILOT_ENV).toBe("BEAUTY_OS_SERVICE_REMOTE_READ_PILOT");
    expect(isServiceRemoteReadPilotEnabled({})).toBe(false);
    expect(
      isServiceRemoteReadPilotEnabled({
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe(false);
    expect(isServiceRemoteReadPilotEnabled({ [SERVICE_REMOTE_READ_PILOT_ENV]: "1" })).toBe(true);
    expect(getPersistenceDriver({ [SERVICE_REMOTE_READ_PILOT_ENV]: "1" })).toBe("local");
  });

  it("lists canonical public.services and does not fall back to seed catalog", async () => {
    const local = getServicesForOrganization(ORG_ENJOYE_ID);
    expect(local.some((row) => row.id === "svc-breast")).toBe(true);
    const remote = await listRemotePilotServices(ORG_APP, ownerClient());
    expect(remote).toEqual([
      expect.objectContaining({
        id: SVC_APP_ID,
        organizationId: ORG_APP,
        name: "正式美胸 SPA",
        durationMinutes: 100,
        priceMinor: 3200,
        isActive: true,
      }),
    ]);
    expect(remote.some((row) => row.id === "svc-breast")).toBe(false);
    expect(remote.some((row) => row.name === "性感美胸 SPA")).toBe(false);
  });

  it("returns empty when Production services are 0", async () => {
    const remote = await listRemotePilotServices(ORG_APP, ownerClient({ services: [] }));
    expect(remote).toEqual([]);
    expect(getServicesForOrganization(ORG_ENJOYE_ID).length).toBeGreaterThan(0);
  });

  it("resolves app id and refuses write on the read store", async () => {
    const persistence = await createAuthenticatedServiceReadPersistence(ownerClient());
    expect(persistence.identity.mapper.resolveServiceDbId(ORG_APP, SVC_APP_ID)).toBe(SVC_DB_ID);
    const row = await getRemotePilotService(ORG_APP, SVC_APP_ID, ownerClient());
    expect(row?.id).toBe(SVC_APP_ID);
    await expect(
      persistence.services.create(ORG_APP, {
        name: "不應寫入",
        durationMinutes: 60,
        priceMinor: 1000,
        createdByStaffId: STAFF_APP,
      }),
    ).rejects.toBeInstanceOf(ServiceRemoteReadOnlyError);
    await expect(
      persistence.services.create(ORG_APP, {
        name: "不應寫入",
        durationMinutes: 60,
        priceMinor: 1000,
        createdByStaffId: STAFF_APP,
      }),
    ).rejects.toThrow(SERVICE_REMOTE_READ_ONLY_MESSAGE);
  });

  it("keeps foreign organization rows out and does not fallback on error", async () => {
    const rows = await listRemotePilotServices(
      ORG_APP,
      ownerClient({
        services: [
          officialServiceRow(),
          officialServiceRow({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            organization_id: FOREIGN_ORG_UUID,
            app_id: "svc-foreign-org",
            name: "Foreign Tenant Service",
          }),
        ],
      }),
    );
    expect(rows.map((row) => row.id)).toEqual([SVC_APP_ID]);
    await expect(listRemotePilotServices("org-unrelated", ownerClient())).rejects.toMatchObject({
      name: "IdentityCatalogError",
      reason: "missing_membership",
    });
    await expect(
      listRemotePilotServices(
        ORG_APP,
        ownerClient(undefined, { services: "permission denied for table services" }),
      ),
    ).rejects.toThrow(/permission denied for table services/);
  });

  it("does not put service-role or localStorage writes on the read pilot", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/services/service-remote-read-pilot.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(source).not.toMatch(/lib\/services\/store|localStorage/);
    expect(source).not.toMatch(/export async function createServiceRecord/);
  });
});
