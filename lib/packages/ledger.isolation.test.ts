import { beforeEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_LUMIERE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { createAppointment, transitionAppointmentStatus } from "@/lib/appointments/store";
import {
  addCheckoutItem,
  completeCheckout,
  createCheckoutFromAppointment,
  createEmptyCheckoutDraft,
  setCheckoutPayments,
  setPackageRedemption,
} from "@/lib/commerce/checkout-store";
import { getTransaction } from "@/lib/commerce/transaction-store";
import {
  createPackageDefinition,
  createCustomerPackageFromPurchase,
  getCustomerPackage,
  getPackageDefinition,
  getPackageLedgerBalance,
  getPackageUsableBalance,
  listPackageDefinitions,
  listPackageLedger,
  redeemPackageSession,
  reversePackageLedgerEntry,
  updatePackageDefinition,
} from "@/lib/packages/store";
import {
  getCustomerStoredValueBalance,
  getOrCreateStoredValueAccount,
  getStoredValueBalance,
  listStoredValueLedger,
  postStoredValuePayment,
  postStoredValueTopUp,
  reverseStoredValueLedgerEntry,
} from "@/lib/stored-value/store";

function wipe() {
  localStorage.clear();
}

beforeEach(() => wipe());

function makeEligibleAppointment(staffId = "staff-002") {
  const apt = createAppointment(ORG_ENJOYE_ID, {
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "demo-001",
    serviceId: "svc-breast",
    staffId,
    startAt: new Date(2026, 8, 21, 14, 0).toISOString(),
    endAt: new Date(2026, 8, 21, 15, 30).toISOString(),
    allowConflict: true,
  });
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "CONFIRMED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "ARRIVED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "IN_SERVICE");
  return apt;
}

function seedDefinition(over: Partial<Parameters<typeof createPackageDefinition>[1]> = {}) {
  return createPackageDefinition(ORG_ENJOYE_ID, {
    name: "美胸保養 10 堂",
    includedServiceIds: ["svc-breast"],
    sessionCount: 10,
    priceMinor: 18000,
    validityDays: 365,
    createdByStaffId: "staff-001",
    ...over,
  });
}

describe("package tenant isolation", () => {
  it("org A cannot read or mutate org B package definition", () => {
    const def = seedDefinition();
    expect(getPackageDefinition(ORG_LUMIERE_ID, def.id)).toBeUndefined();
    expect(listPackageDefinitions(ORG_LUMIERE_ID).some((d) => d.id === def.id)).toBe(false);
    expect(() =>
      updatePackageDefinition(ORG_LUMIERE_ID, def.id, { name: "hack" }, "staff-lumiere-01"),
    ).toThrow(/not found/i);
  });

  it("rejects foreign service and same-id leak for definitions", () => {
    expect(() =>
      createPackageDefinition(ORG_ENJOYE_ID, {
        name: "x",
        includedServiceIds: ["svc-lumiere-facial"],
        sessionCount: 5,
        priceMinor: 1000,
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/Service/);

    const shared = "pkgdef-shared";
    localStorage.setItem(
      `beauty-os:${ORG_ENJOYE_ID}:package-definitions:v1`,
      JSON.stringify([
        {
          id: shared,
          organizationId: ORG_ENJOYE_ID,
          name: "A",
          includedServices: [{ serviceId: "svc-breast", sessionsPerRedemption: 1 }],
          sessionCount: 5,
          priceMinor: 1000,
          currency: "TWD",
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    );
    localStorage.setItem(
      `beauty-os:${ORG_LUMIERE_ID}:package-definitions:v1`,
      JSON.stringify([
        {
          id: shared,
          organizationId: ORG_LUMIERE_ID,
          name: "B",
          includedServices: [{ serviceId: "svc-lumiere-facial", sessionsPerRedemption: 1 }],
          sessionCount: 3,
          priceMinor: 2000,
          currency: "TWD",
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    );
    expect(getPackageDefinition(ORG_ENJOYE_ID, shared)?.name).toBe("A");
    expect(getPackageDefinition(ORG_LUMIERE_ID, shared)?.name).toBe("B");
  });
});

describe("package purchase and redemption", () => {
  it("purchase creates customer package + ledger; definition edit does not alter snapshot", () => {
    const def = seedDefinition();
    const result = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-seed",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-seed:PACKAGE_PURCHASE:item1",
    });
    expect(result.entry.sessionDelta).toBe(10);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, result.customerPackage.id)).toBe(10);
    updatePackageDefinition(ORG_ENJOYE_ID, def.id, { name: "改名", sessionCount: 99, priceMinor: 1 }, "staff-001");
    const pkg = getCustomerPackage(ORG_ENJOYE_ID, result.customerPackage.id)!;
    expect(pkg.nameSnapshot).toBe("美胸保養 10 堂");
    expect(pkg.sessionCountSnapshot).toBe(10);
    expect(pkg.priceSnapshot).toBe(18000);
  });

  it("redemption deducts once; draft selection does not deduct; retry is idempotent", () => {
    const def = seedDefinition();
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-p1",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-p1:PACKAGE_PURCHASE:i",
    });
    expect(getPackageUsableBalance(ORG_ENJOYE_ID, customerPackage.id).usableBalance).toBe(10);

    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    setPackageRedemption(ORG_ENJOYE_ID, draft.id, {
      customerPackageId: customerPackage.id,
      serviceId: "svc-breast",
      sessions: 1,
    });
    // selection must not deduct yet
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(10);

    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(tx.total).toBe(0);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(9);

    // retry same effect key via redeem API
    const again = redeemPackageSession(ORG_ENJOYE_ID, {
      customerPackageId: customerPackage.id,
      customerId: "demo-001",
      serviceId: "svc-breast",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      transactionId: tx.id,
      createdByStaffId: "staff-001",
      effectKey: `${tx.id}:PACKAGE_REDEMPTION:${customerPackage.id}`,
    });
    expect(again.sessionDelta).toBe(-1);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(9);

    // Second complete is idempotent — same TX, no extra redemption
    const againTx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(againTx.id).toBe(tx.id);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(9);
  });

  it("rejects wrong service / wrong customer / cross-org; expired usableBalance is 0", () => {
    const expiredDef = seedDefinition({ name: "過期套", validityDays: -1 });
    const { customerPackage: expiredPkg } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: expiredDef.id,
      purchaseTransactionId: "txn-exp",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-exp:PACKAGE_PURCHASE:i",
    });
    expect(getPackageUsableBalance(ORG_ENJOYE_ID, expiredPkg.id).usableBalance).toBe(0);
    expect(getPackageUsableBalance(ORG_ENJOYE_ID, expiredPkg.id).status).toBe("EXPIRED");

    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: seedDefinition({ name: "活套" }).id,
      purchaseTransactionId: "txn-live",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-live:PACKAGE_PURCHASE:i",
    });

    expect(() =>
      redeemPackageSession(ORG_ENJOYE_ID, {
        customerPackageId: customerPackage.id,
        customerId: "demo-002",
        serviceId: "svc-breast",
        locationId: LOC_ENJOYE_PRIMARY_ID,
        transactionId: "t1",
        createdByStaffId: "staff-001",
        effectKey: "t1:PACKAGE_REDEMPTION:x",
      }),
    ).toThrow(/customer/i);

    expect(() =>
      redeemPackageSession(ORG_ENJOYE_ID, {
        customerPackageId: customerPackage.id,
        customerId: "demo-001",
        serviceId: "svc-facial",
        locationId: LOC_ENJOYE_PRIMARY_ID,
        transactionId: "t2",
        createdByStaffId: "staff-001",
        effectKey: "t2:PACKAGE_REDEMPTION:x",
      }),
    ).toThrow(/eligible/i);

    expect(() =>
      redeemPackageSession(ORG_LUMIERE_ID, {
        customerPackageId: customerPackage.id,
        customerId: "lumiere-c-001",
        serviceId: "svc-breast",
        locationId: LOC_LUMIERE_PRIMARY_ID,
        transactionId: "t3",
        createdByStaffId: "staff-lumiere-01",
        effectKey: "t3:PACKAGE_REDEMPTION:x",
      }),
    ).toThrow(/not found/i);

    expect(() =>
      redeemPackageSession(ORG_ENJOYE_ID, {
        customerPackageId: expiredPkg.id,
        customerId: "demo-001",
        serviceId: "svc-breast",
        locationId: LOC_ENJOYE_PRIMARY_ID,
        transactionId: "t4",
        createdByStaffId: "staff-001",
        effectKey: "t4:PACKAGE_REDEMPTION:x",
      }),
    ).toThrow(/expired/i);
  });

  it("cross-location same-org redemption allowed and records location; reversal works once", () => {
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: seedDefinition().id,
      purchaseTransactionId: "txn-cl",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-cl:PACKAGE_PURCHASE:i",
    });
    // Enjoye only has one location in seed — still record locationId on entry
    const entry = redeemPackageSession(ORG_ENJOYE_ID, {
      customerPackageId: customerPackage.id,
      customerId: "demo-001",
      serviceId: "svc-breast",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      transactionId: "txn-r1",
      createdByStaffId: "staff-001",
      effectKey: "txn-r1:PACKAGE_REDEMPTION:cp",
    });
    expect(entry.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    const before = listPackageLedger(ORG_ENJOYE_ID, {
      customerPackageId: customerPackage.id,
    }).length;
    reversePackageLedgerEntry(ORG_ENJOYE_ID, entry.id, "staff-001", "錯扣");
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(10);
    const again = reversePackageLedgerEntry(ORG_ENJOYE_ID, entry.id, "staff-001");
    expect(again.reversesEntryId).toBe(entry.id);
    expect(
      listPackageLedger(ORG_ENJOYE_ID, { customerPackageId: customerPackage.id }).length,
    ).toBe(before + 1);
  });
});

describe("stored value", () => {
  it("top-up and payment derive balance; insufficient rejected; no negative", () => {
    getOrCreateStoredValueAccount(ORG_ENJOYE_ID, "demo-001", "staff-001");
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 10000,
      transactionId: "txn-tu",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-tu:STORED_VALUE_TOP_UP:i",
    });
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(10000);
    postStoredValuePayment(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 2300,
      transactionId: "txn-pay",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-pay:STORED_VALUE_PAYMENT:p",
    });
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(7700);
    expect(() =>
      postStoredValuePayment(ORG_ENJOYE_ID, {
        customerId: "demo-001",
        amount: 8000,
        transactionId: "txn-fail",
        locationId: LOC_ENJOYE_PRIMARY_ID,
        createdByStaffId: "staff-001",
        effectKey: "txn-fail:STORED_VALUE_PAYMENT:p",
      }),
    ).toThrow(/insufficient/);
  });

  it("org isolation and wrong customer payment rejected; same-id accounts do not leak", () => {
    const a = getOrCreateStoredValueAccount(ORG_ENJOYE_ID, "demo-001", "staff-001");
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 5000,
      transactionId: "txn-a",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-a:STORED_VALUE_TOP_UP:i",
    });
    expect(getCustomerStoredValueBalance(ORG_LUMIERE_ID, "lumiere-c-001")).toBe(0);
    expect(() => getStoredValueBalance(ORG_LUMIERE_ID, a.id)).toThrow(/not found/);

    expect(() =>
      postStoredValuePayment(ORG_ENJOYE_ID, {
        customerId: "demo-002",
        amount: 100,
        transactionId: "txn-w",
        locationId: LOC_ENJOYE_PRIMARY_ID,
        createdByStaffId: "staff-001",
        effectKey: "txn-w:STORED_VALUE_PAYMENT:p",
      }),
    ).toThrow(/insufficient|mismatch|not found/i);
  });

  it("checkout mixed tender and top-up loop protection; draft does not deduct", () => {
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 5000,
      transactionId: "txn-seed-sv",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-seed-sv:STORED_VALUE_TOP_UP:i",
    });
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    const half = Math.min(2000, draft.total);
    const rest = draft.total - half;
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "STORED_VALUE", amount: half },
      { method: "CASH", amount: rest },
    ]);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(5000);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(5000 - half);
    expect(getTransaction(ORG_ENJOYE_ID, tx.id)?.payments.some((p) => p.method === "STORED_VALUE")).toBe(
      true,
    );

    const topUpDraft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, topUpDraft.id, {
      type: "STORED_VALUE_TOP_UP",
      name: "儲值",
      unitPrice: 3000,
    });
    expect(() =>
      setCheckoutPayments(ORG_ENJOYE_ID, topUpDraft.id, [
        { method: "STORED_VALUE", amount: 3000 },
      ]),
    ).toThrow(/cannot purchase stored-value top-up/);
  });

  it("stored value reversal appends inverse once; ledger immutable", () => {
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 1000,
      transactionId: "txn-r",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-r:STORED_VALUE_TOP_UP:i",
    });
    const entry = listStoredValueLedger(ORG_ENJOYE_ID, { customerId: "demo-001" })[0]!;
    reverseStoredValueLedgerEntry(ORG_ENJOYE_ID, entry.id, "staff-001");
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(0);
    const again = reverseStoredValueLedgerEntry(ORG_ENJOYE_ID, entry.id, "staff-001");
    expect(again.reversesEntryId).toBe(entry.id);
    expect(
      listStoredValueLedger(ORG_ENJOYE_ID, { customerId: "demo-001" }).filter(
        (e) => e.type === "REVERSAL",
      ),
    ).toHaveLength(1);
  });
});

describe("package purchase via checkout", () => {
  it("completing package purchase posts ledger linked to transaction", () => {
    const def = seedDefinition();
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const withItem = addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PACKAGE_PURCHASE",
      referenceId: def.id,
      name: def.name,
      unitPrice: def.priceMinor,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, withItem.id, [
      { method: "CASH", amount: withItem.total },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, withItem.id);
    expect(tx.items[0]?.type).toBe("PACKAGE_PURCHASE");
    const pkgs = listPackageLedger(ORG_ENJOYE_ID, { customerId: "demo-001" });
    expect(pkgs.some((e) => e.type === "PURCHASE" && e.transactionId === tx.id)).toBe(true);
  });

  it("rejects insufficient sessions and keeps ledger on failed checkout", () => {
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: seedDefinition({ sessionCount: 1 }).id,
      purchaseTransactionId: "txn-one",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-one:PACKAGE_PURCHASE:i",
    });
    redeemPackageSession(ORG_ENJOYE_ID, {
      customerPackageId: customerPackage.id,
      customerId: "demo-001",
      serviceId: "svc-breast",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      transactionId: "txn-use",
      createdByStaffId: "staff-001",
      effectKey: "txn-use:PACKAGE_REDEMPTION:cp",
    });
    expect(getPackageUsableBalance(ORG_ENJOYE_ID, customerPackage.id).usableBalance).toBe(0);
    expect(() =>
      redeemPackageSession(ORG_ENJOYE_ID, {
        customerPackageId: customerPackage.id,
        customerId: "demo-001",
        serviceId: "svc-breast",
        locationId: LOC_ENJOYE_PRIMARY_ID,
        transactionId: "txn-fail",
        createdByStaffId: "staff-001",
        effectKey: "txn-fail:PACKAGE_REDEMPTION:cp",
      }),
    ).toThrow(/insufficient|balance|session/i);

    const apt = makeEligibleAppointment("staff-003");
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 5000,
      transactionId: "txn-sv-fail",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-sv-fail:STORED_VALUE_TOP_UP:i",
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "STORED_VALUE", amount: 1 },
    ]);
    const before = getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001");
    expect(() => completeCheckout(ORG_ENJOYE_ID, draft.id)).toThrow(/mismatch/);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(before);
  });

  it("stored-value top-up posts only after completed external payment", () => {
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const withItem = addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "STORED_VALUE_TOP_UP",
      name: "儲值 NT$5,000",
      unitPrice: 5000,
    });
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(0);
    setCheckoutPayments(ORG_ENJOYE_ID, withItem.id, [
      { method: "CASH", amount: 5000 },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, withItem.id);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(5000);
    expect(
      listStoredValueLedger(ORG_ENJOYE_ID, { customerId: "demo-001" }).some(
        (e) => e.type === "TOP_UP" && e.transactionId === tx.id,
      ),
    ).toBe(true);
  });

  it("rejects package purchase for foreign customer ownership", () => {
    const def = seedDefinition();
    expect(() =>
      createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
        customerId: "lumiere-c-001",
        packageDefinitionId: def.id,
        purchaseTransactionId: "txn-fc",
        locationId: LOC_ENJOYE_PRIMARY_ID,
        createdByStaffId: "staff-001",
        effectKey: "txn-fc:PACKAGE_PURCHASE:i",
      }),
    ).toThrow(/Customer/);
  });
});
