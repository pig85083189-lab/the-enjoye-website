import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuthenticatedExpenseReadStore,
  AuthenticatedExpenseStore,
} from "@/lib/finance/authenticated-expense-store";
import {
  EXPENSE_REMOTE_WRITE_PILOT_ENV,
  EXPENSE_REMOTE_WRITE_PILOT_OFF_MESSAGE,
  createAuthenticatedExpenseWrite,
  runAuthenticatedExpenseCreate,
  type ExpenseWriteClient,
} from "@/lib/finance/expense-remote-write-pilot";
import { FINANCE_REMOTE_READ_PILOT_ENV } from "@/lib/finance/finance-remote-read-flag";
import { isExpenseRemoteWritePilotEnabled } from "@/lib/finance/expense-remote-write-flag";
import { FINANCE_STORED_VALUE_WRITE_OPEN } from "@/lib/finance/domain";
import { STORED_VALUE_WRITE_OPEN } from "@/lib/commerce/transaction-tender-presentation";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
} from "@/lib/persistence/authenticated-identity-catalog";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { LOC_ENJOYE_PRIMARY_ID, LOC_ENJOYE_SECONDARY_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const AUTH_OWNER = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const AUTH_MANAGER = "22222222-2222-4222-8222-222222222222";
const AUTH_STAFF = "33333333-3333-4333-8333-333333333333";
const AUTH_RECEPTIONIST = "44444444-4444-4444-8444-444444444444";
const AUTH_ACCOUNTANT = "55555555-5555-4555-8555-555555555555";
const ORG_UUID = "62bd49b6-a4c3-4da1-b53e-4746923685f1";
const LOC_UUID = "c46b700c-bb42-45ce-be53-4484e217c3f8";
const GONGYI_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const WRITE_ON = {
  [FINANCE_REMOTE_READ_PILOT_ENV]: "1",
  [EXPENSE_REMOTE_WRITE_PILOT_ENV]: "1",
};

type Row = Record<string, unknown>;

class FakeQuery implements IdentityQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly filters: Array<{ column: string; value?: string; values?: string[] }> = [],
    private readonly error: { message: string; code?: string } | null = null,
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

function membership(role: string, authUserId: string, userId: string): Row {
  return {
    id: `mem-${userId}`,
    user_id: userId,
    auth_user_id: authUserId,
    organization_id: ORG_ENJOYE_ID,
    role,
    is_active: true,
    display_name: role,
  };
}

function validTables(overrides?: Partial<Record<string, Row[]>>): Record<string, Row[]> {
  return {
    staff_auth_memberships: [membership("OWNER", AUTH_OWNER, "staff-001")],
    organizations: [{ id: ORG_UUID, app_id: ORG_ENJOYE_ID }],
    locations: [
      { id: LOC_UUID, app_id: LOC_ENJOYE_PRIMARY_ID, organization_id: ORG_UUID },
      { id: GONGYI_UUID, app_id: LOC_ENJOYE_SECONDARY_ID, organization_id: ORG_UUID },
    ],
    customers: [],
    services: [],
    expenses: [],
    ...overrides,
  };
}

function fakeClient(input: {
  userId: string | null;
  tables: Record<string, Row[]>;
  insertError?: { message: string; code?: string };
}): ExpenseWriteClient {
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
                return new FakeQuery([], [], input.insertError);
              }
              const row = {
                ...payload,
                id: crypto.randomUUID(),
                created_at: "2026-10-06T02:00:00.000Z",
                updated_at: "2026-10-06T02:00:00.000Z",
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

function createInput(over: Partial<Parameters<typeof runAuthenticatedExpenseCreate>[1]> = {}) {
  return {
    organizationId: ORG_ENJOYE_ID,
    locationId: LOC_ENJOYE_PRIMARY_ID,
    expenseDate: "2026-10-06",
    category: "RENT" as const,
    name: "10 月店租",
    amountMinor: 23000,
    paymentMethod: "TRANSFER" as const,
    vendor: "房東",
    note: "10 月份店租",
    appId: "exp-mtest01-abc123",
    ...over,
  };
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("expense remote write", () => {
  it("stays fail-closed unless READ + WRITE flags are both 1", () => {
    expect(isExpenseRemoteWritePilotEnabled({})).toBe(false);
    expect(
      isExpenseRemoteWritePilotEnabled({ [EXPENSE_REMOTE_WRITE_PILOT_ENV]: "1" }),
    ).toBe(false);
    expect(isExpenseRemoteWritePilotEnabled(WRITE_ON)).toBe(true);
    expect(() => createAuthenticatedExpenseWrite()).toThrow(EXPENSE_REMOTE_WRITE_PILOT_OFF_MESSAGE);
    expect(getPersistenceDriver(WRITE_ON)).toBe("local");
    expect(FINANCE_STORED_VALUE_WRITE_OPEN).toBe(false);
    expect(STORED_VALUE_WRITE_OPEN).toBe(false);
  });

  it("creates for OWNER and MANAGER with operational staff id", async () => {
    const ownerTables = validTables();
    const owner = await runAuthenticatedExpenseCreate(
      fakeClient({ userId: AUTH_OWNER, tables: ownerTables }),
      createInput(),
      WRITE_ON,
    );
    expect(owner.appId).toMatch(/^exp-/);
    expect(owner.createdByStaffId).toBe("staff-001");
    expect(owner.createdByStaffId).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(owner.amountMinor).toBe(23000);
    expect(owner.organizationId).toBe(ORG_ENJOYE_ID);
    expect(owner.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    expect(ownerTables.expenses).toHaveLength(1);
    expect(ownerTables.expenses[0]?.created_by_staff_id).toBe("staff-001");

    const managerTables = validTables({
      staff_auth_memberships: [membership("MANAGER", AUTH_MANAGER, "staff-002")],
    });
    const manager = await runAuthenticatedExpenseCreate(
      fakeClient({ userId: AUTH_MANAGER, tables: managerTables }),
      createInput({ appId: "exp-mtest02-def456" }),
      WRITE_ON,
    );
    expect(manager.createdByStaffId).toBe("staff-002");
  });

  it("rejects STAFF, RECEPTIONIST, ACCOUNTANT, wrong org/location, and amount <= 0", async () => {
    await expect(
      runAuthenticatedExpenseCreate(
        fakeClient({
          userId: AUTH_STAFF,
          tables: validTables({
            staff_auth_memberships: [membership("STAFF", AUTH_STAFF, "staff-010")],
          }),
        }),
        createInput({ appId: "exp-mtest03-aaa111" }),
        WRITE_ON,
      ),
    ).rejects.toThrow(/Unauthorized to create expenses/);
    await expect(
      runAuthenticatedExpenseCreate(
        fakeClient({
          userId: AUTH_RECEPTIONIST,
          tables: validTables({
            staff_auth_memberships: [membership("RECEPTIONIST", AUTH_RECEPTIONIST, "staff-011")],
          }),
        }),
        createInput({ appId: "exp-mtest04-bbb222" }),
        WRITE_ON,
      ),
    ).rejects.toThrow(/Unauthorized to create expenses/);
    await expect(
      runAuthenticatedExpenseCreate(
        fakeClient({
          userId: AUTH_ACCOUNTANT,
          tables: validTables({
            staff_auth_memberships: [membership("ACCOUNTANT", AUTH_ACCOUNTANT, "staff-012")],
          }),
        }),
        createInput({ appId: "exp-mtest05-ccc333" }),
        WRITE_ON,
      ),
    ).rejects.toThrow(/Unauthorized to create expenses/);
    await expect(
      runAuthenticatedExpenseCreate(
        fakeClient({ userId: AUTH_OWNER, tables: validTables() }),
        createInput({ organizationId: "org-lumiere", appId: "exp-mtest06-ddd444" }),
        WRITE_ON,
      ),
    ).rejects.toMatchObject({
      name: "IdentityCatalogError",
      reason: "missing_membership",
    });
    await expect(
      runAuthenticatedExpenseCreate(
        fakeClient({ userId: AUTH_OWNER, tables: validTables({ locations: [] }) }),
        createInput({ locationId: LOC_ENJOYE_SECONDARY_ID, appId: "exp-mtest07-eee555" }),
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
    await expect(
      runAuthenticatedExpenseCreate(
        fakeClient({ userId: AUTH_OWNER, tables: validTables() }),
        createInput({ amountMinor: 0, appId: "exp-mtest08-fff666" }),
        WRITE_ON,
      ),
    ).rejects.toThrow(/positive integer/);
    await expect(
      runAuthenticatedExpenseCreate(
        fakeClient({ userId: AUTH_OWNER, tables: validTables() }),
        createInput(),
        { [FINANCE_REMOTE_READ_PILOT_ENV]: "1" },
      ),
    ).rejects.toThrow(EXPENSE_REMOTE_WRITE_PILOT_OFF_MESSAGE);
  });

  it("refuses update/delete and does not use localStorage or service-role", () => {
    const store = createAuthenticatedExpenseWrite(
      fakeClient({ userId: AUTH_OWNER, tables: validTables() }),
      WRITE_ON,
    );
    expect(store).toBeInstanceOf(AuthenticatedExpenseStore);
    expect(() => store.updateExpense()).toThrow(/create-only/);
    expect(() => store.deleteExpense()).toThrow(/create-only/);
    const readOnly = new AuthenticatedExpenseReadStore({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from() {
        throw new Error("unused");
      },
    });
    expect(() => readOnly.insertExpense()).toThrow(/read-only/);
    for (const rel of [
      "lib/finance/expense-remote-write-pilot.ts",
      "lib/finance/authenticated-expense-store.ts",
      "features/finance/use-expense-remote-write.ts",
      "features/finance/ExpenseFormDialog.tsx",
    ]) {
      const text = source(rel);
      expect(text).not.toMatch(/\blocalStorage\./);
      expect(text).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
      expect(text).not.toMatch(/BEAUTY_OS_PERSISTENCE/);
    }
  });
});
