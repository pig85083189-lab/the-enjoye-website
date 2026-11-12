/**
 * Fail-closed staff leave guard for remote appointment create/reschedule.
 * Uses the Preview/TEST approved-leave projection when available.
 */

export type ApprovedStaffLeaveRow = {
  staff_id: string | null;
  starts_at: string;
  ends_at: string;
};

export const APPOINTMENT_STAFF_LEAVE_CONFLICT_MESSAGE =
  "美容師該時段休假中，無法預約";

export function staffLeaveOverlapsRange(
  leave: Pick<ApprovedStaffLeaveRow, "starts_at" | "ends_at">,
  startAt: string,
  endAt: string,
): boolean {
  const leaveStart = Date.parse(leave.starts_at);
  const leaveEnd = Date.parse(leave.ends_at);
  const rangeStart = Date.parse(startAt);
  const rangeEnd = Date.parse(endAt);
  if (
    ![leaveStart, leaveEnd, rangeStart, rangeEnd].every(Number.isFinite) ||
    leaveEnd <= leaveStart ||
    rangeEnd <= rangeStart
  ) {
    return false;
  }
  return leaveStart < rangeEnd && leaveEnd > rangeStart;
}

export function assertNoApprovedStaffLeaveConflict(input: {
  staffId: string;
  startAt: string;
  endAt: string;
  leaveRows: ApprovedStaffLeaveRow[];
}): void {
  const hit = input.leaveRows.some(
    (row) =>
      row.staff_id === input.staffId &&
      staffLeaveOverlapsRange(row, input.startAt, input.endAt),
  );
  if (hit) {
    throw new Error(APPOINTMENT_STAFF_LEAVE_CONFLICT_MESSAGE);
  }
}

export async function loadApprovedStaffLeaveRows(
  client: {
    from: (table: string) => {
      select: (columns: string) => PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: { message: string; code?: string } | null;
      }>;
    };
  },
): Promise<ApprovedStaffLeaveRow[]> {
  const result = await client
    .from("booking_approved_staff_leave_v1")
    .select("staff_id, starts_at, ends_at");
  if (result.error) {
    // View may be absent on older environments; keep create path available.
    if (/does not exist|PGRST205|42P01/i.test(result.error.message)) {
      return [];
    }
    throw new Error(result.error.message);
  }
  return (result.data ?? []).flatMap((row) => {
    const staff_id = typeof row.staff_id === "string" ? row.staff_id : null;
    const starts_at = typeof row.starts_at === "string" ? row.starts_at : "";
    const ends_at = typeof row.ends_at === "string" ? row.ends_at : "";
    if (!starts_at || !ends_at) return [];
    return [{ staff_id, starts_at, ends_at }];
  });
}
