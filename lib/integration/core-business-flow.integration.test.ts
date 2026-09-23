/**
 * Phase 4.9C — Core business flow integration tests.
 * Domain interaction (Customer → Appointment → Treatment → Checkout → Ledger).
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  LOC_LUMIERE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { newId } from "@/lib/repositories/storage";
import type { Customer } from "@/types";
import {
  createAppointment,
  getScheduleAppointment,
  listAppointments,
  listTodayAppointments,
  transitionAppointmentStatus,
} from "@/lib/appointments/store";
import {
  addCheckoutItem,
  completeCheckout,
  createCheckoutFromAppointment,
  createEmptyCheckoutDraft,
  getCheckoutDraft,
  listCheckoutDrafts,
  setCheckoutPayments,
  setPackageRedemption,
} from "@/lib/commerce/checkout-store";
import {
  getCompletedTransactionForAppointment,
  getTransaction,
  listTransactions,
} from "@/lib/commerce/transaction-store";
import { getServiceById } from "@/data/mock-services";
import { getServicePriceMinor } from "@/lib/commerce/pricing";
import {
  createPackageDefinition,
  getPackageLedgerBalance,
  getPackageUsableBalance,
  listPackageLedger,
} from "@/lib/packages/store";
import {
  getCustomerStoredValueBalance,
  listStoredValueLedger,
} from "@/lib/stored-value/store";
import {
  createEmptyDraft,
  loadDraft,
  saveDraft,
  saveCompletedTreatment,
} from "@/lib/treatment-draft";

function wipe() {
  localStorage.clear();
}

beforeEach(() => wipe());

function createWangCustomer(): Customer {
  const now = new Date().toISOString();
  return localCustomerRepository.upsert({
    id: newId("cust"),
    organizationId: ORG_ENJOYE_ID,
    name: "王小美",
    phone: "0912-000-888",
    birthday: "1990/01/01",
    age: 36,
    membership: "new",
    lastVisit: "",
    totalVisits: 0,
    packages: [],
    lastServiceNotes: [],
    trackingFocus: [],
    alerts: [],
    tags: [],
    joinedAt: now.slice(0, 10).replace(/-/g, "/"),
    createdAt: now,
    updatedAt: now,
  });
}

function bookBreast(
  customerId: string,
  opts?: { locationId?: string; staffId?: string; dayOffset?: number },
) {
  const locationId = opts?.locationId ?? LOC_ENJOYE_PRIMARY_ID;
  const staffId = opts?.staffId ?? "staff-001";
  const day = opts?.dayOffset ?? 0;
  const start = new Date(2026, 8, 22 + day, 10, 0);
  const end = new Date(2026, 8, 22 + day, 11, 30);
  return createAppointment(ORG_ENJOYE_ID, {
    locationId,
    customerId,
    serviceId: "svc-breast",
    staffId,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allowConflict: true,
  });
}

function toInService(appointmentId: string) {
  transitionAppointmentStatus(ORG_ENJOYE_ID, appointmentId, "CONFIRMED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, appointmentId, "ARRIVED");
  return transitionAppointmentStatus(ORG_ENJOYE_ID, appointmentId, "IN_SERVICE");
}

function completeTreatmentFor(apt: {
  id: string;
  customerId: string;
  locationId: string;
  staffId: string;
  serviceId: string;
  organizationId: string;
}) {
  const draft = createEmptyDraft({
    organizationId: apt.organizationId,
    locationId: apt.locationId,
    appointmentId: apt.id,
    customerId: apt.customerId,
    staffId: apt.staffId,
    serviceId: apt.serviceId,
  });
  saveDraft(draft);
  saveCompletedTreatment(draft);
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "COMPLETED");
  return draft;
}

describe("FLOW 1 — customer → appointment identity", () => {
  it("creates org/location-owned appointment visible to calendar and customer history", () => {
    const customer = createWangCustomer();
    expect(customer.organizationId).toBe(ORG_ENJOYE_ID);

    const apt = bookBreast(customer.id);
    expect(apt.organizationId).toBe(ORG_ENJOYE_ID);
    expect(apt.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    expect(apt.customerId).toBe(customer.id);
    expect(apt.serviceId).toBe("svc-breast");
    expect(apt.staffId).toBe("staff-001");

    const service = getServiceById("svc-breast", ORG_ENJOYE_ID);
    expect(service?.organizationId).toBe(ORG_ENJOYE_ID);

    const byId = getScheduleAppointment(ORG_ENJOYE_ID, apt.id);
    expect(byId?.id).toBe(apt.id);

    const calendar = listAppointments({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
    });
    expect(calendar.some((a) => a.id === apt.id)).toBe(true);

    const day = new Date(apt.startAt);
    const today = listTodayAppointments(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, day);
    expect(today.some((a) => a.id === apt.id)).toBe(true);

    const history = listAppointments({
      organizationId: ORG_ENJOYE_ID,
      customerId: customer.id,
    });
    expect(history.some((a) => a.id === apt.id)).toBe(true);

    expect(getScheduleAppointment(ORG_LUMIERE_ID, apt.id)).toBeUndefined();
  });
});

describe("FLOW 2–3 — arrival → treatment → checkout draft", () => {
  it("treatment and checkout draft inherit appointment ownership and location", () => {
    const customer = createWangCustomer();
    const apt = bookBreast(customer.id);
    const inService = toInService(apt.id);
    expect(inService.status).toBe("IN_SERVICE");

    const treatment = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      locationId: apt.locationId,
      appointmentId: apt.id,
      customerId: customer.id,
      staffId: apt.staffId,
      serviceId: apt.serviceId,
    });
    saveDraft(treatment);
    const loaded = loadDraft(ORG_ENJOYE_ID, apt.id);
    expect(loaded?.appointmentId).toBe(apt.id);
    expect(loaded?.customerId).toBe(customer.id);
    expect(loaded?.organizationId).toBe(ORG_ENJOYE_ID);
    expect(loaded?.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);

    expect(loadDraft(ORG_LUMIERE_ID, apt.id)).toBeNull();

    saveCompletedTreatment(treatment);
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "COMPLETED");

    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
      treatmentId: treatment.id,
    });
    expect(draft.organizationId).toBe(ORG_ENJOYE_ID);
    expect(draft.locationId).toBe(apt.locationId);
    expect(draft.locationId).not.toBe(LOC_ENJOYE_SECONDARY_ID);
    expect(draft.customerId).toBe(customer.id);
    expect(draft.appointmentId).toBe(apt.id);
    expect(draft.treatmentId).toBe(treatment.id);
  });
});

describe("FLOW 4 — cash checkout + idempotency", () => {
  it("settles cash once and rejects duplicate financial side effects", () => {
    const customer = createWangCustomer();
    const apt = bookBreast(customer.id);
    toInService(apt.id);
    const treatment = completeTreatmentFor({ ...apt, organizationId: ORG_ENJOYE_ID });

    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
      treatmentId: treatment.id,
    });
    const price = getServicePriceMinor(getServiceById("svc-breast", ORG_ENJOYE_ID)!);
    expect(draft.total).toBe(price);
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [{ method: "CASH", amount: price }]);

    const tx1 = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(tx1.total).toBe(price);
    expect(tx1.payments).toEqual([
      expect.objectContaining({ method: "CASH", amount: price }),
    ]);
    expect(tx1.appointmentId).toBe(apt.id);
    expect(tx1.treatmentId).toBe(treatment.id);
    expect(tx1.customerId).toBe(customer.id);
    expect(tx1.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);

    const countBefore = listTransactions(ORG_ENJOYE_ID).length;
    const tx2 = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(tx2.id).toBe(tx1.id);
    expect(listTransactions(ORG_ENJOYE_ID)).toHaveLength(countBefore);
    expect(getCompletedTransactionForAppointment(ORG_ENJOYE_ID, apt.id)?.id).toBe(tx1.id);
  });
});

describe("FLOW 5–7 — package purchase, redemption, cross-location", () => {
  it("purchase → redeem zero-total → cross-location redeem with idempotent retry", () => {
    const customer = createWangCustomer();
    const def = createPackageDefinition(ORG_ENJOYE_ID, {
      name: "美胸保養 10 堂",
      includedServiceIds: ["svc-breast"],
      sessionCount: 10,
      priceMinor: 18000,
      validityDays: 365,
      createdByStaffId: "staff-001",
    });

    // FLOW 5 purchase at Location A
    const buy = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: customer.id,
      createdByStaffId: "staff-001",
    });
    const withPkg = addCheckoutItem(ORG_ENJOYE_ID, buy.id, {
      type: "PACKAGE_PURCHASE",
      referenceId: def.id,
      name: def.name,
      unitPrice: 18000,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, withPkg.id, [
      { method: "CARD", amount: 18000 },
    ]);
    const buyTx = completeCheckout(ORG_ENJOYE_ID, withPkg.id);
    expect(buyTx.items[0]?.sessionCountSnapshot).toBe(10);

    const purchaseEntry = listPackageLedger(ORG_ENJOYE_ID, {
      customerId: customer.id,
    }).find((e) => e.type === "PURCHASE");
    expect(purchaseEntry?.sessionDelta).toBe(10);
    expect(purchaseEntry?.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    const customerPackageId = purchaseEntry!.customerPackageId;
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackageId)).toBe(10);

    // Definition rename must not rewrite snapshot
    // (definition update covered in unit tests; assert purchase snapshot retained)
    expect(buyTx.items[0]?.nameSnapshot).toBe("美胸保養 10 堂");

    // FLOW 6 redemption at Location A — selection does not deduct
    const apt1 = bookBreast(customer.id, { dayOffset: 1 });
    toInService(apt1.id);
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt1.id, "COMPLETED");
    const draft1 = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt1.id,
      createdByStaffId: "staff-001",
    });
    setPackageRedemption(ORG_ENJOYE_ID, draft1.id, {
      customerPackageId,
      serviceId: "svc-breast",
      sessions: 1,
    });
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackageId)).toBe(10);
    const openDraft = getCheckoutDraft(ORG_ENJOYE_ID, draft1.id)!;
    expect(openDraft.total).toBe(0);

    const redeemTx = completeCheckout(ORG_ENJOYE_ID, draft1.id);
    expect(redeemTx.total).toBe(0);
    expect(redeemTx.payments).toHaveLength(0);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackageId)).toBe(9);

    const pkgCount = listPackageLedger(ORG_ENJOYE_ID, {
      customerPackageId,
    }).length;
    completeCheckout(ORG_ENJOYE_ID, draft1.id);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackageId)).toBe(9);
    expect(
      listPackageLedger(ORG_ENJOYE_ID, { customerPackageId }).length,
    ).toBe(pkgCount);

    // FLOW 7 cross-location B
    const apt2 = bookBreast(customer.id, {
      locationId: LOC_ENJOYE_SECONDARY_ID,
      dayOffset: 2,
    });
    toInService(apt2.id);
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt2.id, "COMPLETED");
    const draft2 = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt2.id,
      createdByStaffId: "staff-001",
    });
    expect(draft2.locationId).toBe(LOC_ENJOYE_SECONDARY_ID);
    setPackageRedemption(ORG_ENJOYE_ID, draft2.id, {
      customerPackageId,
      serviceId: "svc-breast",
      sessions: 1,
    });
    completeCheckout(ORG_ENJOYE_ID, draft2.id);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackageId)).toBe(8);
    const redB = listPackageLedger(ORG_ENJOYE_ID, { customerPackageId }).find(
      (e) => e.type === "REDEMPTION" && e.transactionId,
    );
    const redemptions = listPackageLedger(ORG_ENJOYE_ID, {
      customerPackageId,
    }).filter((e) => e.type === "REDEMPTION");
    expect(redemptions.some((e) => e.locationId === LOC_ENJOYE_SECONDARY_ID)).toBe(true);
    expect(purchaseEntry?.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    void redB;
  });
});

describe("FLOW 8–10 — stored value top-up, payment, mixed tender", () => {
  it("top-up then pay then mixed tender with retry-safe settle", () => {
    const customer = createWangCustomer();

    // FLOW 8 top-up
    const top = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: customer.id,
      createdByStaffId: "staff-001",
    });
    const withTop = addCheckoutItem(ORG_ENJOYE_ID, top.id, {
      type: "STORED_VALUE_TOP_UP",
      name: "儲值 NT$10,000",
      unitPrice: 10000,
    });
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, customer.id)).toBe(0);
    setCheckoutPayments(ORG_ENJOYE_ID, withTop.id, [
      { method: "CARD", amount: 10000 },
    ]);
    const topTx = completeCheckout(ORG_ENJOYE_ID, withTop.id);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, customer.id)).toBe(10000);
    const svCount = listStoredValueLedger(ORG_ENJOYE_ID, {
      customerId: customer.id,
    }).length;
    completeCheckout(ORG_ENJOYE_ID, withTop.id);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, customer.id)).toBe(10000);
    expect(
      listStoredValueLedger(ORG_ENJOYE_ID, { customerId: customer.id }).length,
    ).toBe(svCount);
    expect(
      listStoredValueLedger(ORG_ENJOYE_ID, { customerId: customer.id }).some(
        (e) => e.type === "TOP_UP" && e.transactionId === topTx.id,
      ),
    ).toBe(true);

    // FLOW 9 SV payment 2300
    const aptPay = bookBreast(customer.id, { dayOffset: 3, staffId: "staff-002" });
    toInService(aptPay.id);
    transitionAppointmentStatus(ORG_ENJOYE_ID, aptPay.id, "COMPLETED");
    const payDraft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: aptPay.id,
      createdByStaffId: "staff-001",
    });
    const serviceTotal = payDraft.total;
    setCheckoutPayments(ORG_ENJOYE_ID, payDraft.id, [
      { method: "STORED_VALUE", amount: serviceTotal },
    ]);
    const payTx = completeCheckout(ORG_ENJOYE_ID, payDraft.id);
    expect(payTx.payments[0]?.method).toBe("STORED_VALUE");
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, customer.id)).toBe(
      10000 - serviceTotal,
    );

    // FLOW 10 mixed tender — use remaining SV + cash
    const aptMix = bookBreast(customer.id, { dayOffset: 4, staffId: "staff-003" });
    toInService(aptMix.id);
    transitionAppointmentStatus(ORG_ENJOYE_ID, aptMix.id, "COMPLETED");
    const mixDraft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: aptMix.id,
      createdByStaffId: "staff-001",
    });
    // Force total 3000 via custom line if service price differs
    const target = 3000;
    // Clear and use CUSTOM for deterministic 3000 demo when service ≠ 3000
    const empty = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: customer.id,
      createdByStaffId: "staff-001",
    });
    const custom = addCheckoutItem(ORG_ENJOYE_ID, empty.id, {
      type: "CUSTOM",
      name: "加購項目",
      unitPrice: target,
    });
    const beforeMix = getCustomerStoredValueBalance(ORG_ENJOYE_ID, customer.id);
    setCheckoutPayments(ORG_ENJOYE_ID, custom.id, [
      { method: "STORED_VALUE", amount: 2000 },
      { method: "CASH", amount: 1000 },
    ]);
    const mixTx = completeCheckout(ORG_ENJOYE_ID, custom.id);
    expect(mixTx.total).toBe(3000);
    expect(mixTx.payments.reduce((s, p) => s + p.amount, 0)).toBe(3000);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, customer.id)).toBe(
      beforeMix - 2000,
    );
    const ledgersAfter = listStoredValueLedger(ORG_ENJOYE_ID, {
      customerId: customer.id,
    }).length;
    completeCheckout(ORG_ENJOYE_ID, custom.id);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, customer.id)).toBe(
      beforeMix - 2000,
    );
    expect(
      listStoredValueLedger(ORG_ENJOYE_ID, { customerId: customer.id }).length,
    ).toBe(ledgersAfter);

    void mixDraft;
    void aptMix;
  });
});

describe("cross-location stored value + failure safety + tenant isolation", () => {
  it("records activity location and rejects bad settles without side effects", () => {
    const customer = createWangCustomer();
    const top = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: customer.id,
      createdByStaffId: "staff-001",
    });
    const withTop = addCheckoutItem(ORG_ENJOYE_ID, top.id, {
      type: "STORED_VALUE_TOP_UP",
      name: "儲值",
      unitPrice: 10000,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, withTop.id, [
      { method: "CARD", amount: 10000 },
    ]);
    completeCheckout(ORG_ENJOYE_ID, withTop.id);

    const apt = bookBreast(customer.id, {
      locationId: LOC_ENJOYE_SECONDARY_ID,
      dayOffset: 5,
    });
    toInService(apt.id);
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "COMPLETED");
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "STORED_VALUE", amount: draft.total },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(tx.locationId).toBe(LOC_ENJOYE_SECONDARY_ID);
    const payment = listStoredValueLedger(ORG_ENJOYE_ID, {
      customerId: customer.id,
    }).find((e) => e.type === "PAYMENT" && e.transactionId === tx.id);
    expect(payment?.locationId).toBe(LOC_ENJOYE_SECONDARY_ID);

    // insufficient SV rejected at payment validation — no COMPLETED draft / no TX
    const apt2 = bookBreast(customer.id, { dayOffset: 6, staffId: "staff-002" });
    toInService(apt2.id);
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt2.id, "COMPLETED");
    const bad = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt2.id,
      createdByStaffId: "staff-001",
    });
    const bal = getCustomerStoredValueBalance(ORG_ENJOYE_ID, customer.id);
    const txCount = listTransactions(ORG_ENJOYE_ID).length;
    const ledgerCount = listStoredValueLedger(ORG_ENJOYE_ID, {
      customerId: customer.id,
    }).length;
    expect(() =>
      setCheckoutPayments(ORG_ENJOYE_ID, bad.id, [
        { method: "STORED_VALUE", amount: bal + 5000 },
      ]),
    ).toThrow(/insufficient/);
    // payment mismatch also fails complete with no writes
    setCheckoutPayments(ORG_ENJOYE_ID, bad.id, [
      { method: "CASH", amount: Math.max(1, bad.total - 1) },
    ]);
    expect(() => completeCheckout(ORG_ENJOYE_ID, bad.id)).toThrow(/mismatch/);
    expect(listTransactions(ORG_ENJOYE_ID)).toHaveLength(txCount);
    expect(
      listStoredValueLedger(ORG_ENJOYE_ID, { customerId: customer.id }).length,
    ).toBe(ledgerCount);
    expect(getCheckoutDraft(ORG_ENJOYE_ID, bad.id)?.status).toBe("OPEN");

    // expired package — no side effect
    const expiredDef = createPackageDefinition(ORG_ENJOYE_ID, {
      name: "過期套",
      includedServiceIds: ["svc-breast"],
      sessionCount: 5,
      priceMinor: 1000,
      validityDays: -1,
      createdByStaffId: "staff-001",
    });
    const buy = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: customer.id,
      createdByStaffId: "staff-001",
    });
    const buyItem = addCheckoutItem(ORG_ENJOYE_ID, buy.id, {
      type: "PACKAGE_PURCHASE",
      referenceId: expiredDef.id,
      name: expiredDef.name,
      unitPrice: 1000,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, buyItem.id, [
      { method: "CASH", amount: 1000 },
    ]);
    completeCheckout(ORG_ENJOYE_ID, buyItem.id);
    const expiredPkgId = listPackageLedger(ORG_ENJOYE_ID, {
      customerId: customer.id,
    }).find((e) => e.type === "PURCHASE" && e.sessionDelta === 5)!.customerPackageId;
    expect(getPackageUsableBalance(ORG_ENJOYE_ID, expiredPkgId).usableBalance).toBe(0);

    const apt3 = bookBreast(customer.id, { dayOffset: 7, staffId: "staff-003" });
    toInService(apt3.id);
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt3.id, "COMPLETED");
    const redDraft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt3.id,
      createdByStaffId: "staff-001",
    });
    expect(() =>
      setPackageRedemption(ORG_ENJOYE_ID, redDraft.id, {
        customerPackageId: expiredPkgId,
        serviceId: "svc-breast",
        sessions: 1,
      }),
    ).toThrow();

    // wrong org
    expect(() =>
      createCheckoutFromAppointment(ORG_LUMIERE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-lumiere-01",
      }),
    ).toThrow(/Appointment|not found|eligible/i);

    // wrong customer package use — covered by setPackageRedemption usable list
    expect(listCheckoutDrafts(ORG_LUMIERE_ID).every((d) => d.organizationId === ORG_LUMIERE_ID)).toBe(
      true,
    );
    expect(getTransaction(ORG_LUMIERE_ID, tx.id)).toBeUndefined();
  });

  it("same-id cross-tenant isolation for checkout drafts", () => {
    const shared = "chk-shared-id";
    localStorage.setItem(
      `beauty-os:${ORG_ENJOYE_ID}:checkout-drafts:v1`,
      JSON.stringify([
        {
          id: shared,
          organizationId: ORG_ENJOYE_ID,
          locationId: LOC_ENJOYE_PRIMARY_ID,
          customerId: "demo-001",
          items: [],
          discounts: [],
          payments: [],
          subtotal: 0,
          discountTotal: 0,
          total: 0,
          currency: "TWD",
          status: "OPEN",
          createdByStaffId: "staff-001",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    );
    localStorage.setItem(
      `beauty-os:${ORG_LUMIERE_ID}:checkout-drafts:v1`,
      JSON.stringify([
        {
          id: shared,
          organizationId: ORG_LUMIERE_ID,
          locationId: LOC_LUMIERE_PRIMARY_ID,
          customerId: "lumiere-c-001",
          items: [],
          discounts: [],
          payments: [],
          subtotal: 0,
          discountTotal: 0,
          total: 0,
          currency: "TWD",
          status: "OPEN",
          createdByStaffId: "staff-lumiere-01",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    );
    expect(getCheckoutDraft(ORG_ENJOYE_ID, shared)?.customerId).toBe("demo-001");
    expect(getCheckoutDraft(ORG_LUMIERE_ID, shared)?.customerId).toBe("lumiere-c-001");
  });
});
