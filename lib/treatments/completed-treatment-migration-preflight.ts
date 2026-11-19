import type { TreatmentDraft } from "@/types/treatment";

/**
 * Read-only preflight for migrating browser-completed treatments.
 * Never mutates local history, creates identities, or writes to Supabase.
 * Callers must independently verify canonical customer, appointment, service,
 * staff and location identities with an authenticated server-side operation.
 */
export type TreatmentMigrationDecision =
  | { status: "already-remote"; localId: string; reason: string }
  | { status: "blocked"; localId: string; reason: string }
  | { status: "needs-identity-verification"; localId: string; appointmentId: string };

export function preflightCompletedTreatmentMigration(
  organizationId: string,
  localRecords: readonly TreatmentDraft[],
  remoteRecords: readonly TreatmentDraft[],
): TreatmentMigrationDecision[] {
  const remoteIds = new Set(remoteRecords.map((row) => row.id));
  const remoteAppointments = new Set(
    remoteRecords.map((row) => row.appointmentId).filter(Boolean),
  );
  const seenLocalAppointments = new Set<string>();
  return localRecords.map((row) => {
    if (row.organizationId !== organizationId || row.status !== "completed") {
      return { status: "blocked", localId: row.id, reason: "Organization or completion status mismatch" };
    }
    if (!row.id || !row.appointmentId || !row.customerId ||
        !row.serviceId || !row.staffId || !row.locationId) {
      return { status: "blocked", localId: row.id, reason: "Required operational identity missing" };
    }
    if (remoteIds.has(row.id) || remoteAppointments.has(row.appointmentId)) {
      return { status: "already-remote", localId: row.id, reason: "Remote treatment or appointment already exists; compare contents manually" };
    }
    if (seenLocalAppointments.has(row.appointmentId)) {
      return { status: "blocked", localId: row.id, reason: "Duplicate appointment in local completed history" };
    }
    seenLocalAppointments.add(row.appointmentId);
    return {
      status: "needs-identity-verification",
      localId: row.id,
      appointmentId: row.appointmentId,
    };
  });
}
