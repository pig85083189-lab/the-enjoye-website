/**
 * Supabase operational adapter — not enabled.
 * Live UI stays on local stores. Customer / appointment remote adapters are
 * constructed only via createRemoteOperationalPersistence() with dual flags.
 */

import type { OperationalPersistence } from "./types";

const MESSAGE =
  "Supabase operational persistence is not enabled (Phase 5A-1). Runtime stays on local stores.";

function disabled(): never {
  throw new Error(MESSAGE);
}

export const SUPABASE_PERSISTENCE_DISABLED_MESSAGE = MESSAGE;

export const supabaseOperationalPersistence: OperationalPersistence = {
  driver: "supabase",
  customers: {
    list: disabled,
    getById: disabled,
    upsert: disabled,
    updateProfile: disabled,
    findByPhone: disabled,
  },
  services: {
    list: disabled,
    getById: disabled,
    create: disabled,
    upsert: disabled,
  },
  appointments: {
    list: disabled,
    get: disabled,
    create: disabled,
  },
  treatments: {
    loadDraft: disabled,
    saveDraft: disabled,
    saveCompleted: disabled,
    listCompletedForCustomer: disabled,
  },
  checkout: {
    getDraft: disabled,
    listDrafts: disabled,
  },
  transactions: {
    get: disabled,
    list: disabled,
    hasCompletedForAppointment: disabled,
  },
  packages: {
    listCustomerPackages: disabled,
    ledgerBalance: disabled,
    listLedger: disabled,
  },
  storedValue: {
    customerBalance: disabled,
    listLedger: disabled,
  },
  followUps: {
    list: disabled,
    getBySourceTreatment: disabled,
  },
};
