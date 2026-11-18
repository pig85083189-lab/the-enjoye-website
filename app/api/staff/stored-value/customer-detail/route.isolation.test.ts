import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_APP = "org-the-enjoye";
const ORG_DB = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_DB = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_APP = "cust-line-finance-001";

const state = vi.hoisted(() => ({
  membership: { status: "ok", membership: { role: "OWNER", isActive: true } } as
    { status: string; membership: { role: string; isActive: boolean } | null },
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  touched: [] as string[],
}));

vi.mock("@/lib/staff-auth/server", () => ({
  getAuthenticatedStaffMembership: async () => state.membership,
}));
vi.mock("@/lib/staff-auth/operational-capabilities", () => ({
  canCheckout: (membership: { role: string; isActive: boolean } | null) =>
    Boolean(membership?.isActive && ["OWNER", "MANAGER", "STAFF", "RECEPTIONIST"].includes(membership.role)),
}));
vi.mock("@/lib/supabase/beauty-os-finance", () => ({
  createBeautyOsFinanceClient: () => ({
    from(table: string) {
      state.touched.push(`from:${table}`);
      const eqs: Array<[string, string]> = [];
      const builder = {
        select(_columns: string) { return builder; },
        eq(column: string, value: string) { eqs.push([column, value]); return builder; },
        limit(count: number) {
          const data = (state.tables[table] ?? [])
            .filter((row) => eqs.every(([column, value]) => row[column] === value))
            .slice(0, count);
          return Promise.resolve({ data, error: null });
        },
      };
      return builder;
    },
  }),
}));

import { GET } from "./route";

function request(org = ORG_APP, customer = CUSTOMER_APP) {
  const params = new URLSearchParams({ organizationId: org, customerId: customer });
  return new Request(`https://beauty.example/api/staff/stored-value/customer-detail?${params}`);
}

describe("stored-value customer profile is scoped and read-only", () => {
  beforeEach(() => {
    state.membership = { status: "ok", membership: { role: "OWNER", isActive: true } };
    state.touched = [];
    state.tables = {
      organizations: [{ id: ORG_DB, app_id: ORG_APP }],
      customers: [{
        id: CUSTOMER_DB,
        organization_id: ORG_DB,
        app_id: CUSTOMER_APP,
        full_name: "LINE 會員",
        phone: "0911000000",
        created_at: "2026-11-15T09:00:00Z",
        updated_at: "2026-11-15T09:00:00Z",
      }],
      stored_value_accounts: [{
        id: "33333333-3333-4333-8333-333333333333",
        organization_id: ORG_DB,
        customer_id: CUSTOMER_DB,
      }],
      stored_value_ledger_entries: [{
        organization_id: ORG_DB,
        account_id: "33333333-3333-4333-8333-333333333333",
        amount_delta_minor: 2100,
      }],
    };
  });

  it("returns the finance customer's canonical app id without modifying records", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.customer).toMatchObject({
      id: CUSTOMER_APP,
      organizationId: ORG_APP,
      name: "LINE 會員",
      phone: "0911000000",
    });
    expect(json.storedValueBalanceMinor).toBe(2100);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(state.touched).toEqual([
      "from:organizations",
      "from:customers",
      "from:stored_value_accounts",
      "from:stored_value_ledger_entries",
    ]);
  });

  it("rejects unauthenticated and unauthorized requests before database access", async () => {
    state.membership = { status: "unauthenticated", membership: null };
    expect((await GET(request())).status).toBe(401);
    state.membership = { status: "ok", membership: { role: "ACCOUNTANT", isActive: true } };
    expect((await GET(request())).status).toBe(403);
    expect(state.touched).toEqual([]);
  });

  it("never finds customers belonging to another organization", async () => {
    state.tables.customers = [{ ...state.tables.customers![0], organization_id: "another-org-db" }];
    expect((await GET(request())).status).toBe(404);
  });

  it("does not return a profile without a stored-value account", async () => {
    state.tables.stored_value_accounts = [];
    expect((await GET(request())).status).toBe(404);
  });
});
