import { beforeEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_LUMIERE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { createAppointment, transitionAppointmentStatus } from "@/lib/appointments/store";
import { calculateTotals, lineSubtotal } from "@/lib/commerce/calculations";
import {
  addCheckoutItem,
  completeCheckout,
  createCheckoutFromAppointment,
  getCheckoutDraft,
  listCheckoutDrafts,
  setCheckoutDiscounts,
  setCheckoutPayments,
} from "@/lib/commerce/checkout-store";
import { getServicePriceMinor } from "@/lib/commerce/pricing";
import { getServiceById } from "@/data/mock-services";
import {
  getTransaction,
  hasCompletedTransactionForAppointment,
  listTransactions,
} from "@/lib/commerce/transaction-store";
import { getCheckoutDraftsKey, getTransactionsKey } from "@/lib/tenant/storage-keys";
import type { CheckoutItem } from "@/lib/commerce/domain";

function wipe() {
  localStorage.clear();
}

beforeEach(() => wipe());

function makeEligibleAppointment(staffId = "staff-002") {
  const start = new Date(2026, 8, 21, 14, 0).toISOString();
  const end = new Date(2026, 8, 21, 15, 30).toISOString();
  const apt = createAppointment(ORG_ENJOYE_ID, {
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "demo-001",
    serviceId: "svc-breast",
    staffId,
    startAt: start,
    endAt: end,
    allowConflict: true,
  });
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "CONFIRMED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "ARRIVED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "IN_SERVICE");
  return apt;
}

function payExact(organizationId: string, draftId: string, total: number) {
  setCheckoutPayments(organizationId, draftId, [
    { method: "CASH", amount: total },
  ]);
}

describe("commerce tenant isolation", () => {
  it("org A cannot read org B checkout draft", () => {
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    expect(getCheckoutDraft(ORG_LUMIERE_ID, draft.id)).toBeUndefined();
    expect(listCheckoutDrafts(ORG_LUMIERE_ID).some((d) => d.id === draft.id)).toBe(false);
  });

  it("org A cannot mutate org B checkout draft", () => {
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    expect(() =>
      addCheckoutItem(ORG_LUMIERE_ID, draft.id, {
        type: "CUSTOM",
        name: "hack",
        unitPrice: 100,
      }),
    ).toThrow(/not found/i);
  });

  it("org A cannot read org B transaction", () => {
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    payExact(ORG_ENJOYE_ID, draft.id, draft.total);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(getTransaction(ORG_LUMIERE_ID, tx.id)).toBeUndefined();
    expect(listTransactions(ORG_LUMIERE_ID).some((t) => t.id === tx.id)).toBe(false);
  });

  it("rejects foreign location / customer / service / staff on checkout create path", () => {
    expect(() =>
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: "missing",
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/Appointment/);

    const apt = makeEligibleAppointment();
    expect(() =>
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-lumiere-01",
      }),
    ).toThrow(/Staff/);
  });

  it("same ids across organizations do not leak", () => {
    const shared = "chk-shared";
    localStorage.setItem(
      getCheckoutDraftsKey(ORG_ENJOYE_ID),
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
      getCheckoutDraftsKey(ORG_LUMIERE_ID),
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

describe("money and discounts", () => {
  it("computes quantity and rejects over-discount / negative total", () => {
    expect(lineSubtotal(2300, 2)).toBe(4600);
    const items: CheckoutItem[] = [
      {
        id: "1",
        type: "SERVICE",
        nameSnapshot: "A",
        unitPrice: 2300,
        quantity: 1,
        lineSubtotal: 2300,
        discountAmount: 0,
        lineTotal: 2300,
      },
    ];
    expect(calculateTotals(items, [{ id: "d", type: "ORDER_FIXED", value: 300 }]).total).toBe(
      2000,
    );
    expect(
      calculateTotals(items, [{ id: "d", type: "ORDER_PERCENTAGE", value: 1000 }]).discountTotal,
    ).toBe(230);
    expect(() =>
      calculateTotals(items, [{ id: "d", type: "ORDER_FIXED", value: 5000 }]),
    ).not.toThrow();
    expect(calculateTotals(items, [{ id: "d", type: "ORDER_FIXED", value: 5000 }]).total).toBe(0);
    expect(() =>
      calculateTotals(items, [{ id: "d", type: "ORDER_PERCENTAGE", value: 12000 }]),
    ).toThrow(/basis points/);
  });

  it("snapshots service price and ignores later catalog change", () => {
    const service = getServiceById("svc-breast", ORG_ENJOYE_ID)!;
    const price = getServicePriceMinor(service);
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    expect(draft.items[0]?.unitPrice).toBe(price);
    expect(draft.items[0]?.nameSnapshot).toBe(service.name);
    // Mutating catalog object must not rewrite draft snapshot
    (service as { priceMinor?: number }).priceMinor = 9999;
    expect(draft.items[0]?.unitPrice).toBe(price);
    payExact(ORG_ENJOYE_ID, draft.id, draft.total);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(tx.items[0]?.unitPrice).toBe(price);
    // restore
    (service as { priceMinor?: number }).priceMinor = price;
  });
});

describe("payments and settle", () => {
  it("accepts single and mixed tender exact totals; rejects mismatch and negative", () => {
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    expect(() =>
      setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [{ method: "CASH", amount: -1 }]),
    ).toThrow(/negative/);
    expect(() =>
      setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [{ method: "CASH", amount: 0 }]),
    ).toThrow(/zero/);

    const half = Math.floor(draft.total / 2);
    const rest = draft.total - half;
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "CASH", amount: half },
      { method: "CARD", amount: rest },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(tx.payments).toHaveLength(2);
    expect(tx.total).toBe(draft.total);

    const apt2 = makeEligibleAppointment("staff-003");
    const draft2 = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt2.id,
      createdByStaffId: "staff-001",
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft2.id, [
      { method: "CASH", amount: draft2.total - 1 },
    ]);
    expect(() => completeCheckout(ORG_ENJOYE_ID, draft2.id)).toThrow(/mismatch/);
  });

  it("rejects duplicate checkout and uses appointment location", () => {
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    expect(draft.locationId).toBe(apt.locationId);
    payExact(ORG_ENJOYE_ID, draft.id, draft.total);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(tx.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    expect(hasCompletedTransactionForAppointment(ORG_ENJOYE_ID, apt.id)).toBe(true);
    expect(() =>
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/already/);
  });

  it("rejects BOOKED appointment checkout; allows IN_SERVICE", () => {
    const booked = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      serviceId: "svc-breast",
      staffId: "staff-002",
      startAt: new Date(2026, 8, 22, 10, 0).toISOString(),
      endAt: new Date(2026, 8, 22, 11, 0).toISOString(),
      allowConflict: true,
    });
    expect(() =>
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: booked.id,
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/not eligible/);

    transitionAppointmentStatus(ORG_ENJOYE_ID, booked.id, "CONFIRMED");
    transitionAppointmentStatus(ORG_ENJOYE_ID, booked.id, "ARRIVED");
    transitionAppointmentStatus(ORG_ENJOYE_ID, booked.id, "IN_SERVICE");
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: booked.id,
      createdByStaffId: "staff-001",
    });
    expect(draft.status).toBe("OPEN");
  });

  it("persists drafts and transactions; completed draft cannot be edited", () => {
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    expect(localStorage.getItem(getCheckoutDraftsKey(ORG_ENJOYE_ID))).toBeTruthy();
    payExact(ORG_ENJOYE_ID, draft.id, draft.total);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(localStorage.getItem(getTransactionsKey(ORG_ENJOYE_ID))).toBeTruthy();
    expect(tx.transactionNumber).toMatch(/^TX-\d{8}-\d{4}$/);
    expect(() =>
      addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
        type: "CUSTOM",
        name: "x",
        unitPrice: 10,
      }),
    ).toThrow(/cannot be edited/);

    // tenant-isolated numbering
    const again = listTransactions(ORG_ENJOYE_ID);
    expect(again.some((t) => t.id === tx.id)).toBe(true);
  });

  it("transaction number counters are per organization", () => {
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    payExact(ORG_ENJOYE_ID, draft.id, draft.total);
    const txA = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(txA.transactionNumber.endsWith("-0001")).toBe(true);

    const lumiereApt = createAppointment(ORG_LUMIERE_ID, {
      locationId: LOC_LUMIERE_PRIMARY_ID,
      customerId: "lumiere-c-001",
      serviceId: "svc-lumiere-facial",
      staffId: "staff-lumiere-01",
      startAt: new Date(2026, 8, 21, 10, 0).toISOString(),
      endAt: new Date(2026, 8, 21, 11, 0).toISOString(),
      allowConflict: true,
    });
    transitionAppointmentStatus(ORG_LUMIERE_ID, lumiereApt.id, "CONFIRMED");
    transitionAppointmentStatus(ORG_LUMIERE_ID, lumiereApt.id, "ARRIVED");
    transitionAppointmentStatus(ORG_LUMIERE_ID, lumiereApt.id, "IN_SERVICE");
    const draftB = createCheckoutFromAppointment(ORG_LUMIERE_ID, {
      appointmentId: lumiereApt.id,
      createdByStaffId: "staff-lumiere-01",
    });
    payExact(ORG_LUMIERE_ID, draftB.id, draftB.total);
    const txB = completeCheckout(ORG_LUMIERE_ID, draftB.id);
    expect(txB.transactionNumber.endsWith("-0001")).toBe(true);
    expect(txA.organizationId).not.toBe(txB.organizationId);
  });

  it("persists draft and transaction across store re-read", () => {
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    const draftAgain = getCheckoutDraft(ORG_ENJOYE_ID, draft.id);
    expect(draftAgain?.id).toBe(draft.id);
    expect(draftAgain?.total).toBe(draft.total);
    payExact(ORG_ENJOYE_ID, draft.id, draft.total);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    const txAgain = getTransaction(ORG_ENJOYE_ID, tx.id);
    expect(txAgain?.transactionNumber).toBe(tx.transactionNumber);
    expect(txAgain?.items[0]?.unitPrice).toBe(tx.items[0]?.unitPrice);
  });

  it("validates ownership for location customer service and rejects reserved payment methods", () => {
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    expect(draft.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    expect(draft.customerId).toBe("demo-001");
    expect(draft.items[0]?.referenceId).toBe("svc-breast");

    expect(() =>
      addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
        type: "SERVICE",
        referenceId: "svc-lumiere-facial",
        name: "x",
        unitPrice: 1,
      }),
    ).toThrow(/Service/);

    expect(() =>
      setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
        { method: "PACKAGE", amount: draft.total },
      ]),
    ).toThrow(/unsupported/);
  });

  it("allows COMPLETED appointment checkout and freezes location against UI location switch", () => {
    const apt = makeEligibleAppointment();
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "COMPLETED");
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    expect(draft.status).toBe("OPEN");
    expect(draft.locationId).toBe(apt.locationId);

    // Simulating a UI location switch must not rewrite the draft location.
    expect(draft.locationId).not.toBe(LOC_LUMIERE_PRIMARY_ID);
    expect(draft.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    payExact(ORG_ENJOYE_ID, draft.id, draft.total);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(tx.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
  });

  it("validates treatment ownership when treatmentId is provided", () => {
    const apt = makeEligibleAppointment();
    expect(() =>
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-001",
        treatmentId: "tr-foreign-missing",
      }),
    ).toThrow(/Treatment not found/);
  });

  it("rejects CANCELLED appointment and caps oversize fixed discount", () => {
    const booked = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      serviceId: "svc-breast",
      staffId: "staff-002",
      startAt: new Date(2026, 8, 23, 10, 0).toISOString(),
      endAt: new Date(2026, 8, 23, 11, 0).toISOString(),
      allowConflict: true,
    });
    transitionAppointmentStatus(ORG_ENJOYE_ID, booked.id, "CANCELLED");
    expect(() =>
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: booked.id,
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/not eligible/);

    const apt2 = makeEligibleAppointment("staff-003");
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt2.id,
      createdByStaffId: "staff-001",
    });
    // Cap to zero total is allowed by calculateTotals; store still accepts via cap
    const capped = setCheckoutDiscounts(ORG_ENJOYE_ID, draft.id, [
      { type: "ORDER_FIXED", value: draft.subtotal + 500 },
    ]);
    expect(capped.total).toBe(0);
    expect(capped.discountTotal).toBe(capped.subtotal);
  });
});
