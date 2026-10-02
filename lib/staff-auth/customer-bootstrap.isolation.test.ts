import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_TARGET,
  BOOTSTRAP_UNRELATED_LOC_UUID,
  BOOTSTRAP_UNRELATED_ORG_UUID,
  CUSTOMER_BOOTSTRAP_ROUTE,
  FIRST_REMOTE_CUSTOMER_PAYLOAD,
  REMOTE_QA_CUSTOMER_NAME,
  REMOTE_QA_CUSTOMER_PHONE,
  createFirstRemoteQaCustomer,
  findExistingRemoteQaCustomer,
  isPreviewOnlyBootstrapAllowed,
  loadCustomerBootstrapContext,
  rlsPrecheckPassed,
  type CustomerBootstrapClient,
} from "./customer-bootstrap";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import { isGeneratedCustomerAppId } from "@/lib/persistence/demo-firewall";
import type {
  CustomerQueryBuilder,
  CustomerQueryResult,
} from "@/lib/persistence/authenticated-customer-store";
import type { IdentityQueryBuilder, IdentityQueryResult } from "@/lib/persistence/authenticated-identity-catalog";

const ROOT = process.cwd();
const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";

type Row = Record<string, unknown>;

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

class FakeQuery implements CustomerQueryBuilder, IdentityQueryBuilder {
  constructor(
    private readonly tables: Record<string, Row[]>,
    private readonly table: string,
    private readonly mode: "select" | "insert" | "update",
    private readonly payload?: Row,
    private readonly filters: Array<{ column: string; value: string }> = [],
  ) {}

  eq(column: string, value: string): FakeQuery {
    return new FakeQuery(this.tables, this.table, this.mode, this.payload, [
      ...this.filters,
      { column, value },
    ]);
  }

  in(): FakeQuery {
    return this;
  }

  select(): FakeQuery {
    return this;
  }

  then<TResult1 = CustomerQueryResult, TResult2 = never>(
    onfulfilled?: ((value: CustomerQueryResult & IdentityQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.mode === "insert" && this.payload) {
      this.tables[this.table] = [...(this.tables[this.table] ?? []), this.payload];
      return Promise.resolve({ data: [this.payload], error: null }).then(onfulfilled, onrejected);
    }
    if (this.mode === "update" && this.payload) {
      const rows = this.tables[this.table] ?? [];
      const idx = rows.findIndex((row) =>
        this.filters.every((filter) => row[filter.column] === filter.value),
      );
      if (idx >= 0) rows[idx] = { ...rows[idx], ...this.payload };
      return Promise.resolve({ data: idx >= 0 ? [rows[idx]] : [], error: null }).then(
        onfulfilled,
        onrejected,
      );
    }
    const data = (this.tables[this.table] ?? []).filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function fakeClient(input: {
  userId: string | null;
  tables: Record<string, Row[]>;
  rpc: Record<string, unknown>;
  inserts?: Row[];
}): CustomerBootstrapClient {
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
          return new FakeQuery(input.tables, table, "select");
        },
        insert(payload: Record<string, unknown>) {
          input.inserts?.push(payload);
          return new FakeQuery(input.tables, table, "insert", payload);
        },
        update(payload: Record<string, unknown>) {
          return new FakeQuery(input.tables, table, "update", payload);
        },
      };
    },
    async rpc(fn: string) {
      return { data: input.rpc[fn] ?? null, error: null };
    },
  };
}

function passingRpc() {
  return {
    user_has_org_membership: true,
    user_org_role: "OWNER",
    user_can_access_location: true,
  };
}

function targetTables(overrides?: Partial<Record<string, Row[]>>): Record<string, Row[]> {
  return {
    staff_auth_memberships: [
      {
        id: "mem-enjoye-owner",
        user_id: BOOTSTRAP_TARGET.operationalStaffId,
        auth_user_id: AUTH_UUID,
        organization_id: BOOTSTRAP_TARGET.organizationAppId,
        role: "OWNER",
        is_active: true,
      },
    ],
    organizations: [
      { id: BOOTSTRAP_TARGET.organizationDbId, app_id: BOOTSTRAP_TARGET.organizationAppId },
    ],
    locations: [
      {
        id: BOOTSTRAP_TARGET.locationDbId,
        app_id: BOOTSTRAP_TARGET.locationAppId,
        organization_id: BOOTSTRAP_TARGET.organizationDbId,
      },
    ],
    customers: [],
    services: [],
    ...overrides,
  };
}

describe("Phase 1C-2A first remote customer bootstrap", () => {
  it("uses createCustomer + CustomerRemoteAdapter without flags or service role", () => {
    const helper = source("lib/staff-auth/customer-bootstrap.ts");
    const store = source("lib/persistence/authenticated-customer-store.ts");
    const page = source("app/staff/customer-bootstrap/page.tsx");
    const client = source("app/staff/customer-bootstrap/CustomerBootstrapClient.tsx");
    expect(helper).toMatch(/createCustomer\(/);
    expect(helper).toMatch(/new CustomerRemoteAdapter/);
    expect(helper).toMatch(/buildRealCustomerCreate|createCustomer/);
    expect(helper).not.toMatch(/createRemoteOperationalPersistence/);
    expect(helper).not.toMatch(/REMOTE_FLAGS/);
    expect(helper).not.toMatch(/BEAUTY_OS_PERSISTENCE/);
    expect(helper).not.toMatch(/createServiceRoleClient/);
    expect(helper).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(store).not.toMatch(/upsert\(/);
    expect(store).toMatch(/insert-only/);
    expect(page).toMatch(/CustomerBootstrapClient/);
    expect(page).toMatch(/isPreviewOnlyBootstrapAllowed/);
    expect(page).not.toMatch(/createServiceRoleClient/);
    expect(client).toMatch(/auth\.getUser\(\)/);
    expect(client).toMatch(/Create First Remote Customer/);
    expect(client).toMatch(/Existing \/ PASS/);
    expect(client).toMatch(/No token displayed/);
    expect(client).not.toMatch(/accessToken|idToken|jwt/i);
    expect(client).not.toMatch(/createServiceRoleClient/);
    expect(client).not.toMatch(/from\(\s*["']customers["']\s*\)/);
    expect(getPersistenceDriver({})).toBe("local");
  });

  it("protects the route and blocks Production", () => {
    expect(existsSync(path.join(ROOT, "app/staff/customer-bootstrap/page.tsx"))).toBe(true);
    const proxy = source("lib/supabase/proxy.ts");
    expect(proxy).not.toMatch(/customer-bootstrap/);
    expect(CUSTOMER_BOOTSTRAP_ROUTE).toBe("/staff/customer-bootstrap");
    expect(isPreviewOnlyBootstrapAllowed("preview")).toBe(true);
    expect(isPreviewOnlyBootstrapAllowed(undefined)).toBe(true);
    expect(isPreviewOnlyBootstrapAllowed("production")).toBe(false);
    const page = source("app/staff/customer-bootstrap/page.tsx");
    expect(page).toMatch(/VERCEL_ENV/);
    expect(page).toMatch(/Preview-only route/);
  });

  it("requires Owner RLS positives and isolation-safe negatives", () => {
    expect(
      rlsPrecheckPassed({
        organizationMembership: true,
        organizationRole: "OWNER",
        locationAccess: true,
        unrelatedOrganizationMembership: false,
        unrelatedLocationAccess: false,
      }),
    ).toBe(true);
    expect(
      rlsPrecheckPassed({
        organizationMembership: true,
        organizationRole: "STAFF",
        locationAccess: true,
        unrelatedOrganizationMembership: false,
        unrelatedLocationAccess: false,
      }),
    ).toBe(false);
    expect(BOOTSTRAP_UNRELATED_ORG_UUID).toBe("00000000-0000-4000-8000-000000000001");
    expect(BOOTSTRAP_UNRELATED_LOC_UUID).toBe("00000000-0000-4000-8000-000000000002");
    expect(FIRST_REMOTE_CUSTOMER_PAYLOAD).toEqual({
      organizationId: "org-the-enjoye",
      name: REMOTE_QA_CUSTOMER_NAME,
      phone: REMOTE_QA_CUSTOMER_PHONE,
      primaryStaffId: "staff-001",
    });
    expect(FIRST_REMOTE_CUSTOMER_PAYLOAD).not.toHaveProperty("id");
    expect(FIRST_REMOTE_CUSTOMER_PAYLOAD).not.toHaveProperty("email");
    expect(FIRST_REMOTE_CUSTOMER_PAYLOAD).not.toHaveProperty("lineId");
    expect(FIRST_REMOTE_CUSTOMER_PAYLOAD).not.toHaveProperty("birthday");
  });

  it("creates one QA customer through the application boundary and refuses a second insert", async () => {
    const tables = targetTables();
    const inserts: Row[] = [];
    const client = fakeClient({
      userId: AUTH_UUID,
      tables,
      rpc: passingRpc(),
      inserts,
    });
    client.rpc = async (fn, args) => {
      if (fn === "user_has_org_membership") {
        return {
          data: args.target_org === BOOTSTRAP_TARGET.organizationDbId,
          error: null,
        };
      }
      if (fn === "user_org_role") {
        return {
          data: args.target_org === BOOTSTRAP_TARGET.organizationDbId ? "OWNER" : null,
          error: null,
        };
      }
      if (fn === "user_can_access_location") {
        return {
          data:
            args.target_org === BOOTSTRAP_TARGET.organizationDbId &&
            args.target_loc === BOOTSTRAP_TARGET.locationDbId,
          error: null,
        };
      }
      return { data: null, error: null };
    };

    const ctx = await loadCustomerBootstrapContext(client);
    expect(ctx.rlsPassed).toBe(true);
    expect(ctx.identity.operationalStaffId).toBe("staff-001");
    expect(ctx.identity.organizationAppId).toBe("org-the-enjoye");
    expect(ctx.identity.locationAppId).toBe("loc-enjoye-main");
    expect(await findExistingRemoteQaCustomer(ctx.adapter)).toBeUndefined();

    const first = await createFirstRemoteQaCustomer(ctx.adapter, ctx.mapper);
    expect(first.status).toBe("created");
    expect(first.customer.name).toBe(REMOTE_QA_CUSTOMER_NAME);
    expect(first.customer.phone).toBe(REMOTE_QA_CUSTOMER_PHONE);
    expect(isGeneratedCustomerAppId(first.customer.id)).toBe(true);
    expect(first.customer.id).not.toMatch(/^[0-9a-f-]{36}$/i);
    expect(first.mapping.domainAppId).toBe(first.customer.id);
    expect(first.mapping.databaseUuid).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first.mapping.reverseAppId).toBe(first.customer.id);
    expect(first.customer.totalVisits).toBe(0);
    expect(first.customer.packages).toEqual([]);
    expect(first.customer.primaryStaffId).toBe("staff-001");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.full_name).toBe(REMOTE_QA_CUSTOMER_NAME);
    expect(inserts[0]?.app_id).toBe(first.customer.id);

    const second = await createFirstRemoteQaCustomer(ctx.adapter, ctx.mapper);
    expect(second.status).toBe("existing");
    expect(second.customer.id).toBe(first.customer.id);
    expect(inserts).toHaveLength(1);
  });

  it("hides create when a positive RLS check fails", async () => {
    const client = fakeClient({
      userId: AUTH_UUID,
      tables: targetTables(),
      rpc: {
        user_has_org_membership: true,
        user_org_role: "STAFF",
        user_can_access_location: true,
      },
    });
    client.rpc = async (fn, args) => {
      if (fn === "user_org_role") {
        return { data: args.target_org === BOOTSTRAP_TARGET.organizationDbId ? "STAFF" : null, error: null };
      }
      if (fn === "user_has_org_membership") {
        return { data: args.target_org === BOOTSTRAP_TARGET.organizationDbId, error: null };
      }
      if (fn === "user_can_access_location") {
        return {
          data:
            args.target_org === BOOTSTRAP_TARGET.organizationDbId &&
            args.target_loc === BOOTSTRAP_TARGET.locationDbId,
          error: null,
        };
      }
      return { data: null, error: null };
    };
    const ctx = await loadCustomerBootstrapContext(client);
    expect(ctx.rlsPassed).toBe(false);
  });
});
