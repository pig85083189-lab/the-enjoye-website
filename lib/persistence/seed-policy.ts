/**
 * Demo / development seed vs production operational data.
 * Phase 5A-1 does not migrate seed into ledgers.
 */

export const DEMO_SEED_SOURCES = [
  "data/seed-crm.ts",
  "data/seed-organizations.ts",
  "data/mock-appointments.ts",
  "data/mock-services.ts",
  "data/mock-staff.ts",
  "lib/repositories/local-treatment-repository.ts (SEED_COMPLETED_TREATMENTS)",
] as const;

/** Must not be copied into package_ledger_entries / stored_value_ledger_entries. */
export const DEMO_RESIDUE_NOT_LEDGER = [
  "Customer.packages[].remainingSessions",
  "Appointment.remainingSessions",
  "Customer.lastVisit / totalVisits (seed cache)",
] as const;

export const SEED_BOUNDARY = {
  demoMayExistIn: "localStorage + in-memory seed merge (current Production)",
  mustNotBecome: "package_ledger_entries, stored_value_ledger_entries, transactions",
  productionOperationalData: "only rows created by completeCheckout / createAppointment / saveCompletedTreatment",
  remoteFlag: "BEAUTY_OS_DEMO_SEED=1 allows local mock/seed only; remote adapters must refuse residue",
} as const;
