import { describe, expect, it } from "vitest";
import { planAdvanceLeaveReview } from "./advance-leave-review";

describe("collective advance leave (B mode)", () => {
  const requests = [
    { id: "a", staffId: "staff-a", date: "2026-12-01" },
    { id: "b", staffId: "staff-b", date: "2026-12-01" },
  ];
  it("does not automatically approve simultaneous requests that leave nobody working", () => {
    const [day] = planAdvanceLeaveReview({
      requests, scheduledByDate: { "2026-12-01": ["staff-a", "staff-b"] }, minimumStaff: 1,
    });
    expect(day.minimumMet).toBe(false);
    expect(day.needsManagerDecision).toBe(true);
    expect(day.requests).toHaveLength(2);
  });
  it("shows days that meet staffing without approving them before the cutoff", () => {
    const [day] = planAdvanceLeaveReview({
      requests: [requests[0]],
      scheduledByDate: { "2026-12-01": ["staff-a", "staff-b"] },
      minimumStaff: 1,
    });
    expect(day.minimumMet).toBe(true);
    expect(day.needsManagerDecision).toBe(false);
  });
  it("fails closed when the server schedule is missing", () => {
    expect(() => planAdvanceLeaveReview({
      requests, scheduledByDate: {}, minimumStaff: 1,
    })).toThrow("INCOMPLETE_SCHEDULE");
  });
});
