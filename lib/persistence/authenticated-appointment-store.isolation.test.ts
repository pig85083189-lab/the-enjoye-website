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
    private readonly pendingUpdate: Row | null = null,
    private readonly updateError: { message: string } | null = null,
  ) {}

  eq(column: string, value: string): AppointmentQueryBuilder {
    return new FakeQuery(
      this.rows,
      this.write,
      [...this.filters, { column, value }],
      this.pendingInsert,
      this.pendingUpdate,
      this.updateError,
    );
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
    if (this.pendingUpdate) {
      if (this.updateError) {
        return Promise.resolve({ data: null, error: this.updateError }).then(
          onfulfilled,
          onrejected,
        );
      }
      const matches = this.rows.filter((row) =>
        this.filters.every((filter) => row[filter.column] === filter.value),
      );
      const updated = matches.map((row) => {
        const next = {
          ...row,
          ...this.pendingUpdate,
          updated_at: "2026-10-03T00:00:00.000Z",
        };
        Object.assign(row, next);
        return next;
      });
      return Promise.resolve({ data: updated, error: null }).then(onfulfilled, onrejected);
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

function clientWith(
  rows: DbAppointment[],
  options: { updateError?: { message: string } } = {},
): {
  client: AuthenticatedAppointmentSupabaseClient;
  inserted: Row[];
  updated: Row[];
} {
  const inserted: Row[] = [];
  const updated: Row[] = [];
  const store: Row[] = rows.map((item) => ({ ...item }));
  const client: AuthenticatedAppointmentSupabaseClient = {
    from(table: string) {
      if (table !== "appointments") {
        return {
          select: () => new FakeQuery([]),
          insert: () => new FakeQuery([]),
          update: () => new FakeQuery([]),
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
        update: (payload: Record<string, unknown>) =>
          new FakeQuery(
            store,
            (next) => {
              updated.push(next);
            },
            [],
            null,
            payload,
            options.updateError ?? null,
          ),
      };
    },
  };
  return { client, inserted, updated };
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
    expect(source).not.toMatch(/\.upsert\(/);
  });

  it("updates only when id, organization_id, and expectedUpdatedAt match", async () => {
    const existing = row();
    const { client } = clientWith([existing]);
    const store = new AuthenticatedAppointmentTableStore(client);
    const [updated] = await store.updateAppointment({
      verifiedDbUuid: existing.id,
      organizationDbId: existing.organization_id,
      expectedUpdatedAt: existing.updated_at,
      patch: { status: "CANCELLED", updated_by: "staff-001" },
    });
    expect(updated?.status).toBe("CANCELLED");
    expect(updated?.id).toBe(existing.id);
    expect(updated?.app_id).toBe(existing.app_id);
    expect(updated?.customer_id).toBe(existing.customer_id);
    expect(updated?.updated_at).not.toBe(existing.updated_at);

    const stale = await store.updateAppointment({
      verifiedDbUuid: existing.id,
      organizationDbId: existing.organization_id,
      expectedUpdatedAt: existing.updated_at,
      patch: { status: "NO_SHOW", updated_by: "staff-001" },
    });
    expect(stale).toEqual([]);
  });

  it("refuses a client-supplied customer_id patch and maps 23P01", async () => {
    const existing = row();
    const { client } = clientWith([existing]);
    const store = new AuthenticatedAppointmentTableStore(client);
    await expect(
      store.updateAppointment({
        verifiedDbUuid: existing.id,
        organizationDbId: existing.organization_id,
        expectedUpdatedAt: existing.updated_at,
        patch: { customer_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      }),
    ).rejects.toThrow(/customer_id is immutable/);

    const conflictClient = clientWith([existing], {
      updateError: {
        message:
          '23P01 conflicting key value violates exclusion constraint "appointments_staff_active_no_overlap"',
      },
    }).client;
    const conflictStore = new AuthenticatedAppointmentTableStore(conflictClient);
    await expect(
      conflictStore.updateAppointment({
        verifiedDbUuid: existing.id,
        organizationDbId: existing.organization_id,
        expectedUpdatedAt: existing.updated_at,
        patch: { starts_at: "2026-10-09T04:00:00.000Z" },
      }),
    ).rejects.toThrow(/23P01|appointments_staff_active_no_overlap/);
  });

  it("requires expectedUpdatedAt and does not upsert", async () => {
    const existing = row();
    const { client } = clientWith([existing]);
    const store = new AuthenticatedAppointmentTableStore(client);
    await expect(
      store.updateAppointment({
        verifiedDbUuid: existing.id,
        organizationDbId: existing.organization_id,
        expectedUpdatedAt: "",
        patch: { status: "CANCELLED" },
      }),
    ).rejects.toThrow(/expectedUpdatedAt/);
    const source = readFileSync(
      path.join(process.cwd(), "lib/persistence/authenticated-appointment-store.ts"),
      "utf8",
    );
    expect(source).toMatch(/eq\("id", input.verifiedDbUuid\)/);
    expect(source).toMatch(/eq\("organization_id", input.organizationDbId\)/);
    expect(source).toMatch(/eq\("updated_at", input.expectedUpdatedAt\)/);
    expect(source).not.toMatch(/\.upsert\(|onConflict/);
  });
});
