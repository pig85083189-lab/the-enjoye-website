import { describe, expect, it } from "vitest";
import {
  AuthenticatedTreatmentTableStore,
  TREATMENT_UPDATE_UNSUPPORTED_MESSAGE,
  type AuthenticatedTreatmentSupabaseClient,
  type TreatmentQueryBuilder,
  type TreatmentQueryResult,
} from "./authenticated-treatment-store";
import { remoteTreatmentPayload } from "./treatment-mapping";
import type { DbTreatment } from "./operational-rows";
import { TREATMENT_INSERT_ONLY_MESSAGE } from "@/lib/treatments/treatment-write-errors";

type Row = Record<string, unknown>;

class FakeQuery implements TreatmentQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly write: ((row: Row) => void) | null = null,
    private readonly filters: Array<{ column: string; value: string }> = [],
    private readonly pendingInsert: Row | null = null,
    private readonly pendingUpdate: Row | null = null,
    private readonly updateError: { message: string } | null = null,
  ) {}

  eq(column: string, value: string): TreatmentQueryBuilder {
    return new FakeQuery(
      this.rows,
      this.write,
      [...this.filters, { column, value }],
      this.pendingInsert,
      this.pendingUpdate,
      this.updateError,
    );
  }

  select(): TreatmentQueryBuilder {
    return this;
  }

  then<TResult1 = TreatmentQueryResult, TResult2 = never>(
    onfulfilled?: ((value: TreatmentQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
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
          updated_at: "2026-10-04T00:00:00.000Z",
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

function row(overrides: Partial<DbTreatment> = {}): DbTreatment {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    organization_id: "62bd49b6-a4c3-4da1-b53e-4746923685f1",
    location_id: "c46b700c-bb42-45ce-be53-4484e217c3f8",
    appointment_id: "33333333-3333-4333-8333-333333333333",
    customer_id: "f4be267b-8159-4b7b-920c-44ac996b3d8e",
    service_id: "bd4c1822-5375-48b6-a4f4-dd231da10ef2",
    staff_id: "staff-001",
    app_id: "trt-test01-abcdef",
    mode: "STANDARD",
    template_type: "OTHER",
    assessment: {},
    body_markers: [],
    operations: [],
    products: [],
    professional_note: null,
    client_feeling: null,
    follow_up: {},
    skipped_steps: [],
    started_at: "2026-10-04T00:00:00.000Z",
    completed_at: null,
    status: "DRAFT",
    body_map_note: null,
    discomfort_note: null,
    furthest_step: "summary",
    current_step: "summary",
    created_by: "staff-001",
    updated_by: "staff-001",
    suggested_tracking_areas: [],
    selected_quick_phrases: [],
    note_manually_edited: false,
    quick_record_applied_at: null,
    photo_meta: [],
    created_at: "2026-10-04T00:00:00.000Z",
    updated_at: "2026-10-04T00:00:00.000Z",
    ...overrides,
  };
}

function clientWith(
  rows: DbTreatment[],
  options: { updateError?: { message: string }; noUpdate?: boolean } = {},
): {
  client: AuthenticatedTreatmentSupabaseClient;
  inserted: Row[];
} {
  const inserted: Row[] = [];
  const store: Row[] = rows.map((item) => ({ ...item }));
  const client: AuthenticatedTreatmentSupabaseClient = {
    from(table: string) {
      if (table !== "treatments") {
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
        update: options.noUpdate
          ? undefined
          : (payload: Record<string, unknown>) =>
              new FakeQuery(
                store,
                null,
                [],
                null,
                payload,
                options.updateError ?? null,
              ),
      };
    },
  };
  return { client, inserted };
}

describe("Phase 1C-6G authenticated treatment store", () => {
  it("inserts once and refuses upsert of the same app_id", async () => {
    const { client, inserted } = clientWith([]);
    const store = new AuthenticatedTreatmentTableStore(client);
    const next = row();
    const authoritative = await store.insertTreatment(next);
    expect(inserted).toHaveLength(1);
    expect(authoritative.app_id).toBe(next.app_id);
    expect(authoritative.updated_at).toBe(next.updated_at);
    expect(remoteTreatmentPayload(inserted[0] as unknown as DbTreatment).app_id).toBe(next.app_id);
    await expect(store.insertTreatment(next)).rejects.toThrow(TREATMENT_INSERT_ONLY_MESSAGE);
  });

  it("OCC update matches id + org + expectedUpdatedAt and returns zero on stale", async () => {
    const current = row();
    const { client } = clientWith([current]);
    const store = new AuthenticatedTreatmentTableStore(client);
    const stale = await store.updateTreatment({
      verifiedDbUuid: current.id,
      organizationDbId: current.organization_id,
      expectedUpdatedAt: "1999-01-01T00:00:00.000Z",
      patch: { professional_note: "stale" },
    });
    expect(stale).toEqual([]);
    const updated = await store.updateTreatment({
      verifiedDbUuid: current.id,
      organizationDbId: current.organization_id,
      expectedUpdatedAt: current.updated_at,
      patch: { professional_note: "ok" },
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]?.professional_note).toBe("ok");
  });

  it("refuses update when the authenticated client has no update()", async () => {
    const { client } = clientWith([row()], { noUpdate: true });
    const store = new AuthenticatedTreatmentTableStore(client);
    await expect(
      store.updateTreatment({
        verifiedDbUuid: "44444444-4444-4444-8444-444444444444",
        organizationDbId: "62bd49b6-a4c3-4da1-b53e-4746923685f1",
        expectedUpdatedAt: "2026-10-04T00:00:00.000Z",
        patch: { professional_note: "x" },
      }),
    ).rejects.toThrow(TREATMENT_UPDATE_UNSUPPORTED_MESSAGE);
  });
});
