/**
 * Explicit browser-completed treatment migration.
 * This service is deliberately NOT invoked automatically by the UI.
 * Call only after the operator confirms the source browser record.
 * It uses the authenticated user session and canonical identity mapper.
 * No service role, no localStorage deletion, no member-link creation.
 */
import type { TreatmentDraft } from "@/types/treatment";
import {
  completedTreatmentClinicalFieldsMatch,
  preflightCompletedTreatmentMigration,
} from "./completed-treatment-migration-preflight";
import {
  createAuthenticatedTreatmentWritePersistence,
  assertTreatmentWriteRole,
  type TreatmentWriteClient,
} from "./treatment-remote-write-pilot";
import { isTreatmentRemoteWritePilotEnabled } from "./treatment-remote-write-flag";

export async function migrateCompletedBrowserTreatment(
  client: TreatmentWriteClient,
  local: TreatmentDraft,
  env: NodeJS.Dict<string>,
): Promise<TreatmentDraft> {
  if (!isTreatmentRemoteWritePilotEnabled(env)) {
    throw new Error("Treatment migration requires explicit remote read and write flags");
  }
  const preflight = preflightCompletedTreatmentMigration(local.organizationId, [local], []);
  if (preflight[0]?.status !== "needs-identity-verification") {
    throw new Error("Completed treatment failed migration preflight");
  }
  const persistence = await createAuthenticatedTreatmentWritePersistence(
    client,
    local.organizationId,
  );
  const staff = persistence.identity.catalog.findStaffByAppId(
    persistence.identity.organizationDbId,
    persistence.identity.operationalStaffId,
  );
  // Initial pilot is OWNER-only, not all staff who can normally write treatments.
  if (staff?.role !== "OWNER") throw new Error("Only OWNER may migrate browser treatments");
  assertTreatmentWriteRole({ role: staff.role, isActive: true });
  if (persistence.identity.organizationAppId !== local.organizationId) {
    throw new Error("Treatment organization does not match authenticated organization");
  }

  // Check both app ID and appointment before creating anything.
  const [byId, byAppointment] = await Promise.all([
    persistence.treatments.get(local.organizationId, local.id),
    persistence.treatments.getByAppointmentId(local.organizationId, local.appointmentId),
  ]);
  // Both lookups may return separate JS objects representing the same DB row.
  // Deduplicate by stable treatment ID, not object identity.
  const existingById = new Map<string, TreatmentDraft>();
  for (const row of [byId, byAppointment]) {
    if (row) existingById.set(row.id, row);
  }
  const existing = [...existingById.values()];
  const decision = preflightCompletedTreatmentMigration(
    local.organizationId, [local], existing,
  )[0];
  if (decision?.status === "already-remote") return existing[0]!;
  if (decision?.status !== "needs-identity-verification") {
    throw new Error("Remote treatment identity or clinical contents conflict");
  }

  // Canonical adapter checks mapped org/location/customer/service/staff and
  // verifies the appointment's customer and location before INSERT.
  const created = await persistence.treatments.create(local.organizationId, {
    id: local.id,
    appointmentId: local.appointmentId,
    locationId: local.locationId!,
    customerId: local.customerId,
    serviceId: local.serviceId,
    staffId: local.staffId,
    createdBy: persistence.identity.operationalStaffId,
    draft: local,
  });
  // If completion fails, retain the remote DRAFT for manual reconciliation.
  // Never delete or mutate the browser's completed source.
  const completed = await persistence.treatments.complete(local.organizationId, {
    treatmentId: created.id,
    expectedUpdatedAt: created.updatedAt,
    appointmentId: local.appointmentId,
    locationId: local.locationId!,
    customerId: local.customerId,
    serviceId: local.serviceId,
    staffId: local.staffId,
    updatedBy: persistence.identity.operationalStaffId,
    draft: local,
  });
  const reread = await persistence.treatments.get(local.organizationId, local.id);
  if (!reread || reread.status !== "completed" ||
      reread.appointmentId !== local.appointmentId ||
      reread.customerId !== local.customerId ||
      reread.locationId !== local.locationId ||
      reread.staffId !== local.staffId ||
      reread.serviceId !== local.serviceId ||
      !completedTreatmentClinicalFieldsMatch(local, reread)) {
    throw new Error("Migration verification failed; preserve browser source and reconcile remote record");
  }
  return completed;
}
