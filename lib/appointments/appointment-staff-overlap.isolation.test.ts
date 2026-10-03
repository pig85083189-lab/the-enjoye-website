import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_STAFF_OVERLAP_CONSTRAINT,
  APPOINTMENT_STAFF_OVERLAP_MIGRATION_FILE,
  staffActiveRangesConflict,
} from "./appointment-staff-overlap";

const START = "2026-10-09T02:00:00.000Z";
const END = "2026-10-09T03:40:00.000Z";
const ADJACENT = "2026-10-09T03:40:00.000Z";
const ADJACENT_END = "2026-10-09T04:40:00.000Z";
const OVERLAP = "2026-10-09T03:39:00.000Z";

function row(
  overrides: Partial<Parameters<typeof staffActiveRangesConflict>[0]> = {},
): Parameters<typeof staffActiveRangesConflict>[0] {
  return {
    organizationId: "org-a",
    staffId: "staff-001",
    startAt: START,
    endAt: END,
    status: "BOOKED",
    ...overrides,
  };
}

describe("Phase 1C-6B.1 staff overlap exclusion spec", () => {
  it("allows adjacent 10:00–11:40 + 11:40–12:40 and rejects 11:39 overlap", () => {
    expect(
      staffActiveRangesConflict(row(), row({ startAt: ADJACENT, endAt: ADJACENT_END })),
    ).toBe(false);
    expect(
      staffActiveRangesConflict(row(), row({ startAt: OVERLAP, endAt: ADJACENT_END })),
    ).toBe(true);
  });

  it("ignores CANCELLED and NO_SHOW but rejects BOOKED overlap", () => {
    expect(
      staffActiveRangesConflict(row({ status: "CANCELLED" }), row()),
    ).toBe(false);
    expect(
      staffActiveRangesConflict(row({ status: "NO_SHOW" }), row()),
    ).toBe(false);
    expect(staffActiveRangesConflict(row(), row({ startAt: OVERLAP, endAt: ADJACENT_END }))).toBe(
      true,
    );
  });

  it("drafts btree_gist exclusion SQL without applying a remote write", () => {
    const sql = readFileSync(
      path.join(process.cwd(), APPOINTMENT_STAFF_OVERLAP_MIGRATION_FILE),
      "utf8",
    );
    expect(sql).toContain("create extension if not exists btree_gist");
    expect(sql).toContain(APPOINTMENT_STAFF_OVERLAP_CONSTRAINT);
    expect(sql).toMatch(/tstzrange\(starts_at, ends_at, '\[\)'\)/);
    expect(sql).toMatch(/organization_id with =/);
    expect(sql).toMatch(/staff_id with =/);
    expect(sql).toMatch(/status not in \('CANCELLED', 'NO_SHOW'\)/);
    expect(sql).not.toMatch(/location_id with =/);
    expect(sql).toMatch(/DO NOT apply to remote/);
    expect(sql).not.toMatch(/\binsert into public\.appointments\b/i);
    expect(sql).not.toMatch(/\bupdate public\.appointments\b/i);
    expect(sql).not.toMatch(/\bdelete from public\.appointments\b/i);
  });
});
