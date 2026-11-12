/**
 * Pure decision engine for staff self-service leave.
 * Callers must provide a complete, authoritative location snapshot.
 * This function does not persist or approve leave.
 */
export type LeaveInterval = { startAt: string; endAt: string };
export type StaffCoverage = {
  staffId: string;
  working: LeaveInterval[];
  unavailable: LeaveInterval[];
};
export type SelfLeaveDecision =
  | { outcome: "AUTO_APPROVE"; reasons: [] }
  | { outcome: "MANAGER_REVIEW"; reasons: Array<"APPOINTMENT_CONFLICT" | "MINIMUM_STAFF"> }
  | { outcome: "BLOCKED"; reasons: Array<"INVALID_INPUT" | "INCOMPLETE_SNAPSHOT"> };

export type MinimumStaffRule = {
  minimumStaff: number;
  appliesEveryDay: true;
  appliesAllDay: true;
  autoApproveNoConflict: true;
};

export const DEFAULT_MINIMUM_STAFF_RULE: MinimumStaffRule = {
  minimumStaff: 1,
  appliesEveryDay: true,
  appliesAllDay: true,
  autoApproveNoConflict: true,
};

function millis(value: string): number {
  return new Date(value).getTime();
}
function valid(interval: LeaveInterval): boolean {
  return Number.isFinite(millis(interval.startAt)) &&
    Number.isFinite(millis(interval.endAt)) &&
    millis(interval.startAt) < millis(interval.endAt);
}
function overlaps(a: LeaveInterval, b: LeaveInterval): boolean {
  return millis(a.startAt) < millis(b.endAt) && millis(b.startAt) < millis(a.endAt);
}
function contains(interval: LeaveInterval, t: number): boolean {
  return millis(interval.startAt) <= t && t < millis(interval.endAt);
}

/**
 * `completeSnapshot` must only be true after the server has verified
 * membership, location scope, schedules, breaks, leave and appointments.
 * A browser/localStorage snapshot must not be marked complete.
 */
export function decideSelfLeave(input: {
  requestingStaffId: string;
  leave: LeaveInterval;
  appointments: LeaveInterval[];
  staff: StaffCoverage[];
  rule: MinimumStaffRule;
  completeSnapshot: boolean;
}): SelfLeaveDecision {
  const { requestingStaffId, leave, appointments, staff, rule } = input;
  if (!valid(leave) || !Number.isSafeInteger(rule.minimumStaff) || rule.minimumStaff < 0 ||
    rule.appliesEveryDay !== true || rule.appliesAllDay !== true ||
    rule.autoApproveNoConflict !== true || !requestingStaffId ||
    appointments.some(a => !valid(a)) ||
    staff.some(s => !s.staffId || s.working.some(w => !valid(w)) ||
      s.unavailable.some(u => !valid(u))) ||
    new Set(staff.map(s => s.staffId)).size !== staff.length) {
    return { outcome: "BLOCKED", reasons: ["INVALID_INPUT"] };
  }
  if (!input.completeSnapshot || !staff.some(s => s.staffId === requestingStaffId)) {
    return { outcome: "BLOCKED", reasons: ["INCOMPLETE_SNAPSHOT"] };
  }

  const requester = staff.find(s => s.staffId === requestingStaffId)!;
  const boundaries = [...new Set([millis(leave.startAt), millis(leave.endAt),
    ...requester.working.flatMap(w => [millis(w.startAt), millis(w.endAt)])])]
    .filter(t => t >= millis(leave.startAt) && t <= millis(leave.endAt))
    .sort((a, b) => a - b);
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (!requester.working.some(w => contains(w, boundaries[i]))) {
      return { outcome: "BLOCKED", reasons: ["INVALID_INPUT"] };
    }
  }
  if (requester.unavailable.some(u => overlaps(u, leave))) {
    return { outcome: "BLOCKED", reasons: ["INVALID_INPUT"] };
  }

  const reasons: Array<"APPOINTMENT_CONFLICT" | "MINIMUM_STAFF"> = [];
  if (appointments.some(a => overlaps(a, leave))) reasons.push("APPOINTMENT_CONFLICT");

  // Check every segment, not just the total headcount or the start of leave.
  const edges = new Set([millis(leave.startAt), millis(leave.endAt)]);
  for (const s of staff) {
    for (const interval of [...s.working, ...s.unavailable]) {
      for (const t of [millis(interval.startAt), millis(interval.endAt)]) {
        if (t > millis(leave.startAt) && t < millis(leave.endAt)) edges.add(t);
      }
    }
  }
  const times = [...edges].sort((a, b) => a - b);
  for (let i = 0; i < times.length - 1; i++) {
    const t = times[i];
    const before = staff.filter(s =>
      s.working.some(w => contains(w, t)) && !s.unavailable.some(u => contains(u, t))
    ).length;
    const after = staff.filter(s =>
      s.staffId !== requestingStaffId &&
      s.working.some(w => contains(w, t)) &&
      !s.unavailable.some(u => contains(u, t))
    ).length;
    // Only enforce minimum during an actual staffed/open period.
    if (before > 0 && after < rule.minimumStaff) {
      reasons.push("MINIMUM_STAFF");
      break;
    }
  }
  return reasons.length
    ? { outcome: "MANAGER_REVIEW", reasons }
    : { outcome: "AUTO_APPROVE", reasons: [] };
}
