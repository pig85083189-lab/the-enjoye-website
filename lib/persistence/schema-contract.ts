/**
 * Phase 5A-1 schema / SoT contract.
 * Domain types stay in existing lib domain modules.
 * This file only documents persistence rules.
 */

export const OPERATIONAL_MIGRATION_FILE =
  "supabase/migrations/20260928113000_beauty_os_operational_foundation.sql";

export const ENUM_ADAPT_MIGRATION_FILE =
  "supabase/migrations/20260928112900_beauty_os_enum_adapt.sql";

export const IDENTITY_MIGRATION_FILE =
  "supabase/migrations/20260928112950_staff_auth_memberships.sql";

export const FOUNDATION_MIGRATION_FILE =
  "supabase/migrations/20260918120000_beauty_os_foundation.sql";

/** Phase 1C-5A.1 Appointment same-org / location NOT NULL hardening. */
export const APPOINTMENT_INTEGRITY_MIGRATION_FILE =
  "supabase/migrations/20261002120000_appointment_tenant_integrity.sql";

/** Phase 1C-6B.2 staff overlap exclusion. Applied remotely after 1C-6B.1 draft. */
export const APPOINTMENT_STAFF_OVERLAP_MIGRATION_FILE =
  "supabase/migrations/20261003120000_appointment_staff_overlap_exclusion.sql";

/** Phase 1C-6G Treatment remote foundation. Reuses public.treatments. */
export const TREATMENT_REMOTE_FOUNDATION_MIGRATION_FILE =
  "supabase/migrations/20261004120000_treatment_remote_foundation.sql";

/** Must never appear as stored columns (second books). */
export const FORBIDDEN_STORED_COLUMNS = [
  "remaining_sessions",
  "package_remaining",
  "stored_value_balance",
  "stored_value_balance_minor",
  "is_paid",
  "balance_minor",
] as const;

export const SOURCE_OF_TRUTH = {
  appointmentStatus: "appointments.status",
  treatmentCompletion: "treatments.status",
  payment: "transactions.status = COMPLETED",
  packageBalance: "SUM(package_ledger_entries.session_delta)",
  storedValueBalance: "SUM(stored_value_ledger_entries.amount_delta_minor)",
  inventory: "SUM(inventory_movements.quantity_delta)",
  checkoutIntent: "checkout_drafts (OPEN is not settlement)",
} as const;

export const MONEY_COLUMN_SUFFIX = "_minor";

export const LEDGER_EFFECT_KEY_INDEXES = [
  "idx_package_ledger_org_effect_key",
  "idx_stored_value_ledger_org_effect_key",
  "idx_inventory_movements_org_effect_key",
] as const;

export const OPERATIONAL_TABLES = [
  "organizations",
  "locations",
  "profiles",
  "staff_auth_memberships",
  "staff_auth_membership_locations",
  "customers",
  "services",
  "appointments",
  "treatments",
  "treatment_photos",
  "checkout_drafts",
  "checkout_items",
  "checkout_discounts",
  "checkout_payments",
  "transactions",
  "transaction_items",
  "transaction_payments",
  "transaction_discounts",
  "package_definitions",
  "customer_packages",
  "package_ledger_entries",
  "stored_value_accounts",
  "stored_value_ledger_entries",
  "products",
  "inventory_movements",
  "follow_up_tasks",
  "audit_logs",
] as const;

export const STAFF_ROLE_ADAPT = {
  keep: ["OWNER", "MANAGER", "THERAPIST", "RECEPTIONIST"],
  add: ["STAFF", "ACCOUNTANT"],
  alias: { THERAPIST: "STAFF" },
} as const;
