/**
 * Customer UI async migration sequence — Phase 1C-1 plan only.
 * Live pages still read/write localCustomerRepository.
 */

export const CUSTOMER_UI_MIGRATION_STEPS = [
  {
    id: "A",
    title: "Customer List async read",
    files: ["features/customers/CustomerListPage.tsx"],
    loadingUx: "Reuse ListSkeleton / useIsClient; await listCustomers(orgId)",
    errorUx: "Empty + Access unavailable if the query rejects",
    localBehavior: "Same seed + localStorage merge as today",
    remoteBehavior: "Remote-only list; empty stays empty; no seed merge",
    rollback: "Keep localCustomerRepository.list import",
  },
  {
    id: "B",
    title: "Customer Detail async read",
    files: ["features/customers/CustomerProfilePage.tsx", "features/customers/use-customer-360.ts"],
    loadingUx: "Existing pulse card until getCustomer resolves",
    errorUx: "Existing 找不到此客戶 card",
    localBehavior: "getById including seed",
    remoteBehavior: "Mapped remote row or undefined",
    rollback: "Keep useCrmJson(localCustomerRepository.getById)",
  },
  {
    id: "C",
    title: "Customer create",
    files: ["features/customers/ConsultationWizard.tsx", "app/staff/(app)/customers/new/page.tsx"],
    loadingUx: "Saving flag already exists; switch upsert to createCustomer",
    errorUx: "Inline form error; firewall errors stay visible",
    localBehavior: "createCustomer → local adapter → localStorage",
    remoteBehavior: "createCustomer → CustomerRemoteAdapter; newId(cust); no demo",
    rollback: "Keep localCustomerRepository.upsert",
  },
  {
    id: "D",
    title: "Customer edit",
    files: ["features/customers/CustomerEditForm.tsx"],
    loadingUx: "Existing saving state; await updateCustomer",
    errorUx: "Existing setError",
    localBehavior: "updateProfile local-only fields remain local",
    remoteBehavior: "Remote profile columns only; occupation/address stay local-only",
    rollback: "Keep localCustomerRepository.updateProfile",
  },
  {
    id: "E",
    title: "Cross-module customer consumers",
    files: [
      "features/calendar/CalendarPage.tsx",
      "features/treatments/TreatmentsListPageClient.tsx",
      "features/treatments/TreatmentDetailReadonly.tsx",
      "features/checkout/CheckoutPageClient.tsx",
      "features/packages/PackagesPageClient.tsx",
      "features/stored-value/StoredValuePageClient.tsx",
      "features/transactions/TransactionsPageClient.tsx",
      "features/follow-ups/FollowUpsPageClient.tsx",
    ],
    loadingUx: "Each page needs its own list/get loading; do not block calendar render",
    errorUx: "Picker empty + fail-closed, never seed fallback",
    localBehavior: "Unchanged lists",
    remoteBehavior: "Async listCustomers; calendar stays local until 1C-2+",
    rollback: "Keep sync localCustomerRepository per module",
  },
] as const;
