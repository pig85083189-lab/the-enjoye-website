/**
 * Spec for DB-authoritative staff overlap.
 * Mirrors appointments_staff_active_no_overlap, applied remotely in 1C-6B.2.
 *
 * Same organization + same operational staff + overlapping tstzrange [)
 * on an active status is rejected. Adjacent end == start is allowed.
 * CANCELLED / NO_SHOW do not participate.
 */

import { rangesOverlap } from "@/lib/appointments/domain";
import { APPOINTMENT_STAFF_OVERLAP_MIGRATION_FILE as MIGRATION_FILE } from "@/lib/persistence/schema-contract";

export const APPOINTMENT_STAFF_OVERLAP_CONSTRAINT =
  "appointments_staff_active_no_overlap";

export const APPOINTMENT_STAFF_OVERLAP_MIGRATION_FILE = MIGRATION_FILE;

const INACTIVE_STATUSES = new Set(["CANCELLED", "NO_SHOW"]);

export type OverlapAppointment = {
  organizationId: string;
  staffId: string;
  startAt: string;
  endAt: string;
  status: string;
};

export function isActiveStaffOverlapStatus(status: string): boolean {
  return !INACTIVE_STATUSES.has(status);
}

/** Half-open [start, end) — existing.end == new.start does not conflict. */
export function staffActiveRangesConflict(
  left: OverlapAppointment,
  right: OverlapAppointment,
): boolean {
  if (left.organizationId !== right.organizationId) return false;
  if (!left.staffId || left.staffId !== right.staffId) return false;
  if (!isActiveStaffOverlapStatus(left.status) || !isActiveStaffOverlapStatus(right.status)) {
    return false;
  }
  return rangesOverlap(left.startAt, left.endAt, right.startAt, right.endAt);
}
