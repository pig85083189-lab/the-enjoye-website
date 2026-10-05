/**
 * Canonical treatment remote mapping.
 * Domain SoT is TreatmentDraft. Photos persist as metadata only.
 */

import type { TreatmentDraft, TreatmentPhotoMeta, TreatmentStatus, TreatmentStepId } from "@/types/treatment";
import { normalizeTreatmentDraft } from "@/lib/treatment-draft";
import type { CanonicalIdMapper } from "./identity-map";
import type { DbTreatment, RemoteServiceType, RemoteTreatmentStatus } from "./operational-rows";

export const REMOTE_TREATMENT_COLUMNS = [
  "id",
  "organization_id",
  "location_id",
  "appointment_id",
  "customer_id",
  "service_id",
  "staff_id",
  "app_id",
  "mode",
  "template_type",
  "assessment",
  "body_markers",
  "operations",
  "products",
  "professional_note",
  "client_feeling",
  "follow_up",
  "skipped_steps",
  "started_at",
  "completed_at",
  "status",
  "body_map_note",
  "discomfort_note",
  "furthest_step",
  "current_step",
  "created_by",
  "updated_by",
  "suggested_tracking_areas",
  "selected_quick_phrases",
  "note_manually_edited",
  "quick_record_applied_at",
  "photo_meta",
  "created_at",
  "updated_at",
] as const;

export const TREATMENT_MUTATE_FORBIDDEN_COLUMNS = [
  "id",
  "app_id",
  "organization_id",
  "customer_id",
  "appointment_id",
  "location_id",
  "created_at",
  "created_by",
  "updated_at",
  "started_at",
] as const;

export const TREATMENT_MUTATE_PATCH_COLUMNS = [
  "service_id",
  "staff_id",
  "mode",
  "template_type",
  "assessment",
  "body_markers",
  "operations",
  "products",
  "professional_note",
  "client_feeling",
  "follow_up",
  "skipped_steps",
  "completed_at",
  "status",
  "body_map_note",
  "discomfort_note",
  "furthest_step",
  "current_step",
  "updated_by",
  "suggested_tracking_areas",
  "selected_quick_phrases",
  "note_manually_edited",
  "quick_record_applied_at",
  "photo_meta",
] as const;

const SERVICE_TYPES = new Set<RemoteServiceType>([
  "BREAST",
  "BODY_SCULPTING",
  "FACIAL",
  "WOMB_CARE",
  "DETOX",
  "NAVEL_CANDLE",
  "EXFOLIATION",
  "WAXING",
  "OTHER",
]);

export function toRemoteTreatmentStatus(status: TreatmentStatus): RemoteTreatmentStatus {
  return status === "completed" ? "COMPLETED" : "DRAFT";
}

export function fromRemoteTreatmentStatus(status: RemoteTreatmentStatus | string): TreatmentStatus {
  return status === "COMPLETED" ? "completed" : "draft";
}

export function toRemoteTemplateType(value: string | undefined): RemoteServiceType {
  if (value && SERVICE_TYPES.has(value as RemoteServiceType)) {
    return value as RemoteServiceType;
  }
  return "OTHER";
}

export function photoMetaFromDraft(photos: TreatmentPhotoMeta[]): Array<{
  id: string;
  treatmentId: string;
  type: TreatmentPhotoMeta["type"];
  createdAt: string;
  hadPreview: boolean;
}> {
  return photos.map((photo) => ({
    id: photo.id,
    treatmentId: photo.treatmentId,
    type: photo.type,
    createdAt: photo.createdAt,
    hadPreview: Boolean(photo.hadPreview),
  }));
}

export function assertMappedTreatmentDependencies(
  mapper: CanonicalIdMapper,
  organizationId: string,
  input: { locationId: string; customerId: string; serviceId: string },
): {
  organizationDbId: string;
  locationDbId: string;
  customerDbId: string;
  serviceDbId: string;
} {
  if (!input.locationId?.trim()) {
    throw new Error("Treatment locationId is required");
  }
  return {
    organizationDbId: mapper.resolveOrganizationDbId(organizationId),
    locationDbId: mapper.resolveLocationDbId(organizationId, input.locationId),
    customerDbId: mapper.resolveCustomerDbId(organizationId, input.customerId),
    serviceDbId: mapper.resolveServiceDbId(organizationId, input.serviceId),
  };
}

export function remoteTreatmentPayload(row: DbTreatment): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const column of REMOTE_TREATMENT_COLUMNS) {
    payload[column] = row[column];
  }
  if ("previewUrl" in payload || "remainingSessions" in payload) {
    throw new Error("treatment remote payload leaked domain-only fields");
  }
  return payload;
}

export function sanitizeTreatmentMutatePatch(
  patch: Record<string, unknown>,
): Record<string, unknown> {
  if ("previewUrl" in patch || "remainingSessions" in patch) {
    throw new Error("treatment mutate payload leaked domain-only fields");
  }
  if ("customer_id" in patch) {
    throw new Error("Treatment customer_id is immutable");
  }
  if ("appointment_id" in patch) {
    throw new Error("Treatment appointment_id is immutable");
  }
  if ("location_id" in patch) {
    throw new Error("Treatment location_id is immutable");
  }
  const sanitized: Record<string, unknown> = {};
  for (const column of TREATMENT_MUTATE_PATCH_COLUMNS) {
    if (column in patch) {
      sanitized[column] = patch[column];
    }
  }
  for (const column of TREATMENT_MUTATE_FORBIDDEN_COLUMNS) {
    if (column in sanitized) {
      throw new Error(`Treatment mutate cannot set ${column}`);
    }
  }
  return sanitized;
}

export function clinicalPatchFromDraft(draft: TreatmentDraft): Record<string, unknown> {
  return {
    mode: draft.mode,
    assessment: draft.assessment,
    body_markers: draft.bodyMarkers,
    operations: draft.operations,
    products: draft.products,
    professional_note: draft.professionalNote || null,
    client_feeling: draft.clientFeeling || null,
    follow_up: draft.followUp,
    skipped_steps: draft.skippedSteps,
    body_map_note: draft.bodyMapNote || null,
    discomfort_note: draft.discomfortNote || null,
    furthest_step: draft.furthestStep,
    current_step: draft.currentStep,
    suggested_tracking_areas: draft.suggestedTrackingAreas,
    selected_quick_phrases: draft.selectedQuickPhrases,
    note_manually_edited: draft.noteManuallyEdited,
    quick_record_applied_at: draft.quickRecordAppliedAt ?? null,
    photo_meta: photoMetaFromDraft(draft.photos),
  };
}

export function treatmentFromRemoteRow(
  organizationAppId: string,
  locationAppId: string,
  customerAppId: string,
  serviceAppId: string,
  appointmentAppId: string,
  row: DbTreatment,
): TreatmentDraft {
  const photos = Array.isArray(row.photo_meta) ? row.photo_meta : [];
  return normalizeTreatmentDraft(
    {
      id: row.app_id,
      organizationId: organizationAppId,
      locationId: locationAppId,
      appointmentId: appointmentAppId,
      customerId: customerAppId,
      staffId: row.staff_id ?? "",
      serviceId: serviceAppId,
      status: fromRemoteTreatmentStatus(row.status),
      currentStep: row.current_step,
      furthestStep: row.furthest_step,
      mode: row.mode,
      skippedSteps: row.skipped_steps,
      suggestedTrackingAreas: row.suggested_tracking_areas,
      quickRecordAppliedAt: row.quick_record_applied_at ?? undefined,
      assessment: row.assessment,
      bodyMarkers: row.body_markers,
      bodyMapNote: row.body_map_note ?? "",
      operations: row.operations,
      products: row.products,
      photos,
      professionalNote: row.professional_note ?? "",
      selectedQuickPhrases: row.selected_quick_phrases,
      noteManuallyEdited: row.note_manually_edited,
      clientFeeling: row.client_feeling ?? "",
      discomfortNote: row.discomfort_note ?? "",
      followUp: row.follow_up,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    {
      organizationId: organizationAppId,
      locationId: locationAppId,
      appointmentId: appointmentAppId,
      customerId: customerAppId,
      staffId: row.staff_id ?? "",
      serviceId: serviceAppId,
    },
  );
}

export function isTreatmentStep(value: unknown): value is TreatmentStepId {
  return (
    value === "summary" ||
    value === "assessment" ||
    value === "bodyMap" ||
    value === "operations" ||
    value === "photos" ||
    value === "professionalNote" ||
    value === "followUp" ||
    value === "complete"
  );
}
