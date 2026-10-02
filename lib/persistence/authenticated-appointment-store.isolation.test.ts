import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_INSERT_ONLY_MESSAGE,
  AuthenticatedAppointmentTableStore,
  type AppointmentQueryBuilder,
  type AppointmentQueryResult,
  type AuthenticatedAppointmentSupabaseClient,
} from "./authenticated-appointment-store";
import { remoteAppointmentPayload } from "./appointment-mapping";
import type { DbAppointment } from "./operational-rows";

type Row = Record<string, unknown>;

class FakeQuery implements AppointmentQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly write: ((row: Row) => void) | null = null,
    private readonly filters: Array<{ column: string; value: string }> = [],
    private readonly pendingInsert: Row | null = null,
  ) {}

  eq(column: string, value: string): AppointmentQueryBuilder {
    return new FakeQuery(this.rows, this.write, [...this.filters, { column, value }], this.pendingInsert);
  }

  select(): AppointmentQueryBuilder {
    return this;
  }

  then<TResult1 = AppointmentQueryResult, TResult2 = never>(
    onfulfilled?: ((value: AppointmentQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
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

function row(overrides: Partial<DbAppointment> = {}): DbAppointment {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    organization_id: "62bd49b6-a4c3-4da1-b53e-4746923685f1",
    location_id: "c46b700c-bb42-45ce-be53-4484e217c3f8",
    customer_id: "f4be267b-8159-4b7b-920c-44ac996b3d8e",
    service_id: "bd4c1822-5375-48b6-a4f4-dd231da10ef2",
    staff_id: "staff-001",
    app_id: "apt-test01-abcdef",
    starts_at: "2026-10-09T02:00:00.000Z",
    ends_at: "2026-10-09T03:40:00.000Z",
    duration_minutes: 100,
    status: "BOOKED",
    customer_note: null,
    internal_note: null,
    customer_name_snapshot: "Remote QA Customer",
    service_name_snapshot: "Remote QA Bust Care",
    staff_name_snapshot: "怡蓁",
    status_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    created_by: "staff-001",
    updated_by: null,
    created_at: "2026-10-02T00:00:00.000Z",
    updated_at: "2026-10-02T00:00:00.000Z",
    ...overrides,
  };
}

function clientWith(rows: DbAppointment[]): {
  client: AuthenticatedAppointmentSupabaseClient;
  inserted: Row[];
} {
  const inserted: Row[] = [];
  const store: Row[] = rows.map((item) => ({ ...item }));
  const client: AuthenticatedAppointmentSupabaseClient = {
    from(table: string) {
      if (table !== "appointments") {
        return {
          select: () => new FakeQuery([]),
          insert: () => new FakeQuery([]),
        };
      }
      return {
        select: () => new FakeQuery(store),
        insert: (payload: Record<string, unknown>) =>
          new FakeQuery(
            store,
            (next) => {
              inserted.push(next);
              store.push(next);
            },
            [],
            payload,
          ),
      };
    },
  };
  return { client, inserted };
}

describe("AuthenticatedAppointmentTableStore", () => {
  it("is insert-only and refuses a second row with the same app_id", async () => {
    const existing = row();
    const { client, inserted } = clientWith([existing]);
    const store = new AuthenticatedAppointmentTableStore(client);
    await expect(store.insertAppointment(existing)).rejects.toThrow(APPOINTMENT_INSERT_ONLY_MESSAGE);
    expect(inserted).toEqual([]);
  });

  it("writes only remote appointment columns and no domain notes array", async () => {
    const { client, inserted } = clientWith([]);
    const store = new AuthenticatedAppointmentTableStore(client);
    const next = row({ id: "44444444-4444-4444-8444-444444444444", app_id: "apt-new01-xyz123" });
    await store.insertAppointment(next);
    expect(inserted).toHaveLength(1);
    expect(remoteAppointmentPayload(inserted[0] as unknown as DbAppointment)).not.toHaveProperty(
      "notes",
    );
    expect(inserted[0]).not.toHaveProperty("remainingSessions");
  });

  it("does not use a service-role client", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/persistence/authenticated-appointment-store.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
  });
});
