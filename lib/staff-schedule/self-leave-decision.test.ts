import { describe, expect, it } from "vitest";
import {
  DEFAULT_MINIMUM_STAFF_RULE as rule,
  decideSelfLeave,
  type StaffCoverage,
} from "./self-leave-decision";

const slot = (start: number, end: number) => ({
  startAt: `2026-11-16T${String(start).padStart(2, "0")}:00:00+08:00`,
  endAt: `2026-11-16T${String(end).padStart(2, "0")}:00:00+08:00`,
});
const staff: StaffCoverage[] = [
  { staffId: "a", working: [slot(9, 18)], unavailable: [] },
  { staffId: "b", working: [slot(9, 18)], unavailable: [] },
];
const base = {
  requestingStaffId: "a", leave: slot(9, 18), appointments: [],
  staff, rule, completeSnapshot: true,
};

describe("staff self-leave: minimum one on duty all day", () => {
  it("auto approves when another staff member covers the whole leave", () => {
    expect(decideSelfLeave(base)).toEqual({ outcome: "AUTO_APPROVE", reasons: [] });
  });
  it("routes an appointment conflict to the manager", () => {
    expect(decideSelfLeave({ ...base, appointments: [slot(10, 11)] })).toEqual({
      outcome: "MANAGER_REVIEW", reasons: ["APPOINTMENT_CONFLICT"],
    });
  });
  it("routes minimum coverage shortage to manager", () => {
    expect(decideSelfLeave({ ...base, staff: [staff[0]] })).toEqual({
      outcome: "MANAGER_REVIEW", reasons: ["MINIMUM_STAFF"],
    });
  });
  it("detects partial-day breaks in the remaining staff coverage", () => {
    expect(decideSelfLeave({
      ...base,
      staff: [staff[0], { ...staff[1], unavailable: [slot(12, 13)] }],
    })).toEqual({ outcome: "MANAGER_REVIEW", reasons: ["MINIMUM_STAFF"] });
  });
  it("does not count staff who start after the leave starts", () => {
    expect(decideSelfLeave({
      ...base,
      staff: [staff[0], { ...staff[1], working: [slot(12, 18)] }],
    })).toEqual({ outcome: "MANAGER_REVIEW", reasons: ["MINIMUM_STAFF"] });
  });
  it("fails closed for incomplete server snapshot", () => {
    expect(decideSelfLeave({ ...base, completeSnapshot: false })).toEqual({
      outcome: "BLOCKED", reasons: ["INCOMPLETE_SNAPSHOT"],
    });
  });
  it("fails closed for invalid minimum staffing", () => {
    expect(decideSelfLeave({ ...base, rule: { ...rule, minimumStaff: -1 } })).toEqual({
      outcome: "BLOCKED", reasons: ["INVALID_INPUT"],
    });
  });
  it("does not count an already unavailable requesting employee", () => {
    expect(decideSelfLeave({
      ...base, staff: [
        { ...staff[0], unavailable: [slot(9, 18)] },
        { ...staff[1], unavailable: [slot(12, 13)] },
      ],
    })).toEqual({ outcome: "MANAGER_REVIEW", reasons: ["MINIMUM_STAFF"] });
  });
});
