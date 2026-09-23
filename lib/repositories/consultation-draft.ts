import type { CustomerConsultation } from "@/types/customer";
import { getConsultationDraftKey } from "@/lib/tenant/storage-keys";
import { migrateLegacyTenantStorage } from "@/lib/tenant/migration";
import { emitCrmChange } from "./keys";

export type ConsultationDraftPayload = {
  step: number;
  organizationId: string;
  customerId: string | "new";
  form: Record<string, unknown>;
  updatedAt: string;
};

export function loadConsultationDraft(
  organizationId: string,
  customerIdOrNew: string,
): ConsultationDraftPayload | null {
  if (typeof window === "undefined") return null;
  migrateLegacyTenantStorage(organizationId);
  try {
    const raw = window.localStorage.getItem(
      getConsultationDraftKey(organizationId, customerIdOrNew),
    );
    if (!raw) return null;
    return JSON.parse(raw) as ConsultationDraftPayload;
  } catch {
    return null;
  }
}

export function saveConsultationDraft(payload: ConsultationDraftPayload): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    getConsultationDraftKey(payload.organizationId, payload.customerId),
    JSON.stringify({ ...payload, updatedAt: new Date().toISOString() }),
  );
  emitCrmChange("consultation-draft");
}

export function clearConsultationDraft(
  organizationId: string,
  customerIdOrNew: string,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(
    getConsultationDraftKey(organizationId, customerIdOrNew),
  );
  emitCrmChange("consultation-draft:clear");
}

export type { CustomerConsultation };
