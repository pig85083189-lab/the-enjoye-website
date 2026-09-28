import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import {
  DEFAULT_SERVICE_PRICE_MINOR,
  type CheckoutDraft,
  type PaymentDraft,
  type Transaction,
} from "@/lib/commerce/domain";
import {
  buildCheckoutWorkspaceItems,
  canConfirmCheckoutPayment,
  checkoutListPresentation,
  checkoutRemainingDue,
  checkoutRowId,
  checkoutVisitCountLabel,
  CHECKOUT_INLINE_MIN_PX,
  CHECKOUT_PANEL_WIDTH_PX,
  CHECKOUT_WORKSPACE_GAP_PX,
  countCheckoutSummary,
  deriveCheckoutRowStatus,
  filterCheckoutItems,
  isCheckoutEligibleStatus,
  isCheckoutRowKeyboardActivation,
  isInlineCheckoutPanelViewport,
  isMixedPaymentComplete,
  isMutedCheckoutAppointmentStatus,
  lookupServicePriceMinor,
  mixedPaymentRemaining,
  packageRedemptionDiscountMinor,
  parseCheckoutRowId,
  promotionDiscountMinor,
  resolveSelectedCheckout,
  remapCheckoutSelection,
  shouldRenderCheckoutPanel,
  shouldResetCheckoutSelection,
  storedValuePaymentMinor,
  type CheckoutCatalogHint,
  type CheckoutWorkspaceItem,
} from "@/lib/commerce/checkout-workspace-derived";
import type { Customer } from "@/types";

const NOW = new Date(2026, 8, 28, 14, 30, 0);
const ORG = "org-the-enjoye";
const LOC = "loc-enjoye-main";

const catalog: CheckoutCatalogHint[] = [
  {
    id: "svc-breast",
    name: "性感美胸 SPA",
    durationMinutes: 100,
    serviceType: "BREAST",
    category: "美胸",
    priceMinor: 3200,
  },
  {
    id: "svc-facial",
    name: "臉部保養 SPA",
    durationMinutes: 90,
    serviceType: "FACIAL",
    category: "臉部",
    priceMinor: 2800,
  },
  {
    id: "svc-unpriced",
    name: "未標價服務",
    durationMinutes: 60,
    category: "其他",
  },
];

function customer(
  partial: Partial<Customer> & Pick<Customer, "id" | "name">,
): Customer {
  return {
    organizationId: ORG,
    phone: "",
    birthday: "",
    age: 0,
    membership: "regular",
    lastVisit: "",
    totalVisits: 0,
    packages: [],
    lastServiceNotes: [],
    trackingFocus: [],
    alerts: [],
    tags: [],
    joinedAt: "",
    createdAt: "2025-01-01T00:00:00+08:00",
    updatedAt: "2026-09-01T00:00:00+08:00",
    ...partial,
  };
}

function apt(
  partial: Partial<ScheduleAppointment> &
    Pick<ScheduleAppointment, "id" | "startAt" | "endAt" | "status">,
): ScheduleAppointment {
  return {
    organizationId: ORG,
    locationId: LOC,
    customerId: "c-1",
    customerName: "林雅婷",
    serviceId: "svc-breast",
    serviceName: "性感美胸 SPA",
    staffId: "staff-001",
    staffName: "怡蓁",
    durationMinutes: 100,
    notes: [],
    createdAt: "2026-09-28T00:00:00+08:00",
    updatedAt: "2026-09-28T00:00:00+08:00",
    ...partial,
  };
}

function draft(
  partial: Partial<CheckoutDraft> & Pick<CheckoutDraft, "id" | "customerId">,
): CheckoutDraft {
  return {
    organizationId: ORG,
    locationId: LOC,
    items: [],
    discounts: [],
    payments: [],
    subtotal: 0,
    discountTotal: 0,
    total: 0,
    currency: "TWD",
    status: "OPEN",
    createdByStaffId: "staff-001",
    createdAt: "2026-09-28T10:00:00+08:00",
    updatedAt: "2026-09-28T10:00:00+08:00",
    ...partial,
  };
}

function tx(
  partial: Partial<Transaction> & Pick<Transaction, "id" | "customerId">,
): Transaction {
  return {
    organizationId: ORG,
    locationId: LOC,
    items: [
      {
        id: "ti-1",
        type: "SERVICE",
        referenceId: "svc-breast",
        nameSnapshot: "性感美胸 SPA",
        unitPrice: 3200,
        quantity: 1,
        lineSubtotal: 3200,
        discountAmount: 0,
        lineTotal: 3200,
      },
    ],
    discounts: [],
    payments: [
      {
        id: "pay-1",
        method: "CASH",
        amount: 3200,
        paidAt: "2026-09-28T16:00:00+08:00",
      },
    ],
    subtotal: 3200,
    discountTotal: 0,
    total: 3200,
    currency: "TWD",
    status: "COMPLETED",
    transactionNumber: "TX-20260928-0001",
    createdByStaffId: "staff-001",
    completedAt: "2026-09-28T16:00:00+08:00",
    ...partial,
  };
}

const lin = customer({
  id: "c-1",
  name: "林雅婷",
  phone: "0912-111-222",
  membership: "vip",
  totalVisits: 8,
});
const li = customer({
  id: "c-2",
  name: "李心柔",
  phone: "0922-333-444",
  membership: "new",
  totalVisits: 1,
});

const completedToday = apt({
  id: "apt-completed",
  startAt: "2026-09-28T10:00:00+08:00",
  endAt: "2026-09-28T11:40:00+08:00",
  status: "COMPLETED",
});
const inServiceToday = apt({
  id: "apt-inservice",
  customerId: "c-2",
  customerName: "李心柔",
  serviceId: "svc-facial",
  serviceName: "臉部保養 SPA",
  durationMinutes: 90,
  startAt: "2026-09-28T14:00:00+08:00",
  endAt: "2026-09-28T15:30:00+08:00",
  status: "IN_SERVICE",
});
const cancelledToday = apt({
  id: "apt-cancelled",
  startAt: "2026-09-28T09:00:00+08:00",
  endAt: "2026-09-28T10:00:00+08:00",
  status: "CANCELLED",
});
const noShowToday = apt({
  id: "apt-noshow",
  startAt: "2026-09-28T11:00:00+08:00",
  endAt: "2026-09-28T12:00:00+08:00",
  status: "NO_SHOW",
});
const bookedToday = apt({
  id: "apt-booked",
  startAt: "2026-09-28T18:00:00+08:00",
  endAt: "2026-09-28T19:40:00+08:00",
  status: "BOOKED",
});
const yesterdayCompleted = apt({
  id: "apt-yesterday",
  startAt: "2026-09-27T10:00:00+08:00",
  endAt: "2026-09-27T11:40:00+08:00",
  status: "COMPLETED",
});

describe("checkout eligibility", () => {
  it("treats IN_SERVICE and COMPLETED as eligible", () => {
    expect(isCheckoutEligibleStatus("IN_SERVICE")).toBe(true);
    expect(isCheckoutEligibleStatus("COMPLETED")).toBe(true);
    expect(isCheckoutEligibleStatus("BOOKED")).toBe(false);
    expect(isCheckoutEligibleStatus("ARRIVED")).toBe(false);
    expect(isCheckoutEligibleStatus("CONFIRMED")).toBe(false);
  });

  it("excludes cancelled, no-show, and draft from checkout lists", () => {
    expect(isMutedCheckoutAppointmentStatus("CANCELLED")).toBe(true);
    expect(isMutedCheckoutAppointmentStatus("NO_SHOW")).toBe(true);
    expect(isMutedCheckoutAppointmentStatus("DRAFT")).toBe(true);
    expect(isMutedCheckoutAppointmentStatus("COMPLETED")).toBe(false);

    const items = buildCheckoutWorkspaceItems({
      appointments: [
        completedToday,
        inServiceToday,
        cancelledToday,
        noShowToday,
        bookedToday,
      ],
      transactions: [],
      openDrafts: [],
      customers: [lin, li],
      catalog,
    });
    const ids = items.map((item) => item.appointmentId);
    expect(ids).toContain("apt-completed");
    expect(ids).toContain("apt-inservice");
    expect(ids).not.toContain("apt-cancelled");
    expect(ids).not.toContain("apt-noshow");
    expect(ids).not.toContain("apt-booked");
  });
});

describe("summary derived", () => {
  it("counts pending, completed service, in-service, and today revenue from real rows", () => {
    const paid = tx({
      id: "tx-1",
      customerId: "c-1",
      appointmentId: "apt-paid",
      completedAt: "2026-09-28T16:10:00+08:00",
      total: 3200,
    });
    const paidApt = apt({
      id: "apt-paid",
      startAt: "2026-09-28T08:00:00+08:00",
      endAt: "2026-09-28T09:40:00+08:00",
      status: "COMPLETED",
    });
    const items = buildCheckoutWorkspaceItems({
      appointments: [completedToday, inServiceToday, paidApt],
      transactions: [paid],
      openDrafts: [],
      customers: [lin, li],
      catalog,
    });
    const summary = countCheckoutSummary(
      items,
      [completedToday, inServiceToday, paidApt],
      NOW,
    );
    expect(summary.pending).toBe(2);
    expect(summary.completedService).toBe(2);
    expect(summary.inService).toBe(1);
    expect(summary.todayRevenueMinor).toBe(3200);
  });

  it("reports NT$0 today revenue when no completed transactions exist", () => {
    const items = buildCheckoutWorkspaceItems({
      appointments: [completedToday],
      transactions: [],
      openDrafts: [],
      customers: [lin],
      catalog,
    });
    expect(countCheckoutSummary(items, [completedToday], NOW).todayRevenueMinor).toBe(
      0,
    );
  });
});

describe("selected id lookup and lifecycle", () => {
  it("parses checkout row ids", () => {
    expect(checkoutRowId("appointment", "apt-1")).toBe("appointment:apt-1");
    expect(parseCheckoutRowId("draft:chk-1")).toEqual({
      kind: "draft",
      entityId: "chk-1",
    });
    expect(parseCheckoutRowId("transaction:tx-1")?.kind).toBe("transaction");
    expect(parseCheckoutRowId(null)).toBeNull();
    expect(parseCheckoutRowId("bad")).toBeNull();
  });

  it("looks up selected id and survives a rerender of the same list", () => {
    const items = buildCheckoutWorkspaceItems({
      appointments: [completedToday, inServiceToday],
      transactions: [],
      openDrafts: [],
      customers: [lin, li],
      catalog,
    });
    const selectedId = checkoutRowId("appointment", "apt-completed");
    const first = resolveSelectedCheckout(items, selectedId);
    const rerendered = resolveSelectedCheckout([...items], selectedId);
    expect(first?.customerName).toBe("林雅婷");
    expect(rerendered?.id).toBe(first?.id);
    expect(shouldResetCheckoutSelection({ selectedId, visibleItems: items })).toBe(
      false,
    );
    expect(shouldRenderCheckoutPanel(first)).toBe(true);
    expect(shouldRenderCheckoutPanel(null)).toBe(false);
    expect(
      remapCheckoutSelection(items, checkoutRowId("appointment", "apt-completed")),
    ).toBe(selectedId);
  });

  it("resets selection when filters hide the selected row", () => {
    const items = buildCheckoutWorkspaceItems({
      appointments: [completedToday, inServiceToday],
      transactions: [
        tx({
          id: "tx-1",
          customerId: "c-1",
          appointmentId: "apt-paid",
          completedAt: "2026-09-28T16:00:00+08:00",
        }),
      ],
      openDrafts: [],
      customers: [lin, li],
      catalog,
    });
    const selectedId = checkoutRowId("appointment", "apt-completed");
    const paidOnly = filterCheckoutItems(items, "paid", "", "today", NOW);
    expect(shouldResetCheckoutSelection({ selectedId, visibleItems: paidOnly })).toBe(
      true,
    );
    const pending = filterCheckoutItems(items, "pending", "", "today", NOW);
    expect(
      shouldResetCheckoutSelection({ selectedId, visibleItems: pending }),
    ).toBe(false);
  });
});

describe("status and filters", () => {
  it("derives pending / in-service / paid labels from domain", () => {
    expect(
      deriveCheckoutRowStatus({ kind: "appointment", appointmentStatus: "COMPLETED", paid: false }),
    ).toEqual({ kind: "pending", title: "待結帳" });
    expect(
      deriveCheckoutRowStatus({
        kind: "appointment",
        appointmentStatus: "IN_SERVICE",
        paid: false,
      }),
    ).toEqual({ kind: "in_service", title: "服務中" });
    expect(deriveCheckoutRowStatus({ kind: "transaction", paid: true })).toEqual({
      kind: "paid",
      title: "已結帳",
    });
  });

  it("search matches customer, service, and staff", () => {
    const items = buildCheckoutWorkspaceItems({
      appointments: [completedToday, inServiceToday],
      transactions: [],
      openDrafts: [],
      customers: [lin, li],
      catalog,
    });
    expect(filterCheckoutItems(items, "all", "心柔", "today", NOW)).toHaveLength(1);
    expect(filterCheckoutItems(items, "all", "美胸", "today", NOW)).toHaveLength(1);
    expect(filterCheckoutItems(items, "all", "怡蓁", "today", NOW).length).toBeGreaterThan(0);
    expect(filterCheckoutItems(items, "all", "不存在", "today", NOW)).toHaveLength(0);
  });

  it("date filter today excludes yesterday appointments", () => {
    const items = buildCheckoutWorkspaceItems({
      appointments: [completedToday, yesterdayCompleted],
      transactions: [],
      openDrafts: [],
      customers: [lin],
      catalog,
    });
    expect(filterCheckoutItems(items, "all", "", "today", NOW)).toHaveLength(1);
    expect(filterCheckoutItems(items, "all", "", "7d", NOW)).toHaveLength(2);
    expect(filterCheckoutItems(items, "all", "", "all", NOW)).toHaveLength(2);
  });
});

describe("amount / discount / package / stored value", () => {
  it("uses catalog price, then draft total, never invents named SKUs", () => {
    expect(lookupServicePriceMinor(catalog, "svc-breast")).toBe(3200);
    expect(lookupServicePriceMinor(catalog, "svc-unpriced")).toBe(
      DEFAULT_SERVICE_PRICE_MINOR,
    );
    expect(lookupServicePriceMinor(catalog, "missing")).toBeNull();

    const withDraft = buildCheckoutWorkspaceItems({
      appointments: [completedToday],
      transactions: [],
      openDrafts: [
        draft({
          id: "chk-1",
          customerId: "c-1",
          appointmentId: "apt-completed",
          items: [
            {
              id: "cli-1",
              type: "SERVICE",
              referenceId: "svc-breast",
              nameSnapshot: "性感美胸 SPA",
              unitPrice: 3200,
              quantity: 1,
              lineSubtotal: 3200,
              discountAmount: 300,
              lineTotal: 2900,
            },
          ],
          discounts: [
            {
              id: "d-1",
              type: "ORDER_FIXED",
              value: 300,
              label: "折 NT$300",
            },
          ],
          subtotal: 3200,
          discountTotal: 300,
          total: 2900,
        }),
      ],
      customers: [lin],
      catalog,
    });
    expect(withDraft[0].amountMinor).toBe(2900);
    expect(promotionDiscountMinor(withDraft[0].draft)).toBe(300);
  });

  it("treats package redemption as a line discount, not invented remaining sessions", () => {
    const redeemed = draft({
      id: "chk-pkg",
      customerId: "c-1",
      packageRedemption: {
        customerPackageId: "pkg-1",
        serviceId: "svc-breast",
        sessions: 1,
      },
      items: [
        {
          id: "cli-1",
          type: "SERVICE",
          referenceId: "svc-breast",
          nameSnapshot: "性感美胸 SPA",
          unitPrice: 3200,
          quantity: 1,
          lineSubtotal: 3200,
          discountAmount: 3200,
          lineTotal: 0,
        },
      ],
      subtotal: 3200,
      discountTotal: 3200,
      total: 0,
    });
    expect(packageRedemptionDiscountMinor(redeemed)).toBe(3200);
    expect(canConfirmCheckoutPayment({ itemCount: 1, total: 0, payments: [] })).toBe(
      true,
    );
  });

  it("counts stored-value tender honestly", () => {
    const payments: PaymentDraft[] = [
      { id: "p1", method: "STORED_VALUE", amount: 1000 },
      { id: "p2", method: "CASH", amount: 2200 },
    ];
    expect(storedValuePaymentMinor(payments)).toBe(1000);
    expect(checkoutRemainingDue(3200, payments)).toBe(0);
  });
});

describe("payment validation", () => {
  it("requires items and remaining due of 0", () => {
    expect(canConfirmCheckoutPayment({ itemCount: 0, total: 0, payments: [] })).toBe(
      false,
    );
    expect(
      canConfirmCheckoutPayment({ itemCount: 1, total: 3200, payments: [] }),
    ).toBe(false);
    expect(
      canConfirmCheckoutPayment({
        itemCount: 1,
        total: 3200,
        payments: [{ id: "p1", method: "CASH", amount: 3200 }],
      }),
    ).toBe(true);
    expect(
      canConfirmCheckoutPayment({
        itemCount: 1,
        total: 3200,
        payments: [{ id: "p1", method: "CASH", amount: 3000 }],
      }),
    ).toBe(false);
  });

  it("mixed payment is complete only when remaining is 0", () => {
    expect(mixedPaymentRemaining(3200, { CASH: 1000, CARD: 1200, STORED_VALUE: 1000 })).toBe(
      0,
    );
    expect(isMixedPaymentComplete(3200, { CASH: 1000, CARD: 1200, STORED_VALUE: 1000 })).toBe(
      true,
    );
    expect(isMixedPaymentComplete(3200, { CASH: 1000, CARD: 1000 })).toBe(false);
    expect(mixedPaymentRemaining(2300, { CASH: 2300 })).toBe(0);
  });
});

describe("general sale mapping", () => {
  it("maps walk-in OPEN drafts as pending checkout rows", () => {
    const walkIn = draft({
      id: "chk-walkin",
      customerId: "c-2",
      items: [
        {
          id: "cli-p",
          type: "PRODUCT",
          referenceId: "prod-1",
          nameSnapshot: "居家保養精華",
          unitPrice: 880,
          quantity: 1,
          lineSubtotal: 880,
          discountAmount: 0,
          lineTotal: 880,
        },
      ],
      subtotal: 880,
      total: 880,
    });
    const items = buildCheckoutWorkspaceItems({
      appointments: [],
      transactions: [],
      openDrafts: [walkIn],
      customers: [li],
      catalog,
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("draft");
    expect(items[0].id).toBe("draft:chk-walkin");
    expect(items[0].customerName).toBe("李心柔");
    expect(items[0].serviceName).toBe("居家保養精華");
    expect(items[0].status.title).toBe("待結帳");
    expect(items[0].amountMinor).toBe(880);
  });

  it("labels empty walk-in drafts as 一般銷售", () => {
    const empty = draft({ id: "chk-empty", customerId: "c-1" });
    const items = buildCheckoutWorkspaceItems({
      appointments: [],
      transactions: [],
      openDrafts: [empty],
      customers: [lin],
      catalog,
    });
    expect(items[0].serviceName).toBe("一般銷售");
  });
});

describe("completed transaction status", () => {
  it("does not duplicate a paid appointment as a pending row", () => {
    const paidTx = tx({
      id: "tx-done",
      customerId: "c-1",
      appointmentId: "apt-completed",
      checkoutDraftId: "chk-done",
    });
    const items = buildCheckoutWorkspaceItems({
      appointments: [completedToday],
      transactions: [paidTx],
      openDrafts: [],
      customers: [lin],
      catalog,
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("transaction");
    expect(items[0].paid).toBe(true);
    expect(items[0].status.title).toBe("已結帳");
    expect(items[0].amountMinor).toBe(3200);
  });
});

describe("responsive presentation constants", () => {
  it("keeps desktop inline panel constants and mobile card breakpoint", () => {
    expect(CHECKOUT_PANEL_WIDTH_PX).toBe(400);
    expect(CHECKOUT_INLINE_MIN_PX).toBe(1200);
    expect(CHECKOUT_WORKSPACE_GAP_PX).toBe(16);
    expect(isInlineCheckoutPanelViewport(1536)).toBe(true);
    expect(isInlineCheckoutPanelViewport(1199)).toBe(false);
    expect(checkoutListPresentation(1536)).toBe("desktop-rows");
    expect(checkoutListPresentation(820)).toBe("mobile-cards");
    expect(checkoutListPresentation(390)).toBe("mobile-cards");
  });

  it("activates rows with Enter and Space only", () => {
    expect(isCheckoutRowKeyboardActivation("Enter")).toBe(true);
    expect(isCheckoutRowKeyboardActivation(" ")).toBe(true);
    expect(isCheckoutRowKeyboardActivation("Tab")).toBe(false);
  });

  it("formats visit count only from real totalVisits", () => {
    expect(checkoutVisitCountLabel(8)).toBe("第 8 次來店");
    expect(checkoutVisitCountLabel(0)).toBeNull();
    expect(checkoutVisitCountLabel(undefined)).toBeNull();
  });
});

describe("keyboard / panel render condition typing", () => {
  it("keeps selected item identity as id string, not object equality", () => {
    const items: CheckoutWorkspaceItem[] = buildCheckoutWorkspaceItems({
      appointments: [completedToday],
      transactions: [],
      openDrafts: [],
      customers: [lin],
      catalog,
    });
    const id = items[0].id;
    expect(resolveSelectedCheckout(items, id)?.id).toBe(id);
    expect(resolveSelectedCheckout(items, { ...(items[0] as object) } as never)).toBeNull();
  });
});

describe("architecture source guards", () => {
  it("extends existing commerce instead of a parallel checkout store", () => {
    const derived = readFileSync(
      path.join(process.cwd(), "lib/commerce/checkout-workspace-derived.ts"),
      "utf8",
    );
    const page = readFileSync(
      path.join(process.cwd(), "features/checkout/CheckoutPageClient.tsx"),
      "utf8",
    );
    const panel = readFileSync(
      path.join(process.cwd(), "features/checkout/CheckoutPanel.tsx"),
      "utf8",
    );
    const shell = readFileSync(
      path.join(process.cwd(), "components/layout/StaffShell.tsx"),
      "utf8",
    );
    expect(derived).not.toMatch(/localStorage/);
    expect(page).toMatch(/selectedCheckoutId/);
    expect(page).not.toMatch(/router\.replace\(\s*`\/staff\/checkout/);
    expect(page).toMatch(/createEmptyCheckoutDraft/);
    expect(page).toMatch(/data-checkout-workspace/);
    expect(panel).toMatch(/completeCheckout/);
    expect(panel).toMatch(/ACTIVE_PAYMENT_METHODS/);
    expect(panel).toMatch(/listUsablePackagesForService/);
    expect(panel).toMatch(/getCustomerStoredValueBalance/);
    expect(shell).toMatch(/isCheckoutWorkbench/);
    expect(shell).toMatch(/w-\[254px\]/);
    expect(shell).toMatch(/w-\[232px\]/);
  });
});
