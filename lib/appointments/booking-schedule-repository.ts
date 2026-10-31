import { checkBookingSlot, type BookingInterval, type WorkingWindow, type SlotCheckResult } from "./server-slot-evaluator";

/**
 * Server-only contract for a tenant-scoped, authoritative schedule read.
 * Never populate this from browser storage, public client parameters, or partial queries.
 * A repository must report complete=false on ANY failed or truncated feed.
 */
export type VerifiedScheduleSnapshot = {
  organizationId: string;
  locationId: string;
  staffId: string;
  serviceId: string;
  date: string; // Asia/Taipei YYYY-MM-DD
  durationMinutes: number;
  staffVerified: boolean;
  locationVerified: boolean;
  serviceVerified: boolean;
  complete: boolean;
  workingHours: WorkingWindow[] | null;
  breaks: BookingInterval[] | null;
  approvedTimeOff: BookingInterval[] | null;
  occupiedAppointments: BookingInterval[] | null;
};

export interface BookingScheduleRepository {
  /**
   * All identifiers must be resolved/authorized server-side.
   * Implementations must scope EVERY query to the same organization and location.
   * On any missing source/table, return a snapshot with complete=false or throw.
   */
  readVerifiedSnapshot(input: {
    organizationId: string;
    locationId: string;
    staffId: string;
    serviceId: string;
    date: string;
  }): Promise<VerifiedScheduleSnapshot>;
}

/** Fail closed on missing or mismatched authoritative data. Does not write bookings. */
export async function evaluateSlotFromRepository(
  repository: BookingScheduleRepository,
  request: {
    organizationId: string;
    locationId: string;
    staffId: string;
    serviceId: string;
    date: string;
    startTime: string;
  },
): Promise<SlotCheckResult> {
  try {
    const snapshot = await repository.readVerifiedSnapshot(request);
    if (
      snapshot.organizationId !== request.organizationId ||
      snapshot.locationId !== request.locationId ||
      snapshot.staffId !== request.staffId ||
      snapshot.serviceId !== request.serviceId ||
      snapshot.date !== request.date
    ) return { available: false, reason: "NOT_VERIFIED" };
    return checkBookingSlot({
      date: request.date,
      startTime: request.startTime,
      durationMinutes: snapshot.durationMinutes,
      staffVerified: snapshot.staffVerified,
      locationVerified: snapshot.locationVerified,
      serviceVerified: snapshot.serviceVerified,
      scheduleSnapshotComplete: snapshot.complete,
      workingHours: snapshot.workingHours,
      breaks: snapshot.breaks,
      approvedTimeOff: snapshot.approvedTimeOff,
      occupiedAppointments: snapshot.occupiedAppointments,
    });
  } catch {
    return { available: false, reason: "MISSING_SCHEDULE" };
  }
}
