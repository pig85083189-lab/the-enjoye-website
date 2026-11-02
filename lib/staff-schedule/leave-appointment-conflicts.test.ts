import { describe, expect, it } from "vitest";
import {
  assertVerifiedAppointmentScope,
  findLeaveAppointmentConflicts,
} from "./leave-appointment-conflicts";

const leave = {
  startAt: "2026-11-10T05:00:00.000Z",
  endAt: "2026-11-10T08:00:00.000Z",
};
const booking = (start: string, end: string, status = "CONFIRMED") => ({
  id: "booking-1", starts_at: start, ends_at: end, status,
});

describe("leave appointment conflicts", () => {
  it("finds partial and fully enclosed overlaps", () => {
    const rows = [
      booking("2026-11-10T04:00:00.000Z", "2026-11-10T06:00:00.000Z"),
      booking("2026-11-10T06:00:00.000Z", "2026-11-10T07:00:00.000Z"),
      booking("2026-11-10T07:00:00.000Z", "2026-11-10T09:00:00.000Z"),
    ];
    expect(findLeaveAppointmentConflicts(leave, rows)).toHaveLength(3);
  });
  it("treats touching boundaries as non-overlapping", () => {
    expect(findLeaveAppointmentConflicts(leave, [
      booking("2026-11-10T04:00:00.000Z", leave.startAt),
      booking(leave.endAt, "2026-11-10T09:00:00.000Z"),
    ])).toHaveLength(0);
  });
  it("ignores cancelled bookings, not unknown statuses", () => {
    expect(findLeaveAppointmentConflicts(leave, [
      booking(leave.startAt, leave.endAt, "CANCELLED"),
      booking(leave.startAt, leave.endAt, "UNRECOGNIZED"),
    ])).toHaveLength(1);
  });
  it("rejects malformed bookings instead of silently passing", () => {
    expect(() => findLeaveAppointmentConflicts(leave, [
      booking("not-a-date", leave.endAt),
    ])).toThrow("APPOINTMENT_DATA_INCOMPLETE");
  });
  it("rejects malformed leave ranges", () => {
    expect(() => findLeaveAppointmentConflicts({
      startAt: leave.endAt, endAt: leave.startAt,
    }, [])).toThrow("INVALID_LEAVE_RANGE");
  });
  it("fails closed until every tenant mapping and query completeness is verified", () => {
    expect(() => assertVerifiedAppointmentScope({
      organizationMapped: true, locationMapped: true,
      staffMapped: false, completeResultSet: true,
    })).toThrow("APPOINTMENT_SCOPE_UNVERIFIED");
    expect(() => assertVerifiedAppointmentScope({
      organizationMapped: true, locationMapped: true,
      staffMapped: true, completeResultSet: true,
    })).not.toThrow();
  });
});
