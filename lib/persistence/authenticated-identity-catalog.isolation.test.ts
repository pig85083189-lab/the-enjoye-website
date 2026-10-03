import { describe, expect, it } from "vitest";
import { IdentityCatalogError } from "./identity-errors";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentityQueryBuilder,
  type IdentityQueryResult,
  type IdentitySupabaseClient,
} from "./authenticated-identity-catalog";
import { isAuthUuid } from "@/lib/staff-auth/staff-id";

const AUTH_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORG_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOC_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG_APP = "org-the-enjoye";
const LOC_APP = "loc-enjoye-main";
const STAFF_APP = "staff-001";

type Row = Record<string, unknown>;

class FakeQuery implements IdentityQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly filters: Array<{ column: string; value?: string; values?: string[] }> = [],
  ) {}

  eq(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value }]);
  }

  in(column: string, values: string[]): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, values }]);
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
          return new FakeQuery(input.tables[table] ?? []);
        },
      };
    },
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
    customers: [],
    services: [],
    ...overrides,
  };
}

describe("Phase 1B authenticated IdentityCatalog", () => {
  it("resolves org app_id, location app_id, and auth UUID → staff-001 without hardcoded mapping in the loader", async () => {
    const loaded = await loadAuthenticatedIdentityCatalog(
      fakeClient({ userId: AUTH_UUID, tables: validTables() }),
    );
    expect(loaded.organizationAppId).toBe(ORG_APP);
    expect(loaded.organizationDbId).toBe(ORG_UUID);
    expect(loaded.operationalStaffId).toBe(STAFF_APP);
    expect(loaded.mapper.resolveOrganizationDbId(ORG_APP)).toBe(ORG_UUID);
    expect(loaded.mapper.resolveLocationDbId(ORG_APP, LOC_APP)).toBe(LOC_UUID);
    expect(loaded.mapper.resolveOperationalStaffFromAuth(ORG_APP, AUTH_UUID)).toBe(STAFF_APP);
    expect(isAuthUuid(loaded.operationalStaffId)).toBe(false);
    expect(loaded.mapper.requireOperationalStaffId(ORG_APP, STAFF_APP)).toBe(STAFF_APP);
    expect(() => loaded.mapper.requireOperationalStaffId(ORG_APP, AUTH_UUID)).toThrow();
  });

  it("fails closed when there is no session", async () => {
    await expect(
      loadAuthenticatedIdentityCatalog(fakeClient({ userId: null, tables: validTables() })),
    ).rejects.toMatchObject({ name: "IdentityCatalogError", reason: "unauthenticated" });
  });

  it("fails closed when membership is missing", async () => {
    await expect(
      loadAuthenticatedIdentityCatalog(
        fakeClient({
          userId: AUTH_UUID,
          tables: validTables({ staff_auth_memberships: [] }),
        }),
      ),
    ).rejects.toMatchObject({ name: "IdentityCatalogError", reason: "missing_membership" });
  });

  it("fails closed when membership is ambiguous", async () => {
    await expect(
      loadAuthenticatedIdentityCatalog(
        fakeClient({
          userId: AUTH_UUID,
          tables: validTables({
            staff_auth_memberships: [
              {
                id: "mem-1",
                user_id: STAFF_APP,
                auth_user_id: AUTH_UUID,
                organization_id: ORG_APP,
                role: "OWNER",
                is_active: true,
              },
              {
                id: "mem-2",
                user_id: "staff-002",
                auth_user_id: AUTH_UUID,
                organization_id: ORG_APP,
                role: "STAFF",
                is_active: true,
              },
            ],
          }),
        }),
      ),
    ).rejects.toMatchObject({ name: "IdentityCatalogError", reason: "ambiguous_membership" });
  });

  it("fails closed when organization mapping is ambiguous", async () => {
    await expect(
      loadAuthenticatedIdentityCatalog(
        fakeClient({
          userId: AUTH_UUID,
          tables: validTables({
            organizations: [
              { id: ORG_UUID, app_id: ORG_APP },
              { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", app_id: ORG_APP },
            ],
          }),
        }),
      ),
    ).rejects.toMatchObject({ name: "IdentityCatalogError", reason: "ambiguous_mapping" });
  });

  it("rejects Auth UUID stored as operational staff id", async () => {
    await expect(
      loadAuthenticatedIdentityCatalog(
        fakeClient({
          userId: AUTH_UUID,
          tables: validTables({
            staff_auth_memberships: [
              {
                id: "mem-bad",
                user_id: AUTH_UUID,
                auth_user_id: AUTH_UUID,
                organization_id: ORG_APP,
                role: "OWNER",
                is_active: true,
              },
            ],
          }),
        }),
      ),
    ).rejects.toBeInstanceOf(IdentityCatalogError);
  });

  it("CanonicalIdMapper rejects Auth UUID as operational staff id", async () => {
    const loaded = await loadAuthenticatedIdentityCatalog(
      fakeClient({ userId: AUTH_UUID, tables: validTables() }),
    );
    expect(() => loaded.mapper.requireOperationalStaffId(ORG_APP, AUTH_UUID)).toThrow();
    expect(isAuthUuid(AUTH_UUID)).toBe(true);
  });

  it("maps org colleagues for assignment without changing authenticated operational staff", async () => {
    const loaded = await loadAuthenticatedIdentityCatalog(
      fakeClient({
        userId: AUTH_UUID,
        tables: validTables({
          staff_auth_memberships: [
            {
              id: "mem-enjoye-owner",
              user_id: STAFF_APP,
              auth_user_id: AUTH_UUID,
              organization_id: ORG_APP,
              role: "OWNER",
              is_active: true,
            },
            {
              id: "mem-enjoye-colleague",
              user_id: "staff-002",
              auth_user_id: null,
              organization_id: ORG_APP,
              role: "STAFF",
              is_active: true,
            },
            {
              id: "mem-foreign",
              user_id: "staff-foreign",
              auth_user_id: null,
              organization_id: "org-other",
              role: "STAFF",
              is_active: true,
            },
          ],
        }),
      }),
    );
    expect(loaded.operationalStaffId).toBe(STAFF_APP);
    expect(loaded.mapper.requireOperationalStaffId(ORG_APP, STAFF_APP)).toBe(STAFF_APP);
    expect(loaded.mapper.requireOperationalStaffId(ORG_APP, "staff-002")).toBe("staff-002");
    expect(() => loaded.mapper.requireOperationalStaffId(ORG_APP, "staff-foreign")).toThrow();
    expect(loaded.mapper.resolveOperationalStaffFromAuth(ORG_APP, AUTH_UUID)).toBe(STAFF_APP);
  });
});
