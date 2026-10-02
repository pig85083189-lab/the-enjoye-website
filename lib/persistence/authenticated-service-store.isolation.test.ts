import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuthenticatedServiceTableStore,
  SERVICE_INSERT_ONLY_MESSAGE,
  type AuthenticatedServiceSupabaseClient,
  type ServiceQueryBuilder,
  type ServiceQueryResult,
} from "./authenticated-service-store";
import { remoteServicePayload } from "./service-mapping";
import type { DbService } from "./operational-rows";

type Row = Record<string, unknown>;

class FakeQuery implements ServiceQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly write: ((row: Row) => void) | null = null,
    private readonly filters: Array<{ column: string; value: string }> = [],
    private readonly pendingInsert: Row | null = null,
  ) {}

  eq(column: string, value: string): ServiceQueryBuilder {
    return new FakeQuery(this.rows, this.write, [...this.filters, { column, value }], this.pendingInsert);
  }

  select(): ServiceQueryBuilder {
    return this;
  }

  then<TResult1 = ServiceQueryResult, TResult2 = never>(
    onfulfilled?: ((value: ServiceQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.pendingInsert && this.write) {
      this.write(this.pendingInsert);
      return Promise.resolve({ data: [this.pendingInsert], error: null }).then(
        onfulfilled,
        onrejected,
      );
    }
    const data = this.rows.filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function row(overrides: Partial<DbService> = {}): DbService {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: "62bd49b6-a4c3-4da1-b53e-4746923685f1",
    app_id: "svc-test01-abcdef",
    name: "Remote QA Bust Care",
    service_type: "BREAST",
    duration_minutes: 100,
    price_minor: 3200,
    currency: "TWD",
    category: "美胸",
    is_active: true,
    created_at: "2026-10-02T00:00:00.000Z",
    updated_at: "2026-10-02T00:00:00.000Z",
    ...overrides,
  };
}

function clientWith(rows: DbService[]): {
  client: AuthenticatedServiceSupabaseClient;
  inserted: Row[];
} {
  const inserted: Row[] = [];
  const store: Row[] = rows.map((item) => ({ ...item }));
  const client: AuthenticatedServiceSupabaseClient = {
    from(table: string) {
      if (table !== "services") {
        return {
          select: () => new FakeQuery([]),
          insert: () => new FakeQuery([]),
          update: () => new FakeQuery([]),
        };
      }
      return {
        select: () => new FakeQuery(store),
        insert: (payload: Record<string, unknown>) =>
          new FakeQuery(store, (next) => {
            inserted.push(next);
            store.push(next);
          }, [], payload),
        update: () => new FakeQuery(store),
      };
    },
  };
  return { client, inserted };
}

describe("AuthenticatedServiceTableStore", () => {
  it("is insert-only and refuses a second row with the same app_id", async () => {
    const existing = row();
    const { client, inserted } = clientWith([existing]);
    const store = new AuthenticatedServiceTableStore(client);
    await expect(store.insertService(existing)).rejects.toThrow(SERVICE_INSERT_ONLY_MESSAGE);
    expect(inserted).toEqual([]);
  });

  it("writes only remote service columns", async () => {
    const { client, inserted } = clientWith([]);
    const store = new AuthenticatedServiceTableStore(client);
    const next = row({ id: "22222222-2222-4222-8222-222222222222", app_id: "svc-new01-xyz123" });
    await store.insertService(next);
    expect(inserted).toHaveLength(1);
    expect(remoteServicePayload(inserted[0] as unknown as DbService)).not.toHaveProperty("price");
    expect(inserted[0]).not.toHaveProperty("location_id");
  });

  it("does not use a service-role client", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/persistence/authenticated-service-store.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
  });
});
