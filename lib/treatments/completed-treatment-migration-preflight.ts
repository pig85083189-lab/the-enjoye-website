import type { TreatmentDraft } from "@/types/treatment";

/**
 * Read-only migration preflight. This is not authorization to write.
 * Canonical customer/appointment/location/service/staff identities must be
 * verified by the authenticated write path before any Supabase mutation.
 */
export type TreatmentMigrationDecision =
  | { status: "already-remote"; localId: string; reason: string }
  | { status: "blocked"; localId: string; reason: string }
  | { status: "needs-identity-verification"; localId: string; appointmentId: string };

/** Compare persisted clinical fields, not just matching IDs. Array order is meaningful. */
export function completedTreatmentClinicalFieldsMatch(
  local: TreatmentDraft,
  remote: TreatmentDraft,
): boolean {
  const fields = [
    "assessment", "bodyMarkers", "bodyMapNote", "operations", "products",
    "professionalNote", "clientFeeling", "discomfortNote", "followUp",
    "skippedSteps", "suggestedTrackingAreas", "selectedQuickPhrases",
    "noteManuallyEdited", "mode",
  ] as const;
  return remote.status === "completed" && fields.every(
    (field) => JSON.stringify(local[field]) === JSON.stringify(remote[field]),
  ) && JSON.stringify(local.photos.map(({ id, type, createdAt, hadPreview }) => ({
    id, type, createdAt, hadPreview,
  }))) === JSON.stringify(remote.photos.map(({ id, type, createdAt, hadPreview }) => ({
    id, type, createdAt, hadPreview,
  })));
}

export function preflightCompletedTreatmentMigration(
  organizationId: string,
  localRecords: readonly TreatmentDraft[],
  remoteRecords: readonly TreatmentDraft[],
): TreatmentMigrationDecision[] {
  // Keep full remote rows: a matching appointment is not proof that its
  // customer, organization or clinical contents match the browser record.
  const remoteById = new Map(remoteRecords.map((row) => [row.id, row]));
  const remoteByAppointment = new Map<string, TreatmentDraft[]>();
  for (const row of remoteRecords) {
    if (!row.appointmentId) continue;
    const matches = remoteByAppointment.get(row.appointmentId) ?? [];
    matches.push(row);
    remoteByAppointment.set(row.appointmentId, matches);
  }
  const localAppointmentCounts = new Map<string, number>();
  const localIdCounts = new Map<string, number>();
  for (const row of localRecords) {
    if (row.appointmentId) localAppointmentCounts.set(
      row.appointmentId, (localAppointmentCounts.get(row.appointmentId) ?? 0) + 1,
    );
    if (row.id) localIdCounts.set(row.id, (localIdCounts.get(row.id) ?? 0) + 1);
  }

  return localRecords.map((row) => {
    if (!organizationId || row.organizationId !== organizationId || row.status !== "completed") {
      return { status: "blocked", localId: row.id, reason: "Organization or completion status mismatch" };
    }
    if (!row.id || !row.appointmentId || !row.customerId ||
        !row.serviceId || !row.staffId || !row.locationId) {
      return { status: "blocked", localId: row.id, reason: "Required operational identity missing" };
    }
    if ((localIdCounts.get(row.id) ?? 0) > 1 ||
        (localAppointmentCounts.get(row.appointmentId) ?? 0) > 1) {
      return { status: "blocked", localId: row.id, reason: "Duplicate local treatment ID or appointment" };
    }
    const matches = [
      ...(remoteById.has(row.id) ? [remoteById.get(row.id)!] : []),
      ...(remoteByAppointment.get(row.appointmentId) ?? []),
    ];
    if (matches.length) {
      if (matches.some((remote) =>
        remote.organizationId !== organizationId ||
        remote.customerId !== row.customerId ||
        remote.appointmentId !== row.appointmentId ||
        remote.id !== row.id
      )) {
        return { status: "blocked", localId: row.id, reason: "Remote identity conflict; manual reconciliation required" };
      }
      if (matches.some((remote) => !completedTreatmentClinicalFieldsMatch(row, remote))) {
        return { status: "blocked", localId: row.id, reason: "Remote clinical contents differ; do not overwrite either record" };
      }
      return { status: "already-remote", localId: row.id, reason: "Matching remote identity and clinical contents verified" };
    }
    return {
      status: "needs-identity-verification",
      localId: row.id,
      appointmentId: row.appointmentId,
    };
  });
}
