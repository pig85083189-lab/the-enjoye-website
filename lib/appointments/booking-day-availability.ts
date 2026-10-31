import { checkBookingSlot, type SlotCheckResult } from "./server-slot-evaluator";
import type { BookingScheduleRepository } from "./booking-schedule-repository";

export type DayAvailability =
  | { status: "ready"; date: string; slots: string[] }
  | { status: "unavailable"; date: string; reason: string; slots: [] };

/**
 * Server-only STEP 03 helper. Caller authenticates member and resolves tenant,
 * location, staff and service IDs on the server before invoking this function.
 * One authoritative snapshot is used for all slots in the day.
 * No schedule fallback and no booking writes.
 */
export async function listBookingDayAvailability(
  repository: BookingScheduleRepository,
  request: {
    organizationId: string;
    locationId: string;
    staffId: string;
    serviceId: string;
    date: string;
  },
  options: { slotStepMinutes?: number } = {},
): Promise<DayAvailability> {
  const { date } = request;
  const unavailable = (reason: string): DayAvailability => ({ status: "unavailable", date, reason, slots: [] });
  const step = options.slotStepMinutes ?? 30;
  if (!Number.isInteger(step) || step < 5 || step > 120 || 1440 % step !== 0) return unavailable("INVALID_STEP");
  try {
    const snapshot = await repository.readVerifiedSnapshot(request);
    if (
      snapshot.organizationId !== request.organizationId ||
      snapshot.locationId !== request.locationId ||
      snapshot.staffId !== request.staffId ||
      snapshot.serviceId !== request.serviceId ||
      snapshot.date !== date ||
      !snapshot.staffVerified || !snapshot.locationVerified || !snapshot.serviceVerified
    ) return unavailable("NOT_VERIFIED");
    if (!snapshot.complete || !snapshot.workingHours || !snapshot.breaks || !snapshot.approvedTimeOff || !snapshot.occupiedAppointments) {
      return unavailable("MISSING_SCHEDULE");
    }
    const slots: string[] = [];
    for (let minute = 0; minute < 1440; minute += step) {
      const startTime = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      const result: SlotCheckResult = checkBookingSlot({
        date, startTime, durationMinutes: snapshot.durationMinutes,
        staffVerified: snapshot.staffVerified, locationVerified: snapshot.locationVerified,
        serviceVerified: snapshot.serviceVerified, scheduleSnapshotComplete: snapshot.complete,
        workingHours: snapshot.workingHours, breaks: snapshot.breaks,
        approvedTimeOff: snapshot.approvedTimeOff, occupiedAppointments: snapshot.occupiedAppointments,
      });
      if (result.available) slots.push(startTime);
      else if (result.reason === "INVALID_INPUT" || result.reason === "MISSING_SCHEDULE" || result.reason === "NOT_VERIFIED") {
        return unavailable(result.reason);
      }
    }
    return { status: "ready", date, slots };
  } catch {
    return unavailable("MISSING_SCHEDULE");
  }
}
