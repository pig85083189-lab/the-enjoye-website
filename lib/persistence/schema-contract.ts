/**
 * Phase 5A-1 schema / SoT contract.
 * Domain types stay in existing lib domain modules.
 * This file only documents persistence rules.
 */

export const OPERATIONAL_MIGRATION_FILE =
  "supabase/migrations/20260928113000_beauty_os_operational_foundation.sql";

/** Defective origin/main 113000 (unqualified audit_logs policy). */
export const OPERATIONAL_MIGRATION_DEFECTIVE_SHA256 =
  "2c01751cdbcef8294d16b0cb580c17948ce9598528bb0e7ca4dada0ff1a24618";

/** Phase 1C-6H.2P2B qualified replay repair. */
export const OPERATIONAL_MIGRATION_REPAIRED_SHA256 =
  "baa230a5f4aa44d506aa811e3350cbf39265ce56d1083aba56a1c8ace65911f5";

export const OPERATIONAL_MIGRATION_REPAIR_DOC =
  "docs/supabase/migration-repair-20260928113000.md";

export const ENUM_ADAPT_MIGRATION_FILE =
  "supabase/migrations/20260928112900_beauty_os_enum_adapt.sql";

export const IDENTITY_MIGRATION_FILE =
  "supabase/migrations/20260928112950_staff_auth_memberships.sql";

/** Phase 1C-6H.2P2A pre-113000 fresh-DB policy bridge. Does not alter types. */
export const AUDIT_LOGS_ACTOR_BRIDGE_MIGRATION_FILE =
  "supabase/migrations/20260928112975_audit_logs_actor_operational_bridge.sql";

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

/** Phase 1C-6H.2 Commerce remote settlement RPCs. Reuses checkout_* / transaction_*. */
export const COMMERCE_REMOTE_SETTLEMENT_MIGRATION_FILE =
  "supabase/migrations/20261005120000_commerce_remote_settlement.sql";

/** Phase 1C-6H.2P additive Strategy B / RLS qualification. */
export const STRATEGY_B_RLS_MIGRATION_FILE =
  "supabase/migrations/20261006120000_strategy_b_rls_qualification.sql";

/** Phase 1C-6H.2P checkout / transaction direct-table write hardening. */
export const COMMERCE_TABLE_WRITE_HARDENING_MIGRATION_FILE =
  "supabase/migrations/20261006130000_commerce_table_write_hardening.sql";

/** Finance V1B Expense foundation. Additive draft — Preview apply only; do not Production apply in this PR. */
export const FINANCE_EXPENSE_FOUNDATION_MIGRATION_FILE =
  "supabase/migrations/20261007120000_finance_expense_foundation.sql";

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
