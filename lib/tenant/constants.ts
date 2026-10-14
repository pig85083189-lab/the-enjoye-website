/** Stable demo tenant IDs — used by seed, migration, and tests */

export const PLATFORM_NAME = "Beauty OS";

export const ORG_ENJOYE_ID = "org-the-enjoye";
export const ORG_LUMIERE_ID = "org-lumiere";
export const ORG_BEAUTY_OS_TEST_ID = "org-beauty-os-test";

export const LOC_ENJOYE_PRIMARY_ID = "loc-enjoye-main";
export const LOC_ENJOYE_SECONDARY_ID = "loc-enjoye-gongyi";
export const LOC_LUMIERE_PRIMARY_ID = "loc-lumiere-main";
export const LOC_BEAUTY_OS_TEST_PRIMARY_ID = "loc-beauty-os-test-main";

export const MEMBERSHIP_ENJOYE_OWNER_ID = "mem-enjoye-owner";
export const MEMBERSHIP_BEAUTY_OS_TEST_OWNER_ID = "mem-beauty-os-test-owner";
export const MEMBERSHIP_ENJOYE_STAFF_XIAOMEI_ID = "mem-enjoye-xiaomei";
export const MEMBERSHIP_ENJOYE_STAFF_AMY_ID = "mem-enjoye-amy";
export const MEMBERSHIP_ENJOYE_STAFF_ANAN_ID = "mem-enjoye-anan";
export const MEMBERSHIP_LUMIERE_STAFF_ID = "mem-lumiere-staff";
export const MEMBERSHIP_LUMIERE_THERAPIST_ID = "mem-lumiere-therapist";

/** Legacy Phase 4 keys (pre–tenant isolation) */
export const LEGACY_STORAGE_KEYS = {
  customers: "the-enjoye:customers:v1",
  consultations: "the-enjoye:consultations:v1",
  customerNotes: "the-enjoye:customer-notes:v1",
  photos: "the-enjoye:customer-photos:v1",
  crmAppointments: "the-enjoye:crm-appointments:v1",
  consultationDraftPrefix: "the-enjoye:consultation-draft:",
  treatmentDraftPrefix: "the-enjoye:treatment-draft:",
  treatmentsCompleted: "the-enjoye:treatments-completed",
  appointmentStatus: "the-enjoye:appointment-status",
} as const;

export const TENANT_STORAGE_NAMESPACE = "beauty-os";
export const CURRENT_ORG_STORAGE_KEY = "beauty-os:current-organization-id";
export const ORG_OVERRIDES_STORAGE_KEY = "beauty-os:organization-overrides:v1";
export const LOCATION_OVERRIDES_STORAGE_KEY = "beauty-os:location-overrides:v1";
export const MEMBERSHIP_OVERRIDES_STORAGE_KEY = "beauty-os:membership-overrides:v1";
export const MIGRATION_FLAG_KEY = "beauty-os:legacy-migration:v1";
/** @deprecated Global location pointer — migrate to org-scoped key */
export const LEGACY_GLOBAL_LOCATION_KEY = "beauty-os:current-location-id";
