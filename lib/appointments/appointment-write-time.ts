/**
 * Canonical Taipei → UTC range for a future remote Appointment create.
 * Do not use combineLocalDateTime(...).toISOString() on this path.
 */

import { durationBetween } from "@/lib/appointments/domain";
import { addMinutesToIso, taipeiLocalToUtcIso } from "@/lib/persistence/appointment-time";

export function appointmentWriteRangeFromTaipei(
  dateYmd: string,
  startHm: string,
  durationMinutes: number,
): { startsAt: string; endsAt: string; durationMinutes: number } {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error("Appointment write duration must be a positive integer");
  }
  const startsAt = taipeiLocalToUtcIso(dateYmd, startHm);
  const endsAt = addMinutesToIso(startsAt, durationMinutes);
  if (!(new Date(endsAt).getTime() > new Date(startsAt).getTime())) {
    throw new Error("endAt must be after startAt");
  }
  const derived = durationBetween(startsAt, endsAt);
  if (derived !== durationMinutes) {
    throw new Error("Appointment write duration is inconsistent with Taipei range");
  }
  return { startsAt, endsAt, durationMinutes: derived };
}
