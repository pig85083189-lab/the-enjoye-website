import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Transaction, TransactionItemSnapshot } from "@/lib/commerce/domain";
import {
  TRANSACTIONS_HAS_BALANCE_FIELD,
  TRANSACTIONS_HAS_EXPORT,
  TRANSACTIONS_HAS_PENDING_STATUS,
  TRANSACTIONS_INLINE_MIN_PX,
  TRANSACTIONS_PACKAGE_IS_PAYMENT_METHOD,
  TRANSACTIONS_PANEL_WIDTH_PX,
  TRANSACTIONS_WORKSPACE_GAP_PX,
  buildTransactionWorkspaceRows,
  countTodayPaymentBreakdown,
  countTransactionSummary,
  externalInflowMinor,
  filterTransactionRows,
  filterTransactionsByLocation,
  isInlineTransactionQuickViewViewport,
  isMixedPayment,
  isTransactionRowKeyboardActivation,
  mapTransactionQuickView,
  matchesTransactionSearch,
  packageRedemptionMinor,
  paymentBadgeLabel,
  resolveSelectedTransactionRow,
  shouldRenderTransactionQuickView,
  shouldResetTransactionSelection,
  storedValueTenderMinor,
  summarizeLineItems,
  transactionListPresentation,
  type TransactionWorkspaceRow,
} from "@/lib/commerce/transactions-workspace-derived";
import type { Customer } from "@/types";

const NOW = new Date("2026-09-28T14:30:00+08:00");
const ORG = "org-the-enjoye";
const OTHER_ORG = "org-lumiere";
const LOC = "loc-enjoye-main";
const LOC_B = "loc-enjoye-gongyi";

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

function item(
  partial: Partial<TransactionItemSnapshot> & Pick<TransactionItemSnapshot, "id">,
): TransactionItemSnapshot {
  return {
    type: "SERVICE",
    nameSnapshot: "性感美胸 SPA",
    unitPrice: 3200,
    quantity: 1,
    lineSubtotal: 3200,
    discountAmount: 0,
    lineTotal: 3200,
    ...partial,
  };
}

function tx(
  partial: Partial<Transaction> & Pick<Transaction, "id" | "customerId">,
): Transaction {
  const completedAt = partial.completedAt ?? "2026-09-28T14:35:00+08:00";
  return {
    organizationId: ORG,
    locationId: LOC,
    items: [
      item({
        id: "ti-1",
        referenceId: "svc-breast",
      }),
    ],
    discounts: [],
    payments: [
      {
        id: "pay-1",
        method: "CARD",
        amount: 3200,
        paidAt: completedAt,
      },
    ],
    subtotal: 3200,
    discountTotal: 0,
    total: 3200,
    currency: "TWD",
    status: "COMPLETED",
    transactionNumber: "TX-20260928-0001",
    createdByStaffId: "staff-001",
    completedAt,
    ...partial,
  };
}

const wang = customer({
  id: "c-wang",
  name: "王小美",
  phone: "0912-345-678",
  membership: "vip",
});
const lin = customer({
  id: "c-lin",
  name: "林雅婷",
  phone: "0987-111-222",
});

const catalog = [
  { id: "svc-breast", name: "性感美胸 SPA", durationMinutes: 100, category: "美胸" },
  { id: "svc-facial", name: "臉部保養 SPA", durationMinutes: 90, category: "臉部" },
];

function rows(transactions: Transaction[], extra?: Partial<Parameters<typeof buildTransactionWorkspaceRows>[0]>) {
  return buildTransactionWorkspaceRows({
    organizationId: ORG,
    transactions,
    customers: extra?.customers ?? [wang, lin],
    locations: extra?.locations ?? [
      { id: LOC, name: "主店" },
      { id: LOC_B, name: "公益店" },
    ],
    staff: extra?.staff ?? [{ id: "staff-001", displayName: "怡蓁" }],
    appointments: extra?.appointments ?? [
      { id: "apt-1", staffName: "怡蓁" },
    ],
    catalog,
    ...extra,
  });
}

describe("empty / summary derived rules", () => {
  it("empty summary is NT$0 / 0 筆 semantics", () => {
    const summary = countTransactionSummary([], NOW);
    expect(summary).toEqual({
      todayExternalInflowMinor: 0,
      todayTransactionCount: 0,
      monthExternalInflowMinor: 0,
      voidedCount: 0,
    });
    const breakdown = countTodayPaymentBreakdown([], NOW);
    expect(breakdown.external.every((row) => row.amountMinor === 0 && row.count === 0)).toBe(
      true,
    );
    expect(breakdown.nonCash.every((row) => row.amountMinor === 0 && row.count === 0)).toBe(
      true,
    );
  });

  it("counts today completed transactions and external inflow", () => {
    const built = rows([
      tx({ id: "t-today", customerId: "c-wang", appointmentId: "apt-1" }),
      tx({
        id: "t-yesterday",
        customerId: "c-lin",
        transactionNumber: "TX-20260927-0001",
        completedAt: "2026-09-27T11:00:00+08:00",
        payments: [
          { id: "p", method: "CASH", amount: 2800, paidAt: "2026-09-27T11:00:00+08:00" },
        ],
        total: 2800,
        subtotal: 2800,
      }),
    ]);
    const summary = countTransactionSummary(built, NOW);
    expect(summary.todayTransactionCount).toBe(1);
    expect(summary.todayExternalInflowMinor).toBe(3200);
  });

  it("counts month external inflow across days in the same month", () => {
    const built = rows([
      tx({ id: "t-today", customerId: "c-wang" }),
      tx({
        id: "t-earlier-month",
        customerId: "c-lin",
        completedAt: "2026-09-02T09:00:00+08:00",
        payments: [
          { id: "p", method: "TRANSFER", amount: 5000, paidAt: "2026-09-02T09:00:00+08:00" },
        ],
        total: 5000,
        subtotal: 5000,
      }),
      tx({
        id: "t-last-month",
        customerId: "c-lin",
        completedAt: "2026-08-31T18:00:00+08:00",
        payments: [
          { id: "p", method: "CASH", amount: 9999, paidAt: "2026-08-31T18:00:00+08:00" },
        ],
        total: 9999,
        subtotal: 9999,
      }),
    ]);
    expect(countTransactionSummary(built, NOW).monthExternalInflowMinor).toBe(8200);
  });
});

describe("status / search / date / payment filters", () => {
  const built = rows([
    tx({ id: "t-done", customerId: "c-wang", appointmentId: "apt-1" }),
    tx({
      id: "t-void",
      customerId: "c-lin",
      status: "VOIDED",
      voidedAt: "2026-09-28T16:00:00+08:00",
      transactionNumber: "TX-20260928-0002",
      payments: [
        { id: "p", method: "CASH", amount: 1500, paidAt: "2026-09-28T10:00:00+08:00" },
      ],
      total: 1500,
      subtotal: 1500,
      completedAt: "2026-09-28T10:00:00+08:00",
    }),
  ]);

  it("filters completed", () => {
    const visible = filterTransactionRows(built, {
      status: "COMPLETED",
      query: "",
      date: "all",
      payment: "all",
      now: NOW,
    });
    expect(visible.map((row) => row.transactionId)).toEqual(["t-done"]);
  });

  it("filters voided", () => {
    const visible = filterTransactionRows(built, {
      status: "VOIDED",
      query: "",
      date: "all",
      payment: "all",
      now: NOW,
    });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.status.kind).toBe("VOIDED");
    expect(countTransactionSummary(built, NOW).voidedCount).toBe(1);
  });

  it("searches customer name", () => {
    expect(matchesTransactionSearch(built[0], "王小")).toBe(true);
    const visible = filterTransactionRows(built, {
      status: "all",
      query: "王小美",
      date: "all",
      payment: "all",
      now: NOW,
    });
    expect(visible.map((row) => row.customerName)).toEqual(["王小美"]);
  });

  it("searches phone", () => {
    const visible = filterTransactionRows(built, {
      status: "all",
      query: "0987-111",
      date: "all",
      payment: "all",
      now: NOW,
    });
    expect(visible[0]?.customerId).toBe("c-lin");
  });

  it("searches transaction id and number", () => {
    expect(
      filterTransactionRows(built, {
        status: "all",
        query: "t-done",
        date: "all",
        payment: "all",
        now: NOW,
      })[0]?.transactionId,
    ).toBe("t-done");
    expect(
      filterTransactionRows(built, {
        status: "all",
        query: "TX-20260928-0002",
        date: "all",
        payment: "all",
        now: NOW,
      })[0]?.transactionId,
    ).toBe("t-void");
  });

  it("filters by date presets", () => {
    const dated = rows([
      tx({ id: "today", customerId: "c-wang" }),
      tx({
        id: "yesterday",
        customerId: "c-lin",
        completedAt: "2026-09-27T12:00:00+08:00",
      }),
      tx({
        id: "last-week",
        customerId: "c-lin",
        completedAt: "2026-09-20T12:00:00+08:00",
      }),
    ]);
    expect(
      filterTransactionRows(dated, {
        status: "all",
        query: "",
        date: "today",
        payment: "all",
        now: NOW,
      }).map((row) => row.transactionId),
    ).toEqual(["today"]);
    expect(
      filterTransactionRows(dated, {
        status: "all",
        query: "",
        date: "yesterday",
        payment: "all",
        now: NOW,
      }).map((row) => row.transactionId),
    ).toEqual(["yesterday"]);
    expect(
      filterTransactionRows(dated, {
        status: "all",
        query: "",
        date: "7d",
        payment: "all",
        now: NOW,
      }).map((row) => row.transactionId),
    ).toEqual(["today", "yesterday"]);
    expect(
      filterTransactionRows(dated, {
        status: "all",
        query: "",
        date: "month",
        payment: "all",
        now: NOW,
      }).map((row) => row.transactionId),
    ).toEqual(["today", "yesterday", "last-week"]);
  });

  it("filters by payment method", () => {
    const mixed = rows([
      tx({ id: "card", customerId: "c-wang" }),
      tx({
        id: "cash",
        customerId: "c-lin",
        payments: [
          { id: "p", method: "CASH", amount: 3200, paidAt: "2026-09-28T14:35:00+08:00" },
        ],
      }),
    ]);
    expect(
      filterTransactionRows(mixed, {
        status: "all",
        query: "",
        date: "all",
        payment: "CASH",
        now: NOW,
      }).map((row) => row.transactionId),
    ).toEqual(["cash"]);
  });
});

describe("mixed payment / line items / totals", () => {
  it("labels mixed payment without inventing a new method", () => {
    const mixed = tx({
      id: "t-mix",
      customerId: "c-wang",
      payments: [
        { id: "p1", method: "CASH", amount: 1000, paidAt: "2026-09-28T14:35:00+08:00" },
        { id: "p2", method: "CARD", amount: 2200, paidAt: "2026-09-28T14:35:00+08:00" },
      ],
    });
    expect(isMixedPayment(mixed.payments)).toBe(true);
    expect(paymentBadgeLabel(mixed.payments)).toBe("混合付款");
    const row = rows([mixed])[0];
    expect(row.mixedPayment).toBe(true);
    expect(row.paymentBadge).toBe("混合付款");
    expect(row.totalMinor).toBe(3200);
    expect(row.externalInflowMinor).toBe(3200);
  });

  it("summarizes line items as first name + extra count", () => {
    expect(summarizeLineItems([]).label).toBe("一般銷售");
    expect(
      summarizeLineItems([item({ id: "a", nameSnapshot: "性感美胸 SPA" })]).label,
    ).toBe("性感美胸 SPA");
    expect(
      summarizeLineItems([
        item({ id: "a", nameSnapshot: "性感美胸 SPA" }),
        item({
          id: "b",
          type: "PRODUCT",
          nameSnapshot: "保養乳",
          unitPrice: 800,
          lineSubtotal: 800,
          lineTotal: 800,
        }),
        item({
          id: "c",
          type: "CUSTOM",
          nameSnapshot: "加時",
          unitPrice: 500,
          lineSubtotal: 500,
          lineTotal: 500,
        }),
      ]).label,
    ).toBe("性感美胸 SPA + 2 項");
  });

  it("maps quick view totals from transaction fields only", () => {
    const built = rows([
      tx({
        id: "t-promo",
        customerId: "c-wang",
        appointmentId: "apt-1",
        items: [
          item({ id: "ti-1", referenceId: "svc-breast" }),
          item({
            id: "ti-2",
            type: "PRODUCT",
            nameSnapshot: "保養乳",
            unitPrice: 800,
            lineSubtotal: 800,
            lineTotal: 800,
          }),
        ],
        discounts: [
          {
            id: "d1",
            type: "ORDER_FIXED",
            value: 200,
            label: "店長折扣",
            amountApplied: 200,
          },
        ],
        discountTotal: 200,
        subtotal: 4000,
        total: 3800,
        payments: [
          { id: "p", method: "TRANSFER", amount: 3800, paidAt: "2026-09-28T14:35:00+08:00" },
        ],
      }),
    ]);
    const view = mapTransactionQuickView(built[0], catalog);
    expect(view.subtotalMinor).toBe(4000);
    expect(view.promotionDiscountMinor).toBe(200);
    expect(view.packageRedemptionMinor).toBe(0);
    expect(view.totalMinor).toBe(3800);
    expect(view.lineItems[0]?.durationMinutes).toBe(100);
    expect(view.lineItems[1]?.durationMinutes).toBeNull();
    expect(view.cashierName).toBe("怡蓁");
    expect(view.beauticianName).toBe("怡蓁");
    expect(view.locationName).toBe("主店");
  });
});

describe("revenue / cash-in semantics", () => {
  it("does not count stored-value spend as external cash inflow", () => {
    const topUp = tx({
      id: "t-topup",
      customerId: "c-wang",
      items: [
        item({
          id: "ti-sv",
          type: "STORED_VALUE_TOP_UP",
          nameSnapshot: "儲值金",
          unitPrice: 10000,
          lineSubtotal: 10000,
          lineTotal: 10000,
        }),
      ],
      subtotal: 10000,
      total: 10000,
      payments: [
        { id: "p", method: "CASH", amount: 10000, paidAt: "2026-09-28T10:00:00+08:00" },
      ],
      completedAt: "2026-09-28T10:00:00+08:00",
    });
    const spend = tx({
      id: "t-spend",
      customerId: "c-wang",
      payments: [
        {
          id: "p",
          method: "STORED_VALUE",
          amount: 3200,
          paidAt: "2026-09-28T14:35:00+08:00",
        },
      ],
    });
    expect(externalInflowMinor(topUp)).toBe(10000);
    expect(externalInflowMinor(spend)).toBe(0);
    expect(storedValueTenderMinor(spend)).toBe(3200);
    const summary = countTransactionSummary(rows([topUp, spend]), NOW);
    expect(summary.todayExternalInflowMinor).toBe(10000);
    expect(summary.todayTransactionCount).toBe(2);
    const breakdown = countTodayPaymentBreakdown(rows([topUp, spend]), NOW);
    expect(breakdown.external.find((row) => row.method === "CASH")?.amountMinor).toBe(10000);
    expect(breakdown.nonCash.find((row) => row.method === "STORED_VALUE")?.amountMinor).toBe(
      3200,
    );
  });

  it("treats package redemption as line discount, not a payment method", () => {
    const redeemed = tx({
      id: "t-pkg",
      customerId: "c-wang",
      packageRedemption: {
        customerPackageId: "cp-1",
        serviceId: "svc-breast",
        sessions: 1,
      },
      items: [
        item({
          id: "ti-1",
          referenceId: "svc-breast",
          discountAmount: 3200,
          lineTotal: 0,
        }),
      ],
      discountTotal: 3200,
      total: 0,
      payments: [],
    });
    expect(packageRedemptionMinor(redeemed)).toBe(3200);
    expect(TRANSACTIONS_PACKAGE_IS_PAYMENT_METHOD).toBe(false);
    expect(paymentBadgeLabel(redeemed.payments)).toBe("無需付款");
    const summary = countTransactionSummary(rows([redeemed]), NOW);
    expect(summary.todayExternalInflowMinor).toBe(0);
    expect(summary.todayTransactionCount).toBe(1);
    const breakdown = countTodayPaymentBreakdown(rows([redeemed]), NOW);
    expect(
      breakdown.nonCash.find((row) => row.method === "PACKAGE_REDEMPTION")?.amountMinor,
    ).toBe(3200);
    expect(breakdown.external.every((row) => row.amountMinor === 0)).toBe(true);
  });
});

describe("selection / keyboard / responsive", () => {
  const built = rows([tx({ id: "t-1", customerId: "c-wang", appointmentId: "apt-1" })]);

  it("selects by transaction id", () => {
    expect(resolveSelectedTransactionRow(built, "t-1")?.transactionId).toBe("t-1");
    expect(resolveSelectedTransactionRow(built, null)).toBeNull();
    expect(shouldRenderTransactionQuickView(built[0])).toBe(true);
    expect(shouldRenderTransactionQuickView(null)).toBe(false);
  });

  it("resets selection when the row is no longer visible", () => {
    expect(
      shouldResetTransactionSelection({
        selectedTransactionId: "t-1",
        visibleRows: [],
      }),
    ).toBe(true);
    expect(
      shouldResetTransactionSelection({
        selectedTransactionId: "t-1",
        visibleRows: built,
      }),
    ).toBe(false);
    expect(
      shouldResetTransactionSelection({
        selectedTransactionId: null,
        visibleRows: built,
      }),
    ).toBe(false);
  });

  it("activates rows with Enter and Space", () => {
    expect(isTransactionRowKeyboardActivation("Enter")).toBe(true);
    expect(isTransactionRowKeyboardActivation(" ")).toBe(true);
    expect(isTransactionRowKeyboardActivation("Tab")).toBe(false);
  });

  it("keeps the 400 / 16 / 1200 workspace rule", () => {
    expect(TRANSACTIONS_PANEL_WIDTH_PX).toBe(400);
    expect(TRANSACTIONS_WORKSPACE_GAP_PX).toBe(16);
    expect(TRANSACTIONS_INLINE_MIN_PX).toBe(1200);
    expect(isInlineTransactionQuickViewViewport(1199)).toBe(false);
    expect(isInlineTransactionQuickViewViewport(1200)).toBe(true);
    expect(transactionListPresentation(390)).toBe("mobile-cards");
    expect(transactionListPresentation(1536)).toBe("desktop-rows");
  });
});

describe("organization / location isolation", () => {
  it("does not leak another organization's transactions", () => {
    const leaked = tx({
      id: "t-other",
      customerId: "c-wang",
      organizationId: OTHER_ORG,
    });
    const built = rows([leaked, tx({ id: "t-mine", customerId: "c-wang" })]);
    expect(built.map((row) => row.transactionId)).toEqual(["t-mine"]);
  });

  it("maps location names and can filter by location", () => {
    const built = rows([
      tx({ id: "t-main", customerId: "c-wang" }),
      tx({ id: "t-gongyi", customerId: "c-lin", locationId: LOC_B }),
    ]);
    expect(built.find((row) => row.transactionId === "t-main")?.locationName).toBe("主店");
    expect(built.find((row) => row.transactionId === "t-gongyi")?.locationName).toBe(
      "公益店",
    );
    expect(
      filterTransactionsByLocation(built, LOC_B).map((row) => row.transactionId),
    ).toEqual(["t-gongyi"]);
  });
});

describe("architecture source guards", () => {
  it("does not invent a second balance, pending status, or transaction store", () => {
    expect(TRANSACTIONS_HAS_BALANCE_FIELD).toBe(false);
    expect(TRANSACTIONS_HAS_PENDING_STATUS).toBe(false);
    expect(TRANSACTIONS_HAS_EXPORT).toBe(false);

    const derived = readFileSync(
      path.join(process.cwd(), "lib/commerce/transactions-workspace-derived.ts"),
      "utf8",
    );
    const page = readFileSync(
      path.join(process.cwd(), "features/transactions/TransactionsPageClient.tsx"),
      "utf8",
    );
    const quickView = readFileSync(
      path.join(process.cwd(), "features/transactions/TransactionQuickView.tsx"),
      "utf8",
    );
    const shell = readFileSync(
      path.join(process.cwd(), "components/layout/StaffShell.tsx"),
      "utf8",
    );
    const domain = readFileSync(
      path.join(process.cwd(), "lib/commerce/domain.ts"),
      "utf8",
    );

    expect(derived).not.toMatch(/localStorage/);
    expect(derived).not.toMatch(/createTransaction|writeTransactions|voidTransaction/);
    expect(derived).not.toMatch(/transaction\.balance/);
    expect(page).toMatch(/selectedTransactionId/);
    expect(page).toMatch(/listTransactions/);
    expect(page).not.toMatch(/router\.push\(\s*`\/staff\/transactions\?id=/);
    expect(page).toMatch(/data-transactions-workspace/);
    expect(page).toMatch(/data-transactions-gap/);
    expect(quickView).toMatch(/TRANSACTIONS_PANEL_WIDTH_PX/);
    expect(quickView).toMatch(/查看客戶資料/);
    expect(shell).toMatch(/isTransactionsWorkbench/);
    expect(shell).toMatch(/w-\[254px\]/);
    expect(shell).toMatch(/w-\[232px\]/);
    expect(domain).not.toMatch(/balance\?:/);
    expect(domain).toMatch(/status: TransactionStatus/);
    expect(domain).toMatch(/COMPLETED" \| "VOIDED/);
  });

  it("keeps row identity as transaction id string", () => {
    const built = rows([tx({ id: "t-1", customerId: "c-wang" })]);
    const id = built[0].transactionId;
    expect(resolveSelectedTransactionRow(built, id)?.transactionId).toBe(id);
    expect(
      resolveSelectedTransactionRow(
        built,
        { ...(built[0] as object) } as unknown as string,
      ),
    ).toBeNull();
    const typed: TransactionWorkspaceRow = built[0];
    expect(typed.transaction.id).toBe("t-1");
  });
});
