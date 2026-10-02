import { describe, expect, it } from "vitest";
import {
  AuthenticatedCustomerTableStore,
  type AuthenticatedCustomerSupabaseClient,
  type CustomerQueryBuilder,
  type CustomerQueryResult,
} from "./authenticated-customer-store";
import type { DbCustomer } from "./operational-rows";

type Row = Record<string, unknown>;

class FakeQuery implements CustomerQueryBuilder {
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

  select(): FakeQuery {
    return this;
  }

  then<TResult1 = CustomerQueryResult, TResult2 = never>(
    onfulfilled?: ((value: CustomerQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.mode === "insert" && this.payload) {
      this.tables[this.table] = [...(this.tables[this.table] ?? []), this.payload];
      return Promise.resolve({ data: [this.payload], error: null }).then(onfulfilled, onrejected);
    }
    const data = (this.tables[this.table] ?? []).filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function customerRow(overrides: Partial<DbCustomer> = {}): DbCustomer {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: "62bd49b6-a4c3-4da1-b53e-4746923685f1",
    app_id: "cust-k7x1-ab12cd",
    full_name: "Remote QA Customer",
    phone: "0911000001",
    email: null,
    birthday: null,
    gender: null,
    line_user_id: null,
    source: null,
    membership_tier: "new",
    is_vip: false,
    primary_staff_id: "staff-001",
    status: "ACTIVE",
    notes: null,
    created_at: "2026-10-02T00:00:00.000Z",
    updated_at: "2026-10-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("authenticated customer store", () => {
  it("inserts once and refuses a second insert for the same app id", async () => {
    const tables: Record<string, Row[]> = { customers: [] };
    const client: AuthenticatedCustomerSupabaseClient = {
      from(table: string) {
        return {
          select() {
            return new FakeQuery(tables, table, "select");
          },
          insert(payload: Record<string, unknown>) {
            return new FakeQuery(tables, table, "insert", payload);
          },
          update(payload: Record<string, unknown>) {
            return new FakeQuery(tables, table, "update", payload);
          },
        };
      },
    };
    const store = new AuthenticatedCustomerTableStore(client);
    const row = customerRow();
    await store.insertCustomer(row);
    await expect(store.insertCustomer(row)).rejects.toThrow(/insert-only/);
    const listed = await store.listCustomers(row.organization_id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.app_id).toBe(row.app_id);
    expect(listed[0]?.full_name).toBe("Remote QA Customer");
  });
});
