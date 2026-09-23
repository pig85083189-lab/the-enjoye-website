/** CRM change events + legacy key aliases (migration only) */

export const STORAGE_KEYS = {
  /** @deprecated Prefer getTenantStorageKey */
  customers: "the-enjoye:customers:v1",
  consultations: "the-enjoye:consultations:v1",
  customerNotes: "the-enjoye:customer-notes:v1",
  photos: "the-enjoye:customer-photos:v1",
  crmAppointments: "the-enjoye:crm-appointments:v1",
  consultationDraftPrefix: "the-enjoye:consultation-draft:",
} as const;

export function consultationDraftKey(customerIdOrNew: string): string {
  return `${STORAGE_KEYS.consultationDraftPrefix}${customerIdOrNew}`;
}

export const CRM_CHANGE_EVENT = "enjoye-crm-change";

export function emitCrmChange(detail?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CRM_CHANGE_EVENT, { detail }));
}
