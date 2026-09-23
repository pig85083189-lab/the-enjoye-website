import type { TreatmentDraft, TreatmentStepId } from "@/types/treatment";
import { isOptionalStep } from "@/types/treatment";
import { migrateLegacyTenantStorage } from "@/lib/tenant/migration";
import {
  getTenantStorageKey,
  getTreatmentDraftKey,
} from "@/lib/tenant/storage-keys";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

/** @deprecated Legacy key — migration only */
export const DRAFT_KEY_PREFIX = "the-enjoye:treatment-draft:";
/** @deprecated Legacy key — migration only */
export const COMPLETED_TREATMENTS_KEY = "the-enjoye:treatments-completed";

export function draftStorageKey(organizationId: string, appointmentId: string): string {
  return getTreatmentDraftKey(organizationId, appointmentId);
}

export function createEmptyDraft(input: {
  organizationId: string;
  locationId?: string;
  appointmentId: string;
  customerId: string;
  staffId: string;
  serviceId: string;
}): TreatmentDraft {
  const now = new Date().toISOString();
  return {
    id: `treatment-${input.appointmentId}`,
    organizationId: input.organizationId,
    locationId: input.locationId,
    appointmentId: input.appointmentId,
    customerId: input.customerId,
    staffId: input.staffId,
    serviceId: input.serviceId,
    status: "draft",
    currentStep: "summary",
    furthestStep: "summary",
    mode: "STANDARD",
    skippedSteps: [],
    suggestedTrackingAreas: [],
    assessment: {
      concerns: [],
      clientFocus: "",
      sensitivityLevel: 0,
      comparisonToLast: "",
    },
    bodyMarkers: [],
    bodyMapNote: "",
    operations: [],
    products: [],
    photos: [],
    professionalNote: "",
    selectedQuickPhrases: [],
    noteManuallyEdited: false,
    clientFeeling: "",
    discomfortNote: "",
    followUp: {
      tags: [],
      suggestedDate: "",
      note: "",
      suggestNextBooking: false,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function isStep(value: unknown): value is TreatmentStepId {
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

/** Safely normalize old localStorage drafts so new fields never crash */
export function normalizeTreatmentDraft(
  raw: Partial<TreatmentDraft> | Record<string, unknown>,
  fallback: {
    organizationId: string;
    locationId?: string;
    appointmentId: string;
    customerId: string;
    staffId: string;
    serviceId: string;
  },
): TreatmentDraft {
  const data = raw as Record<string, unknown>;
  const base = createEmptyDraft(fallback);
  const assessmentRaw =
    data.assessment && typeof data.assessment === "object"
      ? (data.assessment as Record<string, unknown>)
      : {};

  const followUpRaw =
    data.followUp && typeof data.followUp === "object"
      ? (data.followUp as Record<string, unknown>)
      : {};

  const markers = Array.isArray(data.bodyMarkers)
    ? data.bodyMarkers.map((marker, index) => {
        const m = marker as Record<string, unknown>;
        return {
          id: typeof m.id === "string" ? m.id : `marker-legacy-${index}`,
          area: typeof m.area === "string" ? m.area : "area_general",
          conditions: Array.isArray(m.conditions)
            ? m.conditions.filter((c): c is string => typeof c === "string")
            : [],
          note: typeof m.note === "string" ? m.note : "",
        };
      })
    : [];

  const photos = Array.isArray(data.photos)
    ? data.photos.map((photo, index) => {
        const p = photo as Record<string, unknown>;
        return {
          id: typeof p.id === "string" ? p.id : `photo-legacy-${index}`,
          treatmentId:
            typeof p.treatmentId === "string" ? p.treatmentId : base.id,
          type: p.type === "AFTER" ? ("AFTER" as const) : ("BEFORE" as const),
          createdAt:
            typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString(),
          hadPreview: Boolean(p.hadPreview),
        };
      })
    : [];

  const skippedSteps = Array.isArray(data.skippedSteps)
    ? data.skippedSteps.filter((s): s is TreatmentStepId => isStep(s) && isOptionalStep(s))
    : [];

  const suggestedTrackingAreas = Array.isArray(data.suggestedTrackingAreas)
    ? data.suggestedTrackingAreas.filter((s): s is string => typeof s === "string")
    : [];

  return {
    ...base,
    id: typeof data.id === "string" ? data.id : base.id,
    organizationId:
      typeof data.organizationId === "string" ? data.organizationId : fallback.organizationId,
    locationId:
      typeof data.locationId === "string" ? data.locationId : fallback.locationId,
    appointmentId:
      typeof data.appointmentId === "string" ? data.appointmentId : fallback.appointmentId,
    customerId: typeof data.customerId === "string" ? data.customerId : fallback.customerId,
    staffId: typeof data.staffId === "string" ? data.staffId : fallback.staffId,
    serviceId: typeof data.serviceId === "string" ? data.serviceId : fallback.serviceId,
    status: data.status === "completed" ? "completed" : "draft",
    currentStep: isStep(data.currentStep) ? data.currentStep : "summary",
    furthestStep: isStep(data.furthestStep)
      ? data.furthestStep
      : isStep(data.currentStep)
        ? data.currentStep
        : "summary",
    mode: data.mode === "QUICK" ? "QUICK" : "STANDARD",
    skippedSteps,
    suggestedTrackingAreas,
    quickRecordAppliedAt:
      typeof data.quickRecordAppliedAt === "string" ? data.quickRecordAppliedAt : undefined,
    assessment: {
      concerns: Array.isArray(assessmentRaw.concerns)
        ? assessmentRaw.concerns.filter((c): c is string => typeof c === "string")
        : [],
      clientFocus:
        typeof assessmentRaw.clientFocus === "string" ? assessmentRaw.clientFocus : "",
      sensitivityLevel:
        typeof assessmentRaw.sensitivityLevel === "number"
          ? assessmentRaw.sensitivityLevel
          : 0,
      comparisonToLast:
        typeof assessmentRaw.comparisonToLast === "string"
          ? (assessmentRaw.comparisonToLast as TreatmentDraft["assessment"]["comparisonToLast"])
          : "",
    },
    bodyMarkers: markers,
    bodyMapNote: typeof data.bodyMapNote === "string" ? data.bodyMapNote : "",
    operations: Array.isArray(data.operations)
      ? data.operations.filter((o): o is string => typeof o === "string")
      : [],
    products: Array.isArray(data.products)
      ? data.products.filter((o): o is string => typeof o === "string")
      : [],
    photos,
    professionalNote:
      typeof data.professionalNote === "string" ? data.professionalNote : "",
    selectedQuickPhrases: Array.isArray(data.selectedQuickPhrases)
      ? data.selectedQuickPhrases.filter((o): o is string => typeof o === "string")
      : [],
    noteManuallyEdited: Boolean(data.noteManuallyEdited),
    clientFeeling: typeof data.clientFeeling === "string" ? data.clientFeeling : "",
    discomfortNote: typeof data.discomfortNote === "string" ? data.discomfortNote : "",
    followUp: {
      tags: Array.isArray(followUpRaw.tags)
        ? followUpRaw.tags.filter((t): t is string => typeof t === "string")
        : [],
      suggestedDate:
        typeof followUpRaw.suggestedDate === "string" ? followUpRaw.suggestedDate : "",
      note: typeof followUpRaw.note === "string" ? followUpRaw.note : "",
      suggestNextBooking: Boolean(followUpRaw.suggestNextBooking),
    },
    createdAt: typeof data.createdAt === "string" ? data.createdAt : base.createdAt,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : base.updatedAt,
  };
}

export function loadDraft(
  organizationId: string,
  appointmentId: string,
): TreatmentDraft | null {
  if (typeof window === "undefined") return null;
  migrateLegacyTenantStorage(organizationId);
  try {
    const raw = localStorage.getItem(draftStorageKey(organizationId, appointmentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return normalizeTreatmentDraft(parsed, {
      organizationId,
      appointmentId,
      customerId: typeof parsed.customerId === "string" ? parsed.customerId : "",
      staffId: typeof parsed.staffId === "string" ? parsed.staffId : "",
      serviceId: typeof parsed.serviceId === "string" ? parsed.serviceId : "",
    });
  } catch {
    return null;
  }
}

export function saveDraft(draft: TreatmentDraft): void {
  if (typeof window === "undefined") return;
  if (!draft.organizationId) {
    throw new Error("TreatmentDraft.organizationId is required");
  }
  const organizationId = draft.organizationId;
  const normalized = normalizeTreatmentDraft(draft, {
    organizationId,
    locationId: draft.locationId,
    appointmentId: draft.appointmentId,
    customerId: draft.customerId,
    staffId: draft.staffId,
    serviceId: draft.serviceId,
  });
  const toStore: TreatmentDraft = {
    ...normalized,
    organizationId,
    photos: normalized.photos.map(({ id, treatmentId, type, createdAt, hadPreview }) => ({
      id,
      treatmentId,
      type,
      createdAt,
      hadPreview,
    })),
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(
    draftStorageKey(organizationId, draft.appointmentId),
    JSON.stringify(toStore),
  );
  window.dispatchEvent(new Event("enjoye-treatment-draft-change"));
}

export function clearDraft(organizationId: string, appointmentId: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(draftStorageKey(organizationId, appointmentId));
  window.dispatchEvent(new Event("enjoye-treatment-draft-change"));
}

export function saveCompletedTreatment(draft: TreatmentDraft): void {
  if (typeof window === "undefined") return;
  if (!draft.organizationId) {
    throw new Error("TreatmentDraft.organizationId is required");
  }
  const organizationId = draft.organizationId;
  const completed = normalizeTreatmentDraft(
    {
      ...draft,
      organizationId,
      status: "completed",
      currentStep: "complete",
      updatedAt: new Date().toISOString(),
    },
    {
      organizationId,
      locationId: draft.locationId,
      appointmentId: draft.appointmentId,
      customerId: draft.customerId,
      staffId: draft.staffId,
      serviceId: draft.serviceId,
    },
  );
  migrateLegacyTenantStorage(organizationId);
  const key = getTenantStorageKey(organizationId, "treatments-completed");
  try {
    const raw = localStorage.getItem(key);
    const list: TreatmentDraft[] = raw ? (JSON.parse(raw) as TreatmentDraft[]) : [];
    const next = [completed, ...list.filter((item) => item.id !== completed.id)];
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    localStorage.setItem(key, JSON.stringify([completed]));
  }
  clearDraft(organizationId, draft.appointmentId);
}

export function getCompletedTreatmentsForCustomer(
  organizationId: string,
  customerId: string,
): TreatmentDraft[] {
  if (typeof window === "undefined") return [];
  migrateLegacyTenantStorage(organizationId);
  try {
    const raw = localStorage.getItem(
      getTenantStorageKey(organizationId, "treatments-completed"),
    );
    if (!raw) return [];
    const list = JSON.parse(raw) as Partial<TreatmentDraft>[];
    return list
      .filter(
        (item) =>
          item.customerId === customerId &&
          (!item.organizationId || item.organizationId === organizationId),
      )
      .map((item) =>
        normalizeTreatmentDraft(item as Record<string, unknown>, {
          organizationId,
          appointmentId: item.appointmentId ?? "",
          customerId,
          staffId: item.staffId ?? "",
          serviceId: item.serviceId ?? "",
        }),
      );
  } catch {
    return [];
  }
}

/** Default org for legacy seed stamps */
export function defaultSeedOrganizationId(): string {
  return ORG_ENJOYE_ID;
}

export function draftHasContent(draft: TreatmentDraft): boolean {
  return (
    draft.assessment.concerns.length > 0 ||
    draft.assessment.clientFocus.trim().length > 0 ||
    draft.assessment.sensitivityLevel > 0 ||
    Boolean(draft.assessment.comparisonToLast) ||
    draft.bodyMarkers.length > 0 ||
    draft.bodyMapNote.trim().length > 0 ||
    draft.operations.length > 0 ||
    draft.products.length > 0 ||
    draft.photos.length > 0 ||
    draft.professionalNote.trim().length > 0 ||
    draft.selectedQuickPhrases.length > 0 ||
    draft.clientFeeling.length > 0 ||
    draft.followUp.tags.length > 0 ||
    draft.followUp.suggestedDate.length > 0 ||
    draft.followUp.note.trim().length > 0 ||
    draft.followUp.suggestNextBooking ||
    draft.mode === "QUICK" ||
    draft.skippedSteps.length > 0 ||
    draft.currentStep !== "summary"
  );
}

export function stepIndex(step: TreatmentStepId): number {
  const order: TreatmentStepId[] = [
    "summary",
    "assessment",
    "bodyMap",
    "operations",
    "photos",
    "professionalNote",
    "followUp",
    "complete",
  ];
  return order.indexOf(step);
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function composeNoteFromPhrases(
  phrases: string[],
  textMap: Record<string, string>,
): string {
  if (phrases.length === 0) return "";
  const parts = phrases.map((phrase) => textMap[phrase] ?? phrase);
  if (parts.length === 1) return `${parts[0]}。`;
  return `${parts.join("，")}。`;
}

export type StepCompletionState = "complete" | "skipped" | "current" | "pending";

/** Content-based completion — not merely “visited” */
export function getStepCompletionState(
  draft: TreatmentDraft,
  step: TreatmentStepId,
): StepCompletionState {
  if (draft.currentStep === step) return "current";
  if (draft.skippedSteps.includes(step)) return "skipped";

  switch (step) {
    case "summary":
      return "complete";
    case "assessment":
      return draft.assessment.concerns.length > 0 ||
        Boolean(draft.assessment.comparisonToLast) ||
        draft.assessment.clientFocus.trim().length > 0
        ? "complete"
        : "pending";
    case "bodyMap":
      return draft.bodyMarkers.length > 0 || draft.bodyMapNote.trim().length > 0
        ? "complete"
        : "pending";
    case "operations":
      return draft.operations.length > 0 || draft.products.length > 0
        ? "complete"
        : "pending";
    case "photos":
      return draft.photos.length > 0 ? "complete" : "pending";
    case "professionalNote":
      return draft.professionalNote.trim().length > 0 ||
        draft.clientFeeling.length > 0 ||
        draft.selectedQuickPhrases.length > 0
        ? "complete"
        : "pending";
    case "followUp":
      return draft.followUp.tags.length > 0 ||
        draft.followUp.suggestedDate.length > 0 ||
        draft.followUp.note.trim().length > 0 ||
        draft.followUp.suggestNextBooking
        ? "complete"
        : "pending";
    case "complete":
      return "pending";
    default:
      return "pending";
  }
}
