/**
 * Today buckets derived from the existing Appointment + Treatment pair.
 * Not a second Today status store.
 */

import type { CanonicalAppointmentStatus } from "@/lib/appointments/domain";
import type { TreatmentDraft, TreatmentStatus } from "@/types/treatment";

export function isMutedAppointmentStatus(
  status: CanonicalAppointmentStatus | string | undefined,
): boolean {
  return status === "CANCELLED" || status === "NO_SHOW";
}

export function shouldCreateTreatmentForAppointment(
  status: CanonicalAppointmentStatus | string | undefined,
): boolean {
  return !isMutedAppointmentStatus(status);
}

export function todayBucketFromTreatment(
  appointmentStatus: CanonicalAppointmentStatus,
  treatmentStatus?: TreatmentStatus | null,
): "waiting" | "active" | "done" | "muted" {
  if (isMutedAppointmentStatus(appointmentStatus)) return "muted";
  if (treatmentStatus === "completed") return "done";
  if (treatmentStatus === "draft") return "active";
  return "waiting";
}

/**
 * Presentation overlay for the existing Appointment + Treatment pair.
 * Does not persist or invent a second Appointment status.
 */
export function presentAppointmentStatusFromTreatment(
  appointmentStatus: CanonicalAppointmentStatus,
  treatmentStatus?: TreatmentStatus | null,
): CanonicalAppointmentStatus {
  if (isMutedAppointmentStatus(appointmentStatus)) return appointmentStatus;
  if (treatmentStatus === "completed") return "COMPLETED";
  if (treatmentStatus === "draft") return "IN_SERVICE";
  return appointmentStatus;
}

export function indexTreatmentsByAppointmentId(
  treatments: readonly TreatmentDraft[],
): Map<string, TreatmentDraft> {
  const map = new Map<string, TreatmentDraft>();
  for (const treatment of treatments) {
    if (treatment.appointmentId) {
      map.set(treatment.appointmentId, treatment);
    }
  }
  return map;
}
