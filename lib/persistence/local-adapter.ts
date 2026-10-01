/**
 * Local adapter — delegates to existing store APIs. No second domain.
 * Production runtime continues to call stores directly; this is the Phase 5A-2 seam.
 */

import {
  createAppointment,
  getScheduleAppointment,
  listAppointments,
} from "@/lib/appointments/store";
import {
  getCheckoutDraft,
  listCheckoutDrafts,
} from "@/lib/commerce/checkout-store";
import {
  getTransaction,
  hasCompletedTransactionForAppointment,
  listTransactions,
} from "@/lib/commerce/transaction-store";
import {
  getFollowUpBySourceTreatment,
  listFollowUpTasks,
} from "@/lib/follow-ups/store";
import {
  getPackageLedgerBalance,
  listCustomerPackages,
  listPackageLedger,
} from "@/lib/packages/store";
import {
  getCustomerStoredValueBalance,
  listStoredValueLedger,
} from "@/lib/stored-value/store";
import {
  getCompletedTreatmentsForCustomer,
  loadDraft,
  saveCompletedTreatment,
  saveDraft,
} from "@/lib/treatment-draft";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import type { OperationalPersistence } from "./types";

export const localOperationalPersistence: OperationalPersistence = {
  driver: "local",
  customers: {
    list: async (query) => localCustomerRepository.list(query),
    getById: async (query) => localCustomerRepository.getById(query),
    upsert: async (customer) => localCustomerRepository.upsert(customer),
    updateProfile: async (organizationId, customerId, patch) =>
      localCustomerRepository.updateProfile(organizationId, customerId, patch),
    findByPhone: async (query) => localCustomerRepository.findByPhone(query),
  },
  appointments: {
    list: listAppointments,
    get: getScheduleAppointment,
    create: createAppointment,
  },
  treatments: {
    loadDraft,
    saveDraft,
    saveCompleted: saveCompletedTreatment,
    listCompletedForCustomer: getCompletedTreatmentsForCustomer,
  },
  checkout: {
    getDraft: getCheckoutDraft,
    listDrafts: listCheckoutDrafts,
  },
  transactions: {
    get: getTransaction,
    list: listTransactions,
    hasCompletedForAppointment: hasCompletedTransactionForAppointment,
  },
  packages: {
    listCustomerPackages,
    ledgerBalance: getPackageLedgerBalance,
    listLedger: listPackageLedger,
  },
  storedValue: {
    customerBalance: getCustomerStoredValueBalance,
    listLedger: listStoredValueLedger,
  },
  followUps: {
    list: listFollowUpTasks,
    getBySourceTreatment: getFollowUpBySourceTreatment,
  },
};
