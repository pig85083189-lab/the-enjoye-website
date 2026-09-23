import {
  TENANT_STORAGE_NAMESPACE,
  LEGACY_STORAGE_KEYS,
  ORG_ENJOYE_ID,
  LEGACY_GLOBAL_LOCATION_KEY,
} from "./constants";

export type TenantResource =
  | "customers"
  | "consultations"
  | "customer-notes"
  | "customer-photos"
  | "appointments"
  | "treatments-completed"
  | "appointment-status"
  | "services";

/**
 * SaaS-ready localStorage key builder.
 * Never embed a specific tenant brand name in generic SaaS helpers.
 */
export function getTenantStorageKey(
  organizationId: string,
  resource: TenantResource,
  version = "v1",
): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:${resource}:${version}`;
}

export function getConsultationDraftKey(
  organizationId: string,
  customerIdOrNew: string,
): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:consultation-draft:${customerIdOrNew}`;
}

export function getTreatmentDraftKey(
  organizationId: string,
  appointmentId: string,
): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:treatment-draft:${appointmentId}`;
}

/** Per-organization selected location pointer */
export function getCurrentLocationStorageKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:current-location-id`;
}

/** Canonical schedule appointments (Phase 4.8A) — separate from CRM appointment snapshots */
export function getScheduleAppointmentsKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:schedule-appointments:v1`;
}

/** Phase 4.8B staff scheduling keys */
export function getStaffWorkingHoursKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:staff-working-hours:v1`;
}

export function getStaffBreaksKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:staff-breaks:v1`;
}

export function getStaffTimeOffKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:staff-time-off:v1`;
}

export function getCalendarViewPrefsKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:calendar-view-prefs:v1`;
}

/** Phase 4.9A commerce */
export function getCheckoutDraftsKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:checkout-drafts:v1`;
}

export function getTransactionsKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:transactions:v1`;
}

export function getTransactionCounterKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:transaction-counter:v1`;
}

/** Phase 4.9B package / stored value */
export function getPackageDefinitionsKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:package-definitions:v1`;
}

export function getCustomerPackagesKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:customer-packages:v1`;
}

export function getPackageLedgerKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:package-ledger:v1`;
}

export function getStoredValueAccountsKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:stored-value-accounts:v1`;
}

export function getStoredValueLedgerKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:stored-value-ledger:v1`;
}

export function getCommerceEffectsKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:commerce-effects:v1`;
}

/** Phase 4.10B product catalog (no stock on product) */
export function getProductsKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:products:v1`;
}

/** Phase 4.10C inventory movements (location-scoped stock ledger) */
export function getInventoryMovementsKey(organizationId: string): string {
  return `${TENANT_STORAGE_NAMESPACE}:${organizationId}:inventory-movements:v1`;
}

export { LEGACY_GLOBAL_LOCATION_KEY };

/** Map legacy Phase 4 global keys → tenant resources (THE ENJOYE only). */
export function legacyKeyForResource(
  resource: TenantResource,
): string | null {
  switch (resource) {
    case "customers":
      return LEGACY_STORAGE_KEYS.customers;
    case "consultations":
      return LEGACY_STORAGE_KEYS.consultations;
    case "customer-notes":
      return LEGACY_STORAGE_KEYS.customerNotes;
    case "customer-photos":
      return LEGACY_STORAGE_KEYS.photos;
    case "appointments":
      return LEGACY_STORAGE_KEYS.crmAppointments;
    case "treatments-completed":
      return LEGACY_STORAGE_KEYS.treatmentsCompleted;
    case "appointment-status":
      return LEGACY_STORAGE_KEYS.appointmentStatus;
    default:
      return null;
  }
}

export function isLegacyMigrationOrg(organizationId: string): boolean {
  return organizationId === ORG_ENJOYE_ID;
}
