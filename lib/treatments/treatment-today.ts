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
