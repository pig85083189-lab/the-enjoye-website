/**
 * Phase 4.10A — Transaction void + ledger reversal isolation tests.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import {
  createAppointment,
  getScheduleAppointment,
  transitionAppointmentStatus,
} from "@/lib/appointments/store";
import {
  addCheckoutItem,
  completeCheckout,
  createCheckoutFromAppointment,
  createEmptyCheckoutDraft,
  setCheckoutPayments,
  setPackageRedemption,
} from "@/lib/commerce/checkout-store";
import {
  getTransaction,
  hasCompletedTransactionForAppointment,
  listTransactions,
} from "@/lib/commerce/transaction-store";
import { voidTransaction } from "@/lib/commerce/void-transaction";
import {
  createCustomerPackageFromPurchase,
  createPackageDefinition,
  getCustomerPackage,
  getPackageLedgerBalance,
  listPackageLedger,
  redeemPackageSession,
} from "@/lib/packages/store";
import {
  getCustomerStoredValueBalance,
  listStoredValueLedger,
  postStoredValueTopUp,
  reverseStoredValueLedgerEntry,
} from "@/lib/stored-value/store";

function wipe() {
  localStorage.clear();
}

beforeEach(() => wipe());

function makeEligibleAppointment(staffId = "staff-002", locationId = LOC_ENJOYE_PRIMARY_ID) {
  const apt = createAppointment(ORG_ENJOYE_ID, {
    locationId,
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

function seedDefinition(sessionCount = 10) {
  return createPackageDefinition(ORG_ENJOYE_ID, {
    name: "美胸保養套票",
    includedServiceIds: ["svc-breast"],
    sessionCount,
    priceMinor: 18000,
    validityDays: 365,
    createdByStaffId: "staff-001",
  });
}

function cashCheckoutFromAppointment(staffId = "staff-002") {
  const apt = makeEligibleAppointment(staffId);
  const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
    appointmentId: apt.id,
    createdByStaffId: "staff-001",
  });
  setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
    { method: "CASH", amount: draft.total },
  ]);
  const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
  return { apt, draft, tx };
}

describe("voidTransaction eligibility", () => {
  it("voids completed cash transaction and records metadata", () => {
    const { tx } = cashCheckoutFromAppointment();
    const snap = structuredClone(tx);
    const result = voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "結帳付款方式選錯",
    });
    expect(result.alreadyVoided).toBe(false);
    expect(result.transaction.status).toBe("VOIDED");
    expect(result.transaction.voidReason).toBe("結帳付款方式選錯");
    expect(result.transaction.voidedBy).toBe("staff-001");
    expect(result.transaction.voidedAt).toBeTruthy();
    expect(result.transaction.items).toEqual(snap.items);
    expect(result.transaction.discounts).toEqual(snap.discounts);
    expect(result.transaction.payments).toEqual(snap.payments);
    expect(result.transaction.total).toBe(snap.total);
    expect(result.externalTenderActions).toEqual([
      { method: "CASH", amount: snap.total, status: "MANUAL_EXTERNAL_REQUIRED" },
    ]);
  });

  it("rejects empty reason; leaves COMPLETED unchanged", () => {
    const { tx } = cashCheckoutFromAppointment();
    expect(() =>
      voidTransaction(ORG_ENJOYE_ID, tx.id, {
        actorStaffId: "staff-001",
        reason: "   ",
      }),
    ).toThrow(/reason/i);
    expect(getTransaction(ORG_ENJOYE_ID, tx.id)?.status).toBe("COMPLETED");
  });

  it("rejects wrong org and unauthorized actor", () => {
    const { tx } = cashCheckoutFromAppointment();
    expect(() =>
      voidTransaction(ORG_LUMIERE_ID, tx.id, {
        actorStaffId: "staff-lumiere-01",
        reason: "hack",
      }),
    ).toThrow(/not found/i);
    expect(() =>
      voidTransaction(ORG_ENJOYE_ID, tx.id, {
        actorStaffId: "staff-002",
        reason: "操作錯誤",
      }),
    ).toThrow(/Unauthorized/i);
    expect(getTransaction(ORG_ENJOYE_ID, tx.id)?.status).toBe("COMPLETED");
  });

  it("idempotent second void does not reverse twice", () => {
    const { tx } = cashCheckoutFromAppointment();
    voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "重複結帳",
    });
    const again = voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "重複結帳 again",
    });
    expect(again.alreadyVoided).toBe(true);
    expect(again.transaction.status).toBe("VOIDED");
    expect(again.transaction.voidReason).toBe("重複結帳");
  });

  it("resume after partial reverse (TX still COMPLETED) finishes without double reverse", () => {
    const accountTopUp = postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 5000,
      transactionId: "txn-resume-seed",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-resume-seed:STORED_VALUE_TOP_UP:i",
    });
    void accountTopUp;
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "STORED_VALUE", amount: draft.total },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    const payment = listStoredValueLedger(ORG_ENJOYE_ID).find(
      (e) => e.transactionId === tx.id && e.type === "PAYMENT",
    )!;
    // Simulate crash after SV reverse succeeded but before mark VOIDED
    reverseStoredValueLedgerEntry(
      ORG_ENJOYE_ID,
      payment.id,
      "staff-001",
      "partial",
    );
    expect(getTransaction(ORG_ENJOYE_ID, tx.id)?.status).toBe("COMPLETED");

    const result = voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "完成作廢",
    });
    expect(result.transaction.status).toBe("VOIDED");
    expect(
      listStoredValueLedger(ORG_ENJOYE_ID).filter(
        (e) => e.type === "REVERSAL" && e.reversesEntryId === payment.id,
      ),
    ).toHaveLength(1);
  });

  it("same-id tenant isolation for void", () => {
    const shared = "txn-shared-void";
    localStorage.setItem(
      `beauty-os:${ORG_ENJOYE_ID}:transactions:v1`,
      JSON.stringify([
        {
          id: shared,
          organizationId: ORG_ENJOYE_ID,
          locationId: LOC_ENJOYE_PRIMARY_ID,
          customerId: "demo-001",
          transactionNumber: "TX-TEST-0001",
          status: "COMPLETED",
          items: [],
          discounts: [],
          payments: [{ id: "p1", method: "CASH", amount: 100, paidAt: new Date().toISOString() }],
          subtotal: 100,
          discountTotal: 0,
          total: 100,
          currency: "TWD",
          createdByStaffId: "staff-001",
          completedAt: new Date().toISOString(),
        },
      ]),
    );
    expect(() =>
      voidTransaction(ORG_LUMIERE_ID, shared, {
        actorStaffId: "staff-lumiere-01",
        reason: "cross",
      }),
    ).toThrow(/not found/i);
    expect(getTransaction(ORG_ENJOYE_ID, shared)?.status).toBe("COMPLETED");
  });
});

describe("package void reversals", () => {
  it("redemption void restores session; original ledger unchanged; retry safe", () => {
    const def = seedDefinition(10);
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-seed-pkg",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-seed-pkg:PACKAGE_PURCHASE:i",
    });
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
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, []);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(9);
    const redemption = listPackageLedger(ORG_ENJOYE_ID, {
      customerPackageId: customerPackage.id,
    }).find((e) => e.type === "REDEMPTION" && e.transactionId === tx.id)!;
    const redemptionSnap = { ...redemption };

    const result = voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "核銷作廢",
    });
    expect(result.packageReversals).toHaveLength(1);
    expect(result.packageReversals[0]?.reversesEntryId).toBe(redemption.id);
    expect(result.packageReversals[0]?.sessionDelta).toBe(1);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(10);
    const still = listPackageLedger(ORG_ENJOYE_ID).find((e) => e.id === redemption.id)!;
    expect(still.sessionDelta).toBe(redemptionSnap.sessionDelta);
    expect(still.type).toBe("REDEMPTION");

    voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "核銷作廢",
    });
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(10);
    expect(
      listPackageLedger(ORG_ENJOYE_ID, { customerPackageId: customerPackage.id }).filter(
        (e) => e.type === "REVERSAL",
      ),
    ).toHaveLength(1);
  });

  it("unused package purchase can void; used purchase blocked with no writes", () => {
    const def = seedDefinition(10);
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
    const purchaseTx = completeCheckout(ORG_ENJOYE_ID, withItem.id);
    const purchaseEntry = listPackageLedger(ORG_ENJOYE_ID).find(
      (e) => e.transactionId === purchaseTx.id && e.type === "PURCHASE",
    )!;
    expect(purchaseEntry.sessionDelta).toBe(10);

    const ok = voidTransaction(ORG_ENJOYE_ID, purchaseTx.id, {
      actorStaffId: "staff-001",
      reason: "購買作廢",
    });
    expect(ok.transaction.status).toBe("VOIDED");
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, purchaseEntry.customerPackageId)).toBe(0);
    expect(getCustomerPackage(ORG_ENJOYE_ID, purchaseEntry.customerPackageId)?.status).toBe(
      "VOIDED",
    );

    // Used purchase blocked
    wipe();
    const def2 = seedDefinition(10);
    const draft2 = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const with2 = addCheckoutItem(ORG_ENJOYE_ID, draft2.id, {
      type: "PACKAGE_PURCHASE",
      referenceId: def2.id,
      name: def2.name,
      unitPrice: def2.priceMinor,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, with2.id, [
      { method: "CASH", amount: with2.total },
    ]);
    const tx2 = completeCheckout(ORG_ENJOYE_ID, with2.id);
    const pkgId = listPackageLedger(ORG_ENJOYE_ID).find(
      (e) => e.transactionId === tx2.id && e.type === "PURCHASE",
    )!.customerPackageId;
    redeemPackageSession(ORG_ENJOYE_ID, {
      customerPackageId: pkgId,
      customerId: "demo-001",
      serviceId: "svc-breast",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      transactionId: "txn-use-later",
      createdByStaffId: "staff-001",
      effectKey: "txn-use-later:PACKAGE_REDEMPTION:cp",
    });
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, pkgId)).toBe(9);
    const pkgLedgerBefore = listPackageLedger(ORG_ENJOYE_ID).length;
    expect(() =>
      voidTransaction(ORG_ENJOYE_ID, tx2.id, {
        actorStaffId: "staff-001",
        reason: "不該成功",
      }),
    ).toThrow(/已有使用紀錄/);
    expect(getTransaction(ORG_ENJOYE_ID, tx2.id)?.status).toBe("COMPLETED");
    expect(listPackageLedger(ORG_ENJOYE_ID)).toHaveLength(pkgLedgerBefore);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, pkgId)).toBe(9);
  });
});

describe("stored-value void reversals", () => {
  it("payment void restores balance; original payment unchanged; retry safe", () => {
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 10000,
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
    const half = Math.min(draft.total, 2300);
    const rest = draft.total - half;
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "STORED_VALUE", amount: half },
      ...(rest > 0 ? [{ method: "CASH" as const, amount: rest }] : []),
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    const payEntry = listStoredValueLedger(ORG_ENJOYE_ID, {
      customerId: "demo-001",
    }).find((e) => e.type === "PAYMENT" && e.transactionId === tx.id)!;
    const paySnap = { ...payEntry };
    const balAfterPay = getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001");

    const result = voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "儲值付款作廢",
    });
    expect(result.storedValueReversals[0]?.amountDelta).toBe(half);
    expect(result.storedValueReversals[0]?.reversesEntryId).toBe(payEntry.id);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(
      balAfterPay + half,
    );
    const still = listStoredValueLedger(ORG_ENJOYE_ID).find((e) => e.id === payEntry.id)!;
    expect(still.amountDelta).toBe(paySnap.amountDelta);

    voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "儲值付款作廢",
    });
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(
      balAfterPay + half,
    );
  });

  it("unused top-up voids; spent top-up blocked leaves everything unchanged", () => {
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const withItem = addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "STORED_VALUE_TOP_UP",
      name: "儲值",
      unitPrice: 10000,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, withItem.id, [
      { method: "CASH", amount: 10000 },
    ]);
    const topUpTx = completeCheckout(ORG_ENJOYE_ID, withItem.id);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(10000);

    voidTransaction(ORG_ENJOYE_ID, topUpTx.id, {
      actorStaffId: "staff-001",
      reason: "儲值作廢",
    });
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(0);
    expect(getTransaction(ORG_ENJOYE_ID, topUpTx.id)?.status).toBe("VOIDED");

    wipe();
    const draft2 = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const with2 = addCheckoutItem(ORG_ENJOYE_ID, draft2.id, {
      type: "STORED_VALUE_TOP_UP",
      name: "儲值",
      unitPrice: 10000,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, with2.id, [
      { method: "CASH", amount: 10000 },
    ]);
    const tx2 = completeCheckout(ORG_ENJOYE_ID, with2.id);
    const apt = makeEligibleAppointment();
    const payDraft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    setCheckoutPayments(ORG_ENJOYE_ID, payDraft.id, [
      { method: "STORED_VALUE", amount: payDraft.total },
    ]);
    completeCheckout(ORG_ENJOYE_ID, payDraft.id);
    const bal = getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001");
    const svCount = listStoredValueLedger(ORG_ENJOYE_ID).length;
    expect(() =>
      voidTransaction(ORG_ENJOYE_ID, tx2.id, {
        actorStaffId: "staff-001",
        reason: "不該成功",
      }),
    ).toThrow(/已有消費紀錄/);
    expect(getTransaction(ORG_ENJOYE_ID, tx2.id)?.status).toBe("COMPLETED");
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(bal);
    expect(listStoredValueLedger(ORG_ENJOYE_ID)).toHaveLength(svCount);
  });
});

describe("mixed tender and location", () => {
  it("mixed SV + cash voids only SV ledger and flags cash external", () => {
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 5000,
      transactionId: "txn-mix-seed",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-mix-seed:STORED_VALUE_TOP_UP:i",
    });
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    const sv = Math.min(2000, draft.total - 1);
    const cash = draft.total - sv;
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "STORED_VALUE", amount: sv },
      { method: "CASH", amount: cash },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    const balBefore = getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001");
    const result = voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "混合付款作廢",
    });
    expect(result.storedValueReversals).toHaveLength(1);
    expect(result.storedValueReversals[0]?.amountDelta).toBe(sv);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(balBefore + sv);
    expect(result.externalTenderActions).toEqual([
      { method: "CASH", amount: cash, status: "MANUAL_EXTERNAL_REQUIRED" },
    ]);
  });

  it("card/transfer/other marked manual external action", () => {
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    const a = Math.floor(draft.total / 3);
    const b = Math.floor(draft.total / 3);
    const c = draft.total - a - b;
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "CARD", amount: a },
      { method: "TRANSFER", amount: b },
      { method: "OTHER", amount: c },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    const result = voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "外部付款作廢",
    });
    expect(result.externalTenderActions.map((x) => x.method).sort()).toEqual(
      ["CARD", "OTHER", "TRANSFER"].sort(),
    );
    expect(result.externalTenderActions.every((x) => x.status === "MANUAL_EXTERNAL_REQUIRED")).toBe(
      true,
    );
  });

  it("reversal uses original transaction location even if voided from another location context", () => {
    const apt = makeEligibleAppointment("staff-002", LOC_ENJOYE_PRIMARY_ID);
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    expect(draft.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "CASH", amount: draft.total },
    ]);
    // Force a package redemption path with location on ledger via SV? Use SV payment for location check
    wipe();
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 20000,
      transactionId: "txn-loc-seed",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-loc-seed:STORED_VALUE_TOP_UP:i",
    });
    const apt2 = makeEligibleAppointment("staff-002", LOC_ENJOYE_PRIMARY_ID);
    const draft2 = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt2.id,
      createdByStaffId: "staff-001",
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft2.id, [
      { method: "STORED_VALUE", amount: draft2.total },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft2.id);
    expect(tx.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    void LOC_ENJOYE_SECONDARY_ID; // actor "at" secondary — void still attributes original location
    const result = voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "分店切換後作廢",
    });
    expect(result.storedValueReversals[0]?.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
  });
});

describe("re-checkout after void", () => {
  it("COMPLETED blocks duplicate; VOIDED allows new TX; history keeps both", () => {
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "CASH", amount: draft.total },
    ]);
    const tx1 = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(hasCompletedTransactionForAppointment(ORG_ENJOYE_ID, apt.id)).toBe(true);
    expect(() =>
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/already/);

    voidTransaction(ORG_ENJOYE_ID, tx1.id, {
      actorStaffId: "staff-001",
      reason: "重結",
    });
    expect(hasCompletedTransactionForAppointment(ORG_ENJOYE_ID, apt.id)).toBe(false);
    expect(getScheduleAppointment(ORG_ENJOYE_ID, apt.id)?.status).toBe("IN_SERVICE");

    const draft2 = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft2.id, [
      { method: "CARD", amount: draft2.total },
    ]);
    const tx2 = completeCheckout(ORG_ENJOYE_ID, draft2.id);
    expect(tx2.id).not.toBe(tx1.id);
    expect(tx2.transactionNumber).not.toBe(tx1.transactionNumber);
    expect(getTransaction(ORG_ENJOYE_ID, tx1.id)?.status).toBe("VOIDED");
    expect(getTransaction(ORG_ENJOYE_ID, tx2.id)?.status).toBe("COMPLETED");
    const history = listTransactions(ORG_ENJOYE_ID, { customerId: "demo-001" });
    expect(history.some((t) => t.id === tx1.id && t.status === "VOIDED")).toBe(true);
    expect(history.some((t) => t.id === tx2.id && t.status === "COMPLETED")).toBe(true);
  });
});
