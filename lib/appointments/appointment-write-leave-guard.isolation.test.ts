import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_STAFF_LEAVE_CONFLICT_MESSAGE,
  assertNoApprovedStaffLeaveConflict,
  staffLeaveOverlapsRange,
} from "./appointment-write-leave-guard";

describe("appointment write leave guard", () => {
  it("detects overlapping approved leave", () => {
    expect(
      staffLeaveOverlapsRange(
        {
          starts_at: "2026-11-13T02:00:00.000Z",
          ends_at: "2026-11-13T06:00:00.000Z",
        },
        "2026-11-13T04:00:00.000Z",
        "2026-11-13T05:00:00.000Z",
      ),
    ).toBe(true);
    expect(
      staffLeaveOverlapsRange(
        {
          starts_at: "2026-11-13T02:00:00.000Z",
          ends_at: "2026-11-13T03:00:00.000Z",
        },
        "2026-11-13T04:00:00.000Z",
        "2026-11-13T05:00:00.000Z",
      ),
    ).toBe(false);
  });

  it("blocks create when the selected staff has approved leave", () => {
    expect(() =>
      assertNoApprovedStaffLeaveConflict({
        staffId: "staff-1",
        startAt: "2026-11-13T04:00:00.000Z",
        endAt: "2026-11-13T05:00:00.000Z",
        leaveRows: [
          {
            staff_id: "staff-1",
            starts_at: "2026-11-13T00:00:00.000Z",
            ends_at: "2026-11-13T08:00:00.000Z",
          },
        ],
      }),
    ).toThrow(APPOINTMENT_STAFF_LEAVE_CONFLICT_MESSAGE);
  });
});
