/**
 * B mode: collect every employee's requested days before manager finalization.
 * This planner never approves or persists requests; its output is a review aid.
 */
export type AdvanceLeaveRequest = {
  id: string;
  staffId: string;
  date: string; // YYYY-MM-DD in the location's local calendar
};
export type AdvanceLeaveDay = {
  date: string;
  requests: AdvanceLeaveRequest[];
  scheduledStaffIds: string[];
  remainingStaffIds: string[];
  minimumMet: boolean;
  needsManagerDecision: boolean;
};
export function planAdvanceLeaveReview(input: {
  requests: AdvanceLeaveRequest[];
  scheduledByDate: Record<string, string[]>;
  minimumStaff: number;
}): AdvanceLeaveDay[] {
  if (!Number.isSafeInteger(input.minimumStaff) || input.minimumStaff < 1) {
    throw new Error("INVALID_MINIMUM_STAFF");
  }
  const grouped = new Map<string, AdvanceLeaveRequest[]>();
  const seen = new Set<string>();
  for (const request of input.requests) {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(request.date) ||
      !request.id || !request.staffId || seen.has(request.id)) {
      throw new Error("INVALID_LEAVE_REQUEST");
    }
    seen.add(request.id);
    grouped.set(request.date, [...(grouped.get(request.date) ?? []), request]);
  }
  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([date, requests]) => {
    if (!Object.hasOwn(input.scheduledByDate, date)) throw new Error("INCOMPLETE_SCHEDULE");
    const scheduledStaffIds = input.scheduledByDate[date];
    if (new Set(scheduledStaffIds).size !== scheduledStaffIds.length ||
      requests.some(r => !scheduledStaffIds.includes(r.staffId))) {
      throw new Error("INVALID_SCHEDULE");
    }
    const requesting = new Set(requests.map(r => r.staffId));
    const remainingStaffIds = scheduledStaffIds.filter(id => !requesting.has(id));
    const minimumMet = remainingStaffIds.length >= input.minimumStaff;
    return {
      date, requests, scheduledStaffIds, remainingStaffIds, minimumMet,
      needsManagerDecision: !minimumMet,
    };
  });
}
