import { describe, expect, it } from "vitest";
import { calculateAvailableStarts } from "./availability";

const monday = {
  date: "2026-11-02",
  staffId: "staff-001",
  serviceMinutes: 60,
  workingDays: [{ staffId: "staff-001", dayOfWeek: 1, startTime: "09:00:00", endTime: "12:00:00", isWorking: true }],
  busy: [],
};

describe("member booking availability", () => {
  it("returns starts that fit entirely within a shift", () => {
    expect(calculateAvailableStarts(monday)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
  });
  it("excludes overlapping bookings and preserves touching boundaries", () => {
    expect(calculateAvailableStarts({
      ...monday,
      busy: [{ startAt: "2026-11-02T09:30:00+08:00", endAt: "2026-11-02T10:30:00+08:00" }],
    })).toEqual(["10:30", "11:00"]);
  });
  it("does not offer off days or another employee's shifts", () => {
    expect(calculateAvailableStarts({ ...monday, workingDays: [{ ...monday.workingDays[0], isWorking: false }] })).toEqual([]);
    expect(calculateAvailableStarts({ ...monday, staffId: "staff-002" })).toEqual([]);
  });
  it("rejects malformed dates, clocks, and booking intervals", () => {
    expect(() => calculateAvailableStarts({ ...monday, date: "2026-02-30" })).toThrow("INVALID_DATE");
    expect(() => calculateAvailableStarts({ ...monday, workingDays: [{ ...monday.workingDays[0], startTime: "25:00" }] })).toThrow("INVALID_CLOCK");
    expect(() => calculateAvailableStarts({ ...monday, busy: [{ startAt: "bad", endAt: "2026-11-02T10:00:00+08:00" }] })).toThrow("INVALID_BUSY_INTERVAL");
  });
});
