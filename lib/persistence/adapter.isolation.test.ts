import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyCheckoutDraft, listCheckoutDrafts } from "@/lib/commerce/checkout-store";
import { listTransactions } from "@/lib/commerce/transaction-store";
import {
  createCustomerPackageFromPurchase,
  createPackageDefinition,
  getPackageLedgerBalance,
  listPackageLedger,
} from "@/lib/packages/store";
import {
  getCustomerStoredValueBalance,
  listStoredValueLedger,
  postStoredValuePayment,
  postStoredValueTopUp,
} from "@/lib/stored-value/store";
import {
  LOC_ENJOYE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import {
  getOperationalPersistence,
  getPersistenceDriver,
  isSupabasePersistenceEnabled,
  localOperationalPersistence,
  supabaseOperationalPersistence,
} from "./index";
import { SUPABASE_PERSISTENCE_DISABLED_MESSAGE } from "./supabase-adapter";
import { SOURCE_OF_TRUTH } from "./schema-contract";
import { DEMO_RESIDUE_NOT_LEDGER, SEED_BOUNDARY } from "./seed-policy";

describe("Phase 5A-1 persistence driver", () => {
  it("defaults to local and never auto-enables supabase", () => {
    expect(getPersistenceDriver({})).toBe("local");
    expect(getPersistenceDriver({ BEAUTY_OS_PERSISTENCE: "supabase" })).toBe(
      "local",
    );
    expect(
      getPersistenceDriver({
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe("supabase");
    expect(isSupabasePersistenceEnabled({})).toBe(false);
    expect(getOperationalPersistence({}).driver).toBe("local");
    expect(getOperationalPersistence({}).appointments).toBe(
      localOperationalPersistence.appointments,
    );
  });

  it("supabase singleton stays disabled even when the driver resolves supabase", () => {
    expect(() =>
      supabaseOperationalPersistence.transactions.list(ORG_ENJOYE_ID),
    ).toThrow(SUPABASE_PERSISTENCE_DISABLED_MESSAGE);
    expect(() =>
      supabaseOperationalPersistence.customers.list({ organizationId: ORG_ENJOYE_ID }),
    ).toThrow(SUPABASE_PERSISTENCE_DISABLED_MESSAGE);
    expect(
      getOperationalPersistence({
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }).driver,
    ).toBe("supabase");
  });
});

describe("Phase 5A-1 local adapter reuses existing stores", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("package remaining is ledger SUM via existing store, not a remaining field", () => {
    expect(localOperationalPersistence.packages.ledgerBalance).toBe(
      getPackageLedgerBalance,
    );
    expect(localOperationalPersistence.packages.listLedger).toBe(listPackageLedger);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, "missing-pkg")).toBe(0);
    expect(listPackageLedger(ORG_LUMIERE_ID)).toEqual([]);
  });

  it("stored value balance is ledger SUM via existing store", () => {
    expect(localOperationalPersistence.storedValue.customerBalance).toBe(
      getCustomerStoredValueBalance,
    );
    expect(localOperationalPersistence.storedValue.listLedger).toBe(
      listStoredValueLedger,
    );
  });

  it("OPEN checkout is not settlement", () => {
    expect(localOperationalPersistence.checkout.listDrafts).toBe(listCheckoutDrafts);
    expect(localOperationalPersistence.transactions.list).toBe(listTransactions);
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    expect(draft.status).toBe("OPEN");
    expect(
      localOperationalPersistence.checkout.listDrafts(ORG_ENJOYE_ID, {
        status: "OPEN",
      }).map((d) => d.id),
    ).toContain(draft.id);
    expect(
      localOperationalPersistence.transactions.list(ORG_ENJOYE_ID, {
        status: "COMPLETED",
      }),
    ).toEqual([]);
    expect(SOURCE_OF_TRUTH.payment).toContain("COMPLETED");
    expect(SOURCE_OF_TRUTH.checkoutIntent).toContain("OPEN is not settlement");
  });

  it("isolates empty org ledgers", () => {
    expect(listPackageLedger(ORG_ENJOYE_ID)).toEqual([]);
    expect(listPackageLedger(ORG_LUMIERE_ID)).toEqual([]);
    expect(listStoredValueLedger(ORG_ENJOYE_ID)).toEqual([]);
    expect(listStoredValueLedger(ORG_LUMIERE_ID)).toEqual([]);
  });
});

describe("Phase 5A-1 source-of-truth via local adapter (existing stores)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("package ledger SUM and customer package snapshot; remaining is not stored", () => {
    const def = createPackageDefinition(ORG_ENJOYE_ID, {
      name: "美胸保養 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 10,
      priceMinor: 18000,
      validityDays: 365,
      createdByStaffId: "staff-001",
    });
    expect(Number.isInteger(def.priceMinor)).toBe(true);

    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-5a1-pkg",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-5a1-pkg:PACKAGE_PURCHASE:i",
    });

    expect("remainingSessions" in customerPackage).toBe(false);
    expect(customerPackage.nameSnapshot).toBe("美胸保養 10 堂");
    expect(customerPackage.sessionCountSnapshot).toBe(10);
    expect(customerPackage.priceSnapshot).toBe(18000);
    expect(customerPackage.includedServiceIdsSnapshot).toEqual(["svc-breast"]);
    expect(customerPackage.purchaseTransactionId).toBe("txn-5a1-pkg");

    const packages = localOperationalPersistence.packages;
    expect(packages.ledgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(10);
    expect(
      packages
        .listLedger(ORG_ENJOYE_ID, { customerPackageId: customerPackage.id })
        .reduce((sum, e) => sum + e.sessionDelta, 0),
    ).toBe(10);
    expect(packages.listCustomerPackages(ORG_LUMIERE_ID)).toEqual([]);
    expect(packages.listLedger(ORG_LUMIERE_ID)).toEqual([]);
  });

  it("stored-value ledger SUM uses integer minor units and unique effect_key", () => {
    const first = postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 3000,
      transactionId: "txn-5a1-sv",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-5a1-sv:STORED_VALUE_TOP_UP:i",
    });
    const retry = postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 3000,
      transactionId: "txn-5a1-sv",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-5a1-sv:STORED_VALUE_TOP_UP:i",
    });
    expect(retry.id).toBe(first.id);
    expect(Number.isInteger(first.amountDelta)).toBe(true);

    postStoredValuePayment(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 500,
      transactionId: "txn-5a1-pay",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-5a1-pay:STORED_VALUE_PAYMENT:p",
    });

    const sv = localOperationalPersistence.storedValue;
    expect(sv.customerBalance(ORG_ENJOYE_ID, "demo-001")).toBe(2500);
    expect(
      sv
        .listLedger(ORG_ENJOYE_ID, { customerId: "demo-001" })
        .reduce((sum, e) => sum + e.amountDelta, 0),
    ).toBe(2500);
    expect(sv.listLedger(ORG_LUMIERE_ID)).toEqual([]);
    expect(sv.customerBalance(ORG_LUMIERE_ID, "lumiere-c-001")).toBe(0);
  });
});

describe("Phase 5A-1 seed boundary", () => {
  it("forbids promoting demo residue into production ledgers", () => {
    expect(DEMO_RESIDUE_NOT_LEDGER.join(" ")).toContain("remainingSessions");
    expect(SEED_BOUNDARY.mustNotBecome).toContain("package_ledger_entries");
    expect(SEED_BOUNDARY.mustNotBecome).toContain("stored_value_ledger_entries");
    expect(SEED_BOUNDARY.mustNotBecome).toContain("transactions");
  });
});
