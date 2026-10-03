/**
 * Resolve human-facing staff names from the canonical roster.
 * Does not rewrite Appointment.staffId or persisted staff_name_snapshot.
 */

export function resolveRosterStaffDisplayName(
  staffId: string,
  snapshotName: string | undefined,
  roster: ReadonlyArray<{ userId: string; displayName: string }>,
): string {
  if (!staffId) return snapshotName ?? "";
  const hit = roster.find((row) => row.userId === staffId);
  return hit?.displayName || snapshotName || "";
}

export function applyRosterStaffDisplayNames<
  T extends { staffId: string; staffName: string },
>(
  appointments: readonly T[],
  roster: ReadonlyArray<{ userId: string; displayName: string }>,
): T[] {
  return appointments.map((item) => {
    const staffName = resolveRosterStaffDisplayName(
      item.staffId,
      item.staffName,
      roster,
    );
    return staffName === item.staffName ? item : { ...item, staffName };
  });
}
