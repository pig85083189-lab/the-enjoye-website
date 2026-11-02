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
  it("excludes past slots using an explicit Taiwan-time cutoff", () => {
    expect(calculateAvailableStarts({
      ...monday,
      notBefore: "2026-11-02T10:15:00+08:00",
    })).toEqual(["10:30", "11:00"]);
  });
  it("rejects invalid booking cutoffs", () => {
    expect(() => calculateAvailableStarts({ ...monday, notBefore: "invalid" })).toThrow("INVALID_BOOKING_CUTOFF");
  });
  it("excludes staff breaks without excluding adjacent valid slots", () => {
    expect(calculateAvailableStarts({
      ...monday,
      breaks: [{ startTime: "10:00", endTime: "10:30" }],
    })).toEqual(["10:30", "11:00"]);
  });
  it("keeps the next valid start when a break ends exactly on its boundary", () => {
    expect(calculateAvailableStarts({
      ...monday,
      breaks: [{ startTime: "09:00", endTime: "10:00" }],
    })).toEqual(["10:00", "10:30", "11:00"]);
  });
  it("excludes slots that overlap either of multiple breaks", () => {
    expect(calculateAvailableStarts({
      ...monday,
      breaks: [
        { startTime: "09:30", endTime: "10:00" },
        { startTime: "11:00", endTime: "11:30" },
      ],
    })).toEqual([]);
  });
  it("fails closed for invalid break windows", () => {
    expect(() => calculateAvailableStarts({
      ...monday, breaks: [{ startTime: "11:00", endTime: "10:00" }],
    })).toThrow("INVALID_BREAK");
  });
  it("blocks a slot overlapping a booking that began on the previous day", () => {
    expect(calculateAvailableStarts({
      ...monday,
      busy: [{ startAt: "2026-11-01T23:00:00+08:00", endAt: "2026-11-02T09:30:00+08:00" }],
    })).toEqual(["09:30", "10:00", "10:30", "11:00"]);
  });
  it("does not block adjacent appointments whose end equals the next start", () => {
    expect(calculateAvailableStarts({
      ...monday,
      busy: [{ startAt: "2026-11-02T08:00:00+08:00", endAt: "2026-11-02T09:00:00+08:00" }],
    })).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
  });
  it("rejects malformed dates, clocks, and booking intervals", () => {
    expect(() => calculateAvailableStarts({ ...monday, date: "2026-02-30" })).toThrow("INVALID_DATE");
    expect(() => calculateAvailableStarts({ ...monday, workingDays: [{ ...monday.workingDays[0], startTime: "25:00" }] })).toThrow("INVALID_CLOCK");
    expect(() => calculateAvailableStarts({ ...monday, busy: [{ startAt: "bad", endAt: "2026-11-02T10:00:00+08:00" }] })).toThrow("INVALID_BUSY_INTERVAL");
  });
});
