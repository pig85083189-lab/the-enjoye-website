import { describe, expect, it } from "vitest";
import { blocksMemberBookingForLeave } from "./leave-booking-policy";

describe("leave booking policy A", () => {
  it("blocks pending staff leave requests immediately", () => {
    expect(blocksMemberBookingForLeave("REQUESTED")).toBe(true);
  });

  it("blocks approved leave, including manager-direct leave", () => {
    expect(blocksMemberBookingForLeave("APPROVED")).toBe(true);
  });

  it("does not block rejected leave", () => {
    expect(blocksMemberBookingForLeave("REJECTED")).toBe(false);
  });
});
