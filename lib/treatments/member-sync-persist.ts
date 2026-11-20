import type { TreatmentDraft } from "@/types/treatment";
import { completedTreatmentClinicalFieldsMatch } from "@/lib/treatments/completed-treatment-migration-preflight";
import {
  assertTreatmentWriteRole,
  createAuthenticatedTreatmentWritePersistence,
  type TreatmentWriteClient,
} from "@/lib/treatments/treatment-remote-write-pilot";

export type MemberSyncPersistDecision =
  | "create"
  | "complete"
  | "retry"
  | "reject-customer"
  | "reject-conflict";

/** Decide whether a browser-completed treatment may be stored once. No write happens here. */
export function memberSyncPersistDecision(input: {
  draftCustomerId: string;
  appointmentCustomerId: string;
  existing: Pick<TreatmentDraft, "id" | "customerId" | "appointmentId" | "status"> | null;
  draft: TreatmentDraft;
  remoteClinical: TreatmentDraft | null;
}): MemberSyncPersistDecision {
  if (input.draftCustomerId !== input.appointmentCustomerId) return "reject-customer";
  if (!input.existing) return "create";
  if (input.existing.id !== input.draft.id ||
      input.existing.customerId !== input.appointmentCustomerId ||
      input.existing.appointmentId !== input.draft.appointmentId) {
    return "reject-conflict";
  }
  if (input.existing.status === "completed") {
    if (!input.remoteClinical || !completedTreatmentClinicalFieldsMatch(input.draft, input.remoteClinical)) {
      return "reject-conflict";
    }
    return "retry";
  }
  return "complete";
}

const CUSTOMER_MISMATCH = "顧客身分與預約不一致，未同步到會員。";
const CONFLICT = "這筆預約已有不同的正式療程，未覆蓋，也未另建療程。";

/**
 * Store one completed treatment on the booking database without the remote-write pilot.
 * The appointment customer is supplied by the server. A retry does not insert another row.
 */
export async function persistBrowserCompletedTreatment(
  client: unknown,
  draft: TreatmentDraft,
  appointmentCustomerId: string,
): Promise<TreatmentDraft> {
  const persistence = await createAuthenticatedTreatmentWritePersistence(
    client as TreatmentWriteClient,
    draft.organizationId,
  );
  assertTreatmentWriteRole({
    role: persistence.identity.catalog.findStaffByAppId(
      persistence.identity.organizationDbId,
      persistence.identity.operationalStaffId,
    )?.role,
    isActive: true,
  });
  if (persistence.identity.organizationAppId !== draft.organizationId) {
    throw new Error(CUSTOMER_MISMATCH);
  }
  if (persistence.identity.operationalStaffId !== draft.staffId) {
    throw new Error("無法確認操作人員與療程美容師一致，未同步。");
  }
  const existing = await persistence.treatments.getByAppointmentId(draft.organizationId, draft.appointmentId) ?? null;
  const decision = memberSyncPersistDecision({
    draftCustomerId: draft.customerId,
    appointmentCustomerId,
    existing,
    draft,
    remoteClinical: existing,
  });
  if (decision === "reject-customer") throw new Error(CUSTOMER_MISMATCH);
  if (decision === "reject-conflict") throw new Error(CONFLICT);
  if (decision === "retry") return existing!;
  const created = decision === "create"
    ? await persistence.treatments.create(draft.organizationId, {
        id: draft.id,
        appointmentId: draft.appointmentId,
        locationId: draft.locationId ?? "",
        customerId: appointmentCustomerId,
        serviceId: draft.serviceId,
        staffId: draft.staffId,
        createdBy: persistence.identity.operationalStaffId,
        draft,
      })
    : existing!;
  const completed = await persistence.treatments.complete(draft.organizationId, {
    treatmentId: created.id,
    expectedUpdatedAt: created.updatedAt,
    appointmentId: draft.appointmentId,
    locationId: draft.locationId ?? "",
    customerId: appointmentCustomerId,
    serviceId: draft.serviceId,
    staffId: draft.staffId,
    updatedBy: persistence.identity.operationalStaffId,
    draft,
  });
  const reread = await persistence.treatments.get(draft.organizationId, draft.id);
  if (!reread || !completedTreatmentClinicalFieldsMatch(draft, reread)) {
    throw new Error("療程已送出但正式資料庫回讀驗證失敗，請勿重複建立療程。");
  }
  return completed;
}
