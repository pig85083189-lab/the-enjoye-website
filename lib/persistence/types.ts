/**
 * Persistence port. Existing domain types remain canonical.
 * Live UI still calls local stores/repositories directly in Phase 1B.
 * CustomerPersistence is async so remote adapters are never fake-sync.
 */

import type { AppointmentListQuery, CreateAppointmentInput } from "@/lib/appointments/store";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import type { CheckoutDraft, Transaction } from "@/lib/commerce/domain";
import type { TreatmentDraft } from "@/types/treatment";
import type { FollowUpTask } from "@/lib/follow-ups/domain";
import type { CustomerPackage, PackageLedgerEntry } from "@/lib/packages/domain";
import type { StoredValueLedgerEntry } from "@/lib/stored-value/domain";
import type { Customer } from "@/types";
import type {
  CustomerProfilePatch,
  OrgEntityQuery,
  OrgQuery,
} from "@/lib/repositories/interfaces";

export interface AppointmentPersistence {
  list(query: AppointmentListQuery, anchorDay?: Date): ScheduleAppointment[];
  get(organizationId: string, appointmentId: string): ScheduleAppointment | undefined;
  create(organizationId: string, input: CreateAppointmentInput): ScheduleAppointment;
}

export interface CustomerPersistence {
  list(query: OrgQuery): Promise<Customer[]>;
  getById(query: OrgEntityQuery): Promise<Customer | undefined>;
  upsert(customer: Customer): Promise<Customer>;
  updateProfile(
    organizationId: string,
    customerId: string,
    patch: CustomerProfilePatch,
  ): Promise<Customer>;
  findByPhone(query: OrgQuery & { phone: string }): Promise<Customer[]>;
}

export interface TreatmentPersistence {
  loadDraft(organizationId: string, appointmentId: string): TreatmentDraft | null;
  saveDraft(draft: TreatmentDraft): void;
  saveCompleted(draft: TreatmentDraft): void;
  listCompletedForCustomer(organizationId: string, customerId: string): TreatmentDraft[];
}

export interface CheckoutPersistence {
  getDraft(organizationId: string, draftId: string): CheckoutDraft | undefined;
  listDrafts(
    organizationId: string,
    opts?: { locationId?: string; status?: CheckoutDraft["status"] },
  ): CheckoutDraft[];
}

export interface TransactionPersistence {
  get(organizationId: string, transactionId: string): Transaction | undefined;
  list(
    organizationId: string,
    opts?: { locationId?: string; customerId?: string; status?: Transaction["status"] },
  ): Transaction[];
  hasCompletedForAppointment(organizationId: string, appointmentId: string): boolean;
}

export interface PackagePersistence {
  listCustomerPackages(
    organizationId: string,
    opts?: { customerId?: string },
  ): CustomerPackage[];
  ledgerBalance(organizationId: string, customerPackageId: string): number;
  listLedger(
    organizationId: string,
    opts?: { customerPackageId?: string; customerId?: string },
  ): PackageLedgerEntry[];
}

export interface StoredValuePersistence {
  customerBalance(organizationId: string, customerId: string): number;
  listLedger(
    organizationId: string,
    opts?: { accountId?: string; customerId?: string },
  ): StoredValueLedgerEntry[];
}

export interface FollowUpPersistence {
  list(organizationId: string): FollowUpTask[];
  getBySourceTreatment(
    organizationId: string,
    treatmentId: string,
  ): FollowUpTask | undefined;
}

export interface OperationalPersistence {
  driver: "local" | "supabase";
  customers: CustomerPersistence;
  appointments: AppointmentPersistence;
  treatments: TreatmentPersistence;
  checkout: CheckoutPersistence;
  transactions: TransactionPersistence;
  packages: PackagePersistence;
  storedValue: StoredValuePersistence;
  followUps: FollowUpPersistence;
}
