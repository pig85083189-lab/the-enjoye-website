/**
 * Phase 4.11D — Reports aggregators (read-only derived).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { endOfDay, startOfDay } from "@/lib/appointments/domain";
import {
  createAppointment,
  listAppointments,
  transitionAppointmentStatus,
} from "@/lib/appointments/store";
import {
  addCheckoutItem,
  completeCheckout,
  createCheckoutFromAppointment,
  createEmptyCheckoutDraft,
  getCheckoutDraft,
  setCheckoutPayments,
  setPackageRedemption,
} from "@/lib/commerce/checkout-store";
import { voidTransaction } from "@/lib/commerce/void-transaction";
import {
  completeFollowUpTask,
  ensureFollowUpTaskFromCompletedTreatment,
} from "@/lib/follow-ups/store";
import { NAVIGATION_ITEMS } from "@/lib/navigation/config";
import {
  createPackageDefinition,
  listPackageLedger,
} from "@/lib/packages/store";
import { getAppointmentSummary } from "@/lib/reports/appointments";
import { getCustomerSummary } from "@/lib/reports/customers";
import { resolveReportPreset } from "@/lib/reports/date-range";
import type { ReportQuery } from "@/lib/reports/domain";
import { getFollowUpSummary } from "@/lib/reports/follow-ups-metrics";
import {
  getPaymentBreakdown,
  getRevenueSummary,
  getSalesMixSummary,
} from "@/lib/reports/revenue";
import { getOpsDashboardReport } from "@/lib/reports/summary";
import { getTreatmentSummary } from "@/lib/reports/treatments";
import { createProduct } from "@/lib/products/store";
import { receiveStock } from "@/lib/inventory/store";
import { createEmptyDraft, saveCompletedTreatment } from "@/lib/treatment-draft";

function wipe() {
  localStorage.clear();
}

beforeEach(() => wipe());

const day = new Date(2026, 8, 25, 12, 0, 0);

function rangeForDay(d: Date = new Date()): ReportQuery["range"] {
  return { startAt: startOfDay(d), endAt: endOfDay(d) };
}

function query(partial?: Partial<ReportQuery>): ReportQuery {
  return {
    organizationId: ORG_ENJOYE_ID,
    range: rangeForDay(new Date()),
    ...partial,
  };
}

function makeInServiceApt(locationId = LOC_ENJOYE_PRIMARY_ID) {
  const start = new Date(2026, 8, 25, 14, 0).toISOString();
  const end = new Date(2026, 8, 25, 15, 30).toISOString();
  const apt = createAppointment(ORG_ENJOYE_ID, {
    locationId,
    customerId: "demo-001",
    serviceId: "svc-breast",
    staffId: "staff-001",
    startAt: start,
    endAt: end,
    allowConflict: true,
  });
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "CONFIRMED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "ARRIVED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "IN_SERVICE");
  return apt;
}

function payCashAndComplete(draftId: string) {
  const d = getCheckoutDraft(ORG_ENJOYE_ID, draftId)!;
  if (d.total > 0) {
    setCheckoutPayments(ORG_ENJOYE_ID, draftId, [
      { method: "CASH", amount: d.total },
    ]);
  } else {
    setCheckoutPayments(ORG_ENJOYE_ID, draftId, []);
  }
  return completeCheckout(ORG_ENJOYE_ID, draftId);
}

describe("revenue", () => {
  it("only counts COMPLETED transactions; VOIDED excluded", () => {
    const apt = makeInServiceApt();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    const tx = payCashAndComplete(draft.id);
    expect(getRevenueSummary(query()).revenueMinor).toBe(tx.total);

    voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "作廢測試",
    });
    expect(getRevenueSummary(query()).revenueMinor).toBe(0);
    expect(getRevenueSummary(query()).transactionCount).toBe(0);
  });

  it("zero-total package redemption is not revenue", () => {
    const def = createPackageDefinition(ORG_ENJOYE_ID, {
      name: "報表測試套票",
      includedServiceIds: ["svc-breast"],
      sessionCount: 5,
      priceMinor: 9000,
      validityDays: 365,
      createdByStaffId: "staff-001",
    });
    const buy = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, buy.id, {
      type: "PACKAGE_PURCHASE",
      referenceId: def.id,
      name: def.name,
      unitPrice: 9000,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, buy.id, [
      { method: "CARD", amount: 9000 },
    ]);
    completeCheckout(ORG_ENJOYE_ID, buy.id);
    const customerPackageId = listPackageLedger(ORG_ENJOYE_ID, {
      customerId: "demo-001",
    }).find((e) => e.type === "PURCHASE")!.customerPackageId;

    const apt = makeInServiceApt();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    setPackageRedemption(ORG_ENJOYE_ID, draft.id, {
      customerPackageId,
      serviceId: "svc-breast",
      sessions: 1,
    });
    const redTx = payCashAndComplete(draft.id);
    expect(redTx.total).toBe(0);

    const summary = getRevenueSummary(query());
    // Package purchase 9000 still counts as COMPLETED total > 0
    expect(summary.revenueMinor).toBe(9000);
    expect(summary.zeroTotalCompletedCount).toBeGreaterThanOrEqual(1);
    expect(summary.transactionCount).toBe(1);
  });

  it("average ticket is revenue / paid count; zero data → 0 not NaN", () => {
    const empty = getRevenueSummary(query());
    expect(empty.averageTicketMinor).toBe(0);
    expect(Number.isNaN(empty.averageTicketMinor)).toBe(false);

    const apt = makeInServiceApt();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    const tx = payCashAndComplete(draft.id);
    const s = getRevenueSummary(query());
    expect(s.averageTicketMinor).toBe(tx.total);
  });

  it("mixed tender breakdown splits payment rows", () => {
    const apt = makeInServiceApt();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    const cash = Math.floor(draft.total / 2);
    const card = draft.total - cash;
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "CASH", amount: cash },
      { method: "CARD", amount: card },
    ]);
    completeCheckout(ORG_ENJOYE_ID, draft.id);
    const rows = getPaymentBreakdown(query());
    expect(rows.find((r) => r.method === "CASH")?.amountMinor).toBe(cash);
    expect(rows.find((r) => r.method === "CARD")?.amountMinor).toBe(card);
  });

  it("service/product sales split and product quantity", () => {
    const product = createProduct(ORG_ENJOYE_ID, {
      name: "報表測試乳霜",
      priceMinor: 500,
      createdByStaffId: "staff-001",
    });
    receiveStock(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      productId: product.id,
      quantity: 10,
      createdByStaffId: "staff-001",
      note: "seed for report test",
    });

    const walk = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, walk.id, {
      type: "SERVICE",
      referenceId: "svc-breast",
      name: "美胸",
      unitPrice: 2000,
      quantity: 1,
    });
    addCheckoutItem(ORG_ENJOYE_ID, walk.id, {
      type: "PRODUCT",
      referenceId: product.id,
      name: product.name,
      unitPrice: product.priceMinor,
      quantity: 2,
    });
    const d = getCheckoutDraft(ORG_ENJOYE_ID, walk.id)!;
    setCheckoutPayments(ORG_ENJOYE_ID, walk.id, [
      { method: "CASH", amount: d.total },
    ]);
    completeCheckout(ORG_ENJOYE_ID, walk.id);
    const mix = getSalesMixSummary(query());
    expect(mix.serviceSalesMinor).toBeGreaterThan(0);
    expect(mix.productSalesMinor).toBe(1000);
    expect(mix.serviceLineCount).toBe(1);
    expect(mix.productQuantity).toBe(2);
  });
});

describe("appointments / treatments / customers / follow-ups", () => {
  it("appointment completed/cancelled/no-show metrics", () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    const booked = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      serviceId: "svc-breast",
      staffId: "staff-001",
      startAt: new Date(y, m, d, 10, 0).toISOString(),
      endAt: new Date(y, m, d, 11, 0).toISOString(),
      allowConflict: true,
    });
    transitionAppointmentStatus(ORG_ENJOYE_ID, booked.id, "CONFIRMED");
    transitionAppointmentStatus(ORG_ENJOYE_ID, booked.id, "ARRIVED");
    transitionAppointmentStatus(ORG_ENJOYE_ID, booked.id, "IN_SERVICE");
    transitionAppointmentStatus(ORG_ENJOYE_ID, booked.id, "COMPLETED");

    const cancelled = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-002",
      serviceId: "svc-breast",
      staffId: "staff-001",
      startAt: new Date(y, m, d, 12, 0).toISOString(),
      endAt: new Date(y, m, d, 13, 0).toISOString(),
      allowConflict: true,
    });
    transitionAppointmentStatus(ORG_ENJOYE_ID, cancelled.id, "CANCELLED");

    const noShow = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      serviceId: "svc-breast",
      staffId: "staff-001",
      startAt: new Date(y, m, d, 16, 0).toISOString(),
      endAt: new Date(y, m, d, 17, 0).toISOString(),
      allowConflict: true,
    });
    transitionAppointmentStatus(ORG_ENJOYE_ID, noShow.id, "NO_SHOW");

    const s = getAppointmentSummary(query());
    expect(s.completed).toBeGreaterThanOrEqual(1);
    expect(s.cancelled).toBeGreaterThanOrEqual(1);
    expect(s.noShow).toBeGreaterThanOrEqual(1);
    expect(s.completionRate).toBeGreaterThan(0);
    expect(Number.isNaN(s.completionRate)).toBe(false);
  });

  it("treatment completed count", () => {
    const draft = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      appointmentId: "apt-report-t1",
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: "svc-breast",
    });
    draft.status = "completed";
    draft.updatedAt = new Date(2026, 8, 25, 15, 0).toISOString();
    saveCompletedTreatment(draft);
    // saveCompletedTreatment overwrites updatedAt — use wide range
    const wide = getTreatmentSummary({
      organizationId: ORG_ENJOYE_ID,
      range: {
        startAt: new Date(2020, 0, 1),
        endAt: new Date(2030, 0, 1),
      },
    });
    expect(wide.completedCount).toBeGreaterThanOrEqual(1);
  });

  it("follow-up open/overdue/completed", () => {
    const treatment = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      appointmentId: "apt-fu-report",
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: "svc-breast",
    });
    treatment.id = "treatment-report-fu";
    treatment.status = "completed";
    treatment.followUp = {
      tags: ["追蹤"],
      suggestedDate: "2026-09-20",
      note: "逾期待測",
      suggestNextBooking: false,
    };
    const task = ensureFollowUpTaskFromCompletedTreatment(treatment)!;
    expect(getFollowUpSummary(query(), day).overdueCount).toBeGreaterThanOrEqual(1);

    completeFollowUpTask(ORG_ENJOYE_ID, task.id, {
      actorStaffId: "staff-001",
      completionNote: "ok",
    });
    const wide = getFollowUpSummary({
      organizationId: ORG_ENJOYE_ID,
      range: {
        startAt: new Date(2020, 0, 1),
        endAt: new Date(2030, 0, 1),
      },
    });
    expect(wide.completedInRangeCount).toBeGreaterThanOrEqual(1);
  });

  it("customer paying count from revenue txs", () => {
    const apt = makeInServiceApt();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    payCashAndComplete(draft.id);
    expect(getCustomerSummary(query()).payingCustomerCount).toBe(1);
  });
});

describe("date / location / tenant isolation", () => {
  it("date range filtering and presets use local boundaries", () => {
    const today = resolveReportPreset("today", day);
    expect(today.startAt.getHours()).toBe(0);
    expect(today.endAt.getDate()).toBe(day.getDate());

    const apt = makeInServiceApt();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    payCashAndComplete(draft.id);

    expect(
      getRevenueSummary({
        organizationId: ORG_ENJOYE_ID,
        range: rangeForDay(new Date(2020, 0, 1)),
      }).revenueMinor,
    ).toBe(0);
    expect(getRevenueSummary(query()).revenueMinor).toBeGreaterThan(0);
  });

  it("location filtering vs all-location aggregation", () => {
    const a = makeInServiceApt(LOC_ENJOYE_PRIMARY_ID);
    payCashAndComplete(
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: a.id,
        createdByStaffId: "staff-001",
      }).id,
    );

    const b = makeInServiceApt(LOC_ENJOYE_SECONDARY_ID);
    payCashAndComplete(
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: b.id,
        createdByStaffId: "staff-001",
      }).id,
    );

    const all = getRevenueSummary(query());
    const primary = getRevenueSummary(
      query({ locationId: LOC_ENJOYE_PRIMARY_ID }),
    );
    const secondary = getRevenueSummary(
      query({ locationId: LOC_ENJOYE_SECONDARY_ID }),
    );
    expect(all.transactionCount).toBe(
      primary.transactionCount + secondary.transactionCount,
    );
    expect(all.revenueMinor).toBe(primary.revenueMinor + secondary.revenueMinor);
  });

  it("cross-org transaction / appointment / follow-up excluded", () => {
    const apt = makeInServiceApt();
    payCashAndComplete(
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-001",
      }).id,
    );

    expect(
      getRevenueSummary({
        organizationId: ORG_LUMIERE_ID,
        range: rangeForDay(new Date()),
      }).revenueMinor,
    ).toBe(0);
    expect(
      listAppointments({ organizationId: ORG_LUMIERE_ID }).some(
        (a) => a.id === apt.id,
      ),
    ).toBe(false);

    const treatment = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      appointmentId: "apt-xorg-fu",
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: "svc-breast",
    });
    treatment.id = "t-xorg-fu";
    treatment.status = "completed";
    treatment.followUp = {
      tags: ["x"],
      suggestedDate: "2026-09-25",
      note: "",
      suggestNextBooking: false,
    };
    ensureFollowUpTaskFromCompletedTreatment(treatment);
    const lumFu = getFollowUpSummary({
      organizationId: ORG_LUMIERE_ID,
      range: rangeForDay(new Date()),
    });
    expect(lumFu.openCount + lumFu.overdueCount).toBe(0);
  });

  it("same-id tenant isolation for dashboard", () => {
    const apt = makeInServiceApt();
    payCashAndComplete(
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-001",
      }).id,
    );
    const a = getOpsDashboardReport(query());
    const b = getOpsDashboardReport({
      organizationId: ORG_LUMIERE_ID,
      range: rangeForDay(),
    });
    expect(a.revenue.revenueMinor).toBeGreaterThan(0);
    expect(b.revenue.revenueMinor).toBe(0);
  });
});

describe("navigation", () => {
  it("reports is ready", () => {
    const item = NAVIGATION_ITEMS.find((i) => i.id === "reports")!;
    expect(item.status).toBe("ready");
    expect(item.roles).toContain("OWNER");
  });
});
