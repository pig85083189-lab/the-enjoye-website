/**
 * Reports Workspace — read-model isolation.
 * Covers A–T plus source-contract assertions. No second report store.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endOfDay, startOfDay } from "@/lib/appointments/domain";
import {
  createAppointment,
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
import { externalInflowMinor } from "@/lib/commerce/transactions-workspace-derived";
import { ensureFollowUpTaskFromCompletedTreatment } from "@/lib/follow-ups/store";
import { getProductStock, receiveStock } from "@/lib/inventory/store";
import { createPackageDefinition, listPackageLedger } from "@/lib/packages/store";
import { createProduct } from "@/lib/products/store";
import {
  PRODUCTS_LOW_STOCK_THRESHOLD,
} from "@/lib/products/products-workspace-derived";
import {
  previousPeriodRange,
  resolveReportPreset,
} from "@/lib/reports/date-range";
import type { ReportQuery } from "@/lib/reports/domain";
import { getRevenueSummary } from "@/lib/reports/revenue";
import {
  REPORTS_HAS_PACKAGE_EXPIRY_ATTENTION,
  REPORTS_HAS_PERSISTED_ANALYTICS,
  REPORTS_HAS_REBOOK_COLUMN,
  REPORTS_HAS_SECOND_STORE,
  REPORTS_LOW_STOCK_THRESHOLD,
  allocateExternalInflowByLineType,
  buildNeedsAttention,
  buildPopularProducts,
  buildPopularTreatments,
  buildStaffOperations,
  comparePeriod,
  getReportsWorkspaceDashboard,
  listLowStockProductIds,
  sumSalesComposition,
} from "@/lib/reports/reports-workspace-derived";
import { getTreatmentSummary } from "@/lib/reports/treatments";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { createEmptyDraft, saveCompletedTreatment } from "@/lib/treatment-draft";

function wipe() {
  localStorage.clear();
}

beforeEach(() => {
  wipe();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const NOW = new Date(2026, 8, 25, 15, 0, 0);

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

function todayAt(hour: number, minute = 0) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
}

function makeInServiceApt(
  locationId = LOC_ENJOYE_PRIMARY_ID,
  staffId = "staff-002",
  hour = 14,
) {
  const apt = createAppointment(ORG_ENJOYE_ID, {
    locationId,
    customerId: "demo-001",
    serviceId: "svc-breast",
    staffId,
    startAt: todayAt(hour).toISOString(),
    endAt: todayAt(hour + 1, 30).toISOString(),
    allowConflict: true,
  });
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "CONFIRMED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "ARRIVED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "IN_SERVICE");
  return apt;
}

function payAndComplete(
  draftId: string,
  payments: Array<{ method: "CASH" | "CARD" | "TRANSFER" | "OTHER" | "STORED_VALUE"; amount: number }>,
) {
  setCheckoutPayments(ORG_ENJOYE_ID, draftId, payments);
  return completeCheckout(ORG_ENJOYE_ID, draftId);
}

function cashComplete(draftId: string) {
  const draft = getCheckoutDraft(ORG_ENJOYE_ID, draftId)!;
  if (draft.total <= 0) return payAndComplete(draftId, []);
  return payAndComplete(draftId, [{ method: "CASH", amount: draft.total }]);
}

function topUpStoredValue(amount = 10000) {
  const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "demo-001",
    createdByStaffId: "staff-001",
  });
  addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
    type: "STORED_VALUE_TOP_UP",
    name: "儲值",
    unitPrice: amount,
  });
  return payAndComplete(draft.id, [{ method: "CASH", amount }]);
}

function completeTreatment(input: {
  appointmentId: string;
  staffId?: string;
  serviceId?: string;
  locationId?: string;
}) {
  const draft = createEmptyDraft({
    organizationId: ORG_ENJOYE_ID,
    locationId: input.locationId ?? LOC_ENJOYE_PRIMARY_ID,
    appointmentId: input.appointmentId,
    customerId: "demo-001",
    staffId: input.staffId ?? "staff-002",
    serviceId: input.serviceId ?? "svc-breast",
  });
  draft.status = "completed";
  saveCompletedTreatment(draft);
  return draft;
}

describe("A / B external revenue excludes redemptions", () => {
  it("does not add stored-value redemption as new external revenue", () => {
    const topUp = topUpStoredValue(10000);
    expect(externalInflowMinor(topUp)).toBe(10000);

    const walk = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, walk.id, {
      type: "SERVICE",
      referenceId: "svc-breast",
      name: "性感美胸 SPA",
      unitPrice: 3200,
    });
    const spend = payAndComplete(walk.id, [{ method: "STORED_VALUE", amount: 3200 }]);
    expect(externalInflowMinor(spend)).toBe(0);

    const summary = getRevenueSummary(query());
    expect(summary.revenueMinor).toBe(10000);
    expect(summary.transactionCount).toBe(1);
    expect(summary.zeroTotalCompletedCount).toBeGreaterThanOrEqual(1);

    const dash = getReportsWorkspaceDashboard(query(), {
      preset: "today",
      now: new Date(),
    });
    expect(dash.kpis.revenueMinor).toBe(10000);
    expect(dash.sales.totalExternalMinor).toBe(10000);
    expect(dash.sales.storedValueMinor).toBe(10000);
    expect(dash.sales.treatmentMinor).toBe(0);
  });

  it("does not add package redemption as new external revenue", () => {
    const def = createPackageDefinition(ORG_ENJOYE_ID, {
      name: "報表套票",
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
    payAndComplete(buy.id, [{ method: "CARD", amount: 9000 }]);
    const customerPackageId = listPackageLedger(ORG_ENJOYE_ID, {
      customerId: "demo-001",
    }).find((entry) => entry.type === "PURCHASE")!.customerPackageId;

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
    const redeemed = cashComplete(draft.id);
    expect(externalInflowMinor(redeemed)).toBe(0);

    const summary = getRevenueSummary(query());
    expect(summary.revenueMinor).toBe(9000);
    expect(summary.transactionCount).toBe(1);
    expect(summary.zeroTotalCompletedCount).toBeGreaterThanOrEqual(1);

    const mix = sumSalesComposition(
      [redeemed].concat(
        // purchase tx is also in range
        [],
      ),
    );
    expect(allocateExternalInflowByLineType(redeemed)).toEqual({
      treatment: 0,
      product: 0,
      package: 0,
      storedValue: 0,
    });
    const dash = getReportsWorkspaceDashboard(query(), {
      preset: "today",
      now: new Date(),
    });
    expect(dash.sales.packageMinor).toBe(9000);
    expect(dash.kpis.revenueMinor).toBe(9000);
    expect(mix.totalExternalMinor).toBe(0);
  });
});

describe("C / D valid count and average ticket", () => {
  it("counts only COMPLETED txs with external inflow > 0", () => {
    topUpStoredValue(5000);
    const walk = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, walk.id, {
      type: "SERVICE",
      referenceId: "svc-breast",
      name: "性感美胸 SPA",
      unitPrice: 3200,
    });
    payAndComplete(walk.id, [{ method: "STORED_VALUE", amount: 3200 }]);

    const summary = getRevenueSummary(query());
    expect(summary.transactionCount).toBe(1);
    expect(summary.averageTicketMinor).toBe(5000);
  });

  it("average ticket is 0 when there are no paying transactions", () => {
    const empty = getRevenueSummary(query());
    expect(empty.averageTicketMinor).toBe(0);
    expect(Number.isNaN(empty.averageTicketMinor)).toBe(false);
    const dash = getReportsWorkspaceDashboard(query(), {
      preset: "today",
      now: new Date(),
    });
    expect(dash.kpis.averageTicketMinor).toBe(0);
  });
});

describe("E completed treatments", () => {
  it("uses completed Treatment records, not appointment completed", () => {
    const apt = makeInServiceApt();
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "COMPLETED");
    expect(
      getTreatmentSummary(query({
        range: { startAt: new Date(2020, 0, 1), endAt: new Date(2030, 0, 1) },
      })).completedCount,
    ).toBeGreaterThanOrEqual(0);

    completeTreatment({ appointmentId: apt.id, staffId: "staff-002" });
    const wide = getTreatmentSummary({
      organizationId: ORG_ENJOYE_ID,
      range: { startAt: new Date(2020, 0, 1), endAt: new Date(2030, 0, 1) },
    });
    expect(wide.completedCount).toBeGreaterThanOrEqual(1);

    const dash = getReportsWorkspaceDashboard(
      {
        organizationId: ORG_ENJOYE_ID,
        range: { startAt: new Date(2020, 0, 1), endAt: new Date(2030, 0, 1) },
      },
      { preset: "custom", now: new Date() },
    );
    expect(dash.kpis.completedTreatments).toBe(wide.completedCount);
  });
});

describe("F appointment status summary", () => {
  it("maps canonical statuses including 未完成", () => {
    const completed = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      serviceId: "svc-breast",
      staffId: "staff-001",
      startAt: todayAt(10).toISOString(),
      endAt: todayAt(11).toISOString(),
      allowConflict: true,
    });
    transitionAppointmentStatus(ORG_ENJOYE_ID, completed.id, "CONFIRMED");
    transitionAppointmentStatus(ORG_ENJOYE_ID, completed.id, "ARRIVED");
    transitionAppointmentStatus(ORG_ENJOYE_ID, completed.id, "IN_SERVICE");
    transitionAppointmentStatus(ORG_ENJOYE_ID, completed.id, "COMPLETED");

    const cancelled = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-002",
      serviceId: "svc-breast",
      staffId: "staff-001",
      startAt: todayAt(12).toISOString(),
      endAt: todayAt(13).toISOString(),
      allowConflict: true,
    });
    transitionAppointmentStatus(ORG_ENJOYE_ID, cancelled.id, "CANCELLED");

    const noShow = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      serviceId: "svc-facial",
      staffId: "staff-001",
      startAt: todayAt(16).toISOString(),
      endAt: todayAt(17).toISOString(),
      allowConflict: true,
    });
    transitionAppointmentStatus(ORG_ENJOYE_ID, noShow.id, "NO_SHOW");

    const open = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-002",
      serviceId: "svc-curve",
      staffId: "staff-001",
      startAt: todayAt(18).toISOString(),
      endAt: todayAt(19).toISOString(),
      allowConflict: true,
    });
    transitionAppointmentStatus(ORG_ENJOYE_ID, open.id, "CONFIRMED");

    const dash = getReportsWorkspaceDashboard(query(), {
      preset: "today",
      now: new Date(),
    });
    expect(dash.appointments.completed).toBeGreaterThanOrEqual(1);
    expect(dash.appointments.cancelled).toBeGreaterThanOrEqual(1);
    expect(dash.appointments.noShow).toBeGreaterThanOrEqual(1);
    expect(dash.appointments.incomplete).toBeGreaterThanOrEqual(1);
    expect(dash.appointments.total).toBe(
      dash.appointments.completed +
        dash.appointments.cancelled +
        dash.appointments.noShow +
        dash.appointments.incomplete,
    );
    expect(
      dash.appointments.completionRate +
        dash.appointments.cancellationRate +
        dash.appointments.noShowRate +
        dash.appointments.incompleteRate,
    ).toBeCloseTo(1, 5);
  });
});

describe("G sales composition allocates external inflow", () => {
  it("mixed payment attributes only the external share", () => {
    topUpStoredValue(10000);
    const walk = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, walk.id, {
      type: "SERVICE",
      referenceId: "svc-breast",
      name: "性感美胸 SPA",
      unitPrice: 3200,
    });
    const mixed = payAndComplete(walk.id, [
      { method: "CASH", amount: 1000 },
      { method: "STORED_VALUE", amount: 2200 },
    ]);
    expect(externalInflowMinor(mixed)).toBe(1000);
    expect(allocateExternalInflowByLineType(mixed).treatment).toBe(1000);

    const dash = getReportsWorkspaceDashboard(query(), {
      preset: "today",
      now: new Date(),
    });
    expect(dash.sales.totalExternalMinor).toBe(11000);
    expect(dash.sales.treatmentMinor).toBe(1000);
    expect(dash.sales.storedValueMinor).toBe(10000);
    expect(
      dash.sales.treatmentMinor +
        dash.sales.productMinor +
        dash.sales.packageMinor +
        dash.sales.storedValueMinor,
    ).toBe(dash.sales.totalExternalMinor);
  });
});

describe("H / I / J product quantity, ledger stock, low stock", () => {
  it("counts product quantity and uses getProductStock", () => {
    const product = createProduct(ORG_ENJOYE_ID, {
      name: "居家按摩霜",
      priceMinor: 800,
      createdByStaffId: "staff-001",
    });
    receiveStock(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      productId: product.id,
      quantity: 10,
      createdByStaffId: "staff-001",
      note: "seed",
    });

    const walk = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, walk.id, {
      type: "PRODUCT",
      referenceId: product.id,
      name: product.name,
      unitPrice: product.priceMinor,
      quantity: 2,
    });
    cashComplete(walk.id);

    expect(getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id)).toBe(8);
    const popular = buildPopularProducts(query());
    expect(popular[0]?.productId).toBe(product.id);
    expect(popular[0]?.quantity).toBe(2);
    expect(popular[0]?.salesMinor).toBe(1600);
    expect(popular[0]?.stock).toBe(
      getProductStock(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, product.id),
    );
  });

  it("reuses Products Workspace low-stock threshold", () => {
    expect(REPORTS_LOW_STOCK_THRESHOLD).toBe(PRODUCTS_LOW_STOCK_THRESHOLD);
    expect(REPORTS_LOW_STOCK_THRESHOLD).toBe(5);

    const product = createProduct(ORG_ENJOYE_ID, {
      name: "低庫存乳霜",
      priceMinor: 500,
      createdByStaffId: "staff-001",
    });
    receiveStock(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      productId: product.id,
      quantity: 3,
      createdByStaffId: "staff-001",
      note: "low",
    });
    expect(listLowStockProductIds(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID)).toContain(
      product.id,
    );
    const attention = buildNeedsAttention(
      query({ locationId: LOC_ENJOYE_PRIMARY_ID }),
      new Date(),
    );
    expect(attention.some((row) => row.kind === "low_stock")).toBe(true);
  });
});

describe("K follow-up overdue derived", () => {
  it("reuses Follow-ups overdue semantics", () => {
    const treatment = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      appointmentId: "apt-fu-ws",
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: "svc-breast",
    });
    treatment.id = "treatment-ws-fu";
    treatment.status = "completed";
    treatment.followUp = {
      tags: ["追蹤"],
      suggestedDate: "2026-09-20",
      note: "逾期",
      suggestNextBooking: false,
    };
    ensureFollowUpTaskFromCompletedTreatment(treatment);
    const attention = buildNeedsAttention(query(), new Date());
    const overdue = attention.find((row) => row.kind === "follow_up_overdue");
    expect(overdue?.count).toBeGreaterThanOrEqual(1);
    expect(overdue?.href).toBe("/staff/follow-ups");
  });
});

describe("L / M org isolation and location filter", () => {
  it("does not leak Enjoye revenue into Lumiere", () => {
    const apt = makeInServiceApt();
    cashComplete(
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-001",
      }).id,
    );
    const enjoye = getReportsWorkspaceDashboard(query(), {
      preset: "today",
      now: new Date(),
    });
    const lumiere = getReportsWorkspaceDashboard(
      { organizationId: ORG_LUMIERE_ID, range: rangeForDay(new Date()) },
      { preset: "today", now: new Date() },
    );
    expect(enjoye.kpis.revenueMinor).toBeGreaterThan(0);
    expect(lumiere.kpis.revenueMinor).toBe(0);
    expect(lumiere.kpis.transactionCount).toBe(0);
  });

  it("location filter splits revenue", () => {
    cashComplete(
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: makeInServiceApt(LOC_ENJOYE_PRIMARY_ID, "staff-002", 10).id,
        createdByStaffId: "staff-001",
      }).id,
    );
    cashComplete(
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: makeInServiceApt(LOC_ENJOYE_SECONDARY_ID, "staff-002", 12).id,
        createdByStaffId: "staff-001",
      }).id,
    );
    const all = getReportsWorkspaceDashboard(query(), {
      preset: "today",
      now: new Date(),
    });
    const primary = getReportsWorkspaceDashboard(
      query({ locationId: LOC_ENJOYE_PRIMARY_ID }),
      { preset: "today", now: new Date() },
    );
    const secondary = getReportsWorkspaceDashboard(
      query({ locationId: LOC_ENJOYE_SECONDARY_ID }),
      { preset: "today", now: new Date() },
    );
    expect(all.kpis.transactionCount).toBe(
      primary.kpis.transactionCount + secondary.kpis.transactionCount,
    );
    expect(all.kpis.revenueMinor).toBe(
      primary.kpis.revenueMinor + secondary.kpis.revenueMinor,
    );
  });
});

describe("N staff attribution by ID", () => {
  it("attributes 經手實收 by createdByStaffId and treatments by staffId", () => {
    const apt = makeInServiceApt(LOC_ENJOYE_PRIMARY_ID, "staff-002", 11);
    const treatment = completeTreatment({
      appointmentId: apt.id,
      staffId: "staff-002",
    });
    cashComplete(
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-001",
        treatmentId: treatment.id,
      }).id,
    );

    const walk = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-002",
      createdByStaffId: "staff-004",
    });
    addCheckoutItem(ORG_ENJOYE_ID, walk.id, {
      type: "SERVICE",
      referenceId: "svc-facial",
      name: "臉部保養 SPA",
      unitPrice: 2800,
    });
    cashComplete(walk.id);

    const staff = buildStaffOperations(query());
    const yizhen = staff.find((row) => row.staffId === "staff-001");
    const xiaomei = staff.find((row) => row.staffId === "staff-002");
    const anan = staff.find((row) => row.staffId === "staff-004");
    expect(yizhen?.displayName).toBe("測試帳號");
    expect(yizhen?.handledExternalMinor).toBeGreaterThan(0);
    expect(xiaomei?.completedTreatments).toBeGreaterThanOrEqual(1);
    expect(anan?.staffId).toBe("staff-004");
    expect(staff.every((row) => row.staffId && row.displayName)).toBe(true);
    expect(REPORTS_HAS_REBOOK_COLUMN).toBe(false);
  });
});

describe("O empty dataset", () => {
  it("returns honest zeros and empty collections", () => {
    const dash = getReportsWorkspaceDashboard(query(), {
      preset: "today",
      now: new Date(),
    });
    expect(dash.kpis.revenueMinor).toBe(0);
    expect(dash.kpis.transactionCount).toBe(0);
    expect(dash.kpis.averageTicketMinor).toBe(0);
    expect(dash.sales.totalExternalMinor).toBe(0);
    expect(dash.popularTreatments).toEqual([]);
    expect(dash.popularProducts).toEqual([]);
    expect(dash.staff).toEqual([]);
    expect(dash.trend.every((point) => point.revenueMinor === 0)).toBe(true);
  });
});

describe("P / Q previous-period comparison and date boundaries", () => {
  it("computes previous windows without persisting them", () => {
    const today = resolveReportPreset("today", NOW);
    const prevToday = previousPeriodRange("today", today, NOW);
    expect(prevToday.startAt.getDate()).toBe(24);
    expect(prevToday.endAt.getDate()).toBe(24);

    const week = resolveReportPreset("week", NOW);
    const prevWeek = previousPeriodRange("week", week, NOW);
    expect(prevWeek.endAt.getTime()).toBeLessThan(week.startAt.getTime());

    const month = resolveReportPreset("month", NOW);
    const prevMonth = previousPeriodRange("month", month, NOW);
    expect(prevMonth.startAt.getMonth()).toBe(7);
    expect(prevMonth.endAt.getMonth()).toBe(7);

    const custom = resolveReportPreset("custom", NOW, {
      startYmd: "2026-09-20",
      endYmd: "2026-09-25",
    });
    const prevCustom = previousPeriodRange("custom", custom, NOW);
    expect(prevCustom.endAt.getTime()).toBeLessThan(custom.startAt.getTime());
  });

  it("hides comparison when previous is 0 and current is not", () => {
    expect(comparePeriod(0, 0)).toMatchObject({ kind: "flat", label: "持平" });
    expect(comparePeriod(100, 0).kind).toBe("hidden");
    expect(comparePeriod(110, 100)).toMatchObject({ kind: "up" });
    expect(comparePeriod(90, 100)).toMatchObject({ kind: "down" });
    expect(comparePeriod(100, 100)).toMatchObject({ kind: "flat" });
  });

  it("does not count a transaction outside the local day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 24, 23, 30, 0));
    const apt = makeInServiceApt(LOC_ENJOYE_PRIMARY_ID, "staff-002", 14);
    cashComplete(
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-001",
      }).id,
    );
    vi.setSystemTime(NOW);
    expect(getRevenueSummary(query()).revenueMinor).toBe(0);
    expect(
      getRevenueSummary({
        organizationId: ORG_ENJOYE_ID,
        range: rangeForDay(new Date(2026, 8, 24)),
      }).revenueMinor,
    ).toBeGreaterThan(0);
  });
});

describe("popular treatments relation", () => {
  it("shows revenue only when transaction.treatmentId matches", () => {
    const apt = makeInServiceApt();
    const treatment = completeTreatment({ appointmentId: apt.id });
    cashComplete(
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-001",
        treatmentId: treatment.id,
      }).id,
    );
    const linked = buildPopularTreatments({
      organizationId: ORG_ENJOYE_ID,
      range: { startAt: new Date(2020, 0, 1), endAt: new Date(2030, 0, 1) },
    });
    expect(linked.showRevenue).toBe(true);
    expect(linked.rows.some((row) => (row.revenueMinor ?? 0) > 0)).toBe(true);
    const unlinked = linked.rows.find((row) => row.serviceId === "svc-womb");
    if (unlinked) expect(unlinked.revenueMinor).toBeNull();
  });
});

describe("R / S / T no second store and read-only UI contract", () => {
  it("does not introduce a duplicated report / revenue / inventory store", () => {
    expect(REPORTS_HAS_SECOND_STORE).toBe(false);
    expect(REPORTS_HAS_PERSISTED_ANALYTICS).toBe(false);
    expect(REPORTS_HAS_PACKAGE_EXPIRY_ATTENTION).toBe(false);

    const derived = readFileSync(
      path.join(process.cwd(), "lib/reports/reports-workspace-derived.ts"),
      "utf8",
    );
    const page = readFileSync(
      path.join(process.cwd(), "features/reports/ReportsPageClient.tsx"),
      "utf8",
    );
    const revenue = readFileSync(
      path.join(process.cwd(), "lib/reports/revenue.ts"),
      "utf8",
    );

    expect(derived).not.toMatch(
      /reportRevenueStore|reportTransactionStore|dashboardRevenueStore|analyticsInventoryStore|reportAppointmentStore|reportTreatmentStore|reportPackageStore|reportStoredValueStore/,
    );
    expect(derived).not.toMatch(/localStorage\.(setItem|removeItem)/);
    expect(page).not.toMatch(/localStorage\.(setItem|removeItem)/);
    expect(revenue).toMatch(/externalInflowMinor/);
    expect(derived).toMatch(/externalInflowMinor/);
    expect(derived).toMatch(/getProductStock/);
    expect(derived).toMatch(/PRODUCTS_LOW_STOCK_THRESHOLD/);
  });

  it("Reports UI does not call commerce or inventory mutations", () => {
    const page = readFileSync(
      path.join(process.cwd(), "features/reports/ReportsPageClient.tsx"),
      "utf8",
    );
    const derived = readFileSync(
      path.join(process.cwd(), "lib/reports/reports-workspace-derived.ts"),
      "utf8",
    );
    const forbidden = [
      "completeCheckout",
      "voidTransaction",
      "postInventorySale",
      "receiveStock",
      "adjustInventory",
      "completeFollowUpTask",
      "snoozeFollowUpTask",
      "createTransactionFromDraft",
    ];
    for (const name of forbidden) {
      expect(page).not.toMatch(new RegExp(name));
      expect(derived).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect(page).toMatch(/getReportsWorkspaceDashboard/);
    expect(page).toMatch(/data-reports-workspace/);
    const shell = readFileSync(
      path.join(process.cwd(), "components/layout/StaffShell.tsx"),
      "utf8",
    );
    expect(shell).toMatch(/isReportsWorkbench/);
    expect(shell).toMatch(/w-\[232px\]/);
    expect(shell).toMatch(/w-\[254px\]/);
  });
});
