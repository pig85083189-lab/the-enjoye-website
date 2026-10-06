import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_PAYMENT_METHODS,
  type Transaction,
  type TransactionItemSnapshot,
  type TransactionPaymentSnapshot,
} from "@/lib/commerce/domain";
import {
  checkoutConfirmCtaLabel,
  checkoutPackageDueSummary,
  countDailyEntitlementSummary,
  presentTransactionTender,
  STORED_VALUE_WRITE_OPEN,
  TENDER_PACKAGE_IS_PAYMENT_METHOD,
} from "@/lib/commerce/transaction-tender-presentation";
import { matchesTransactionDateFilter } from "@/lib/commerce/transactions-workspace-derived";

const NOW = new Date("2026-10-06T16:56:00+08:00");
const ORG = "org-the-enjoye";

function item(
  partial: Partial<TransactionItemSnapshot> = {},
): TransactionItemSnapshot {
  return {
    id: "ti-1",
    type: "SERVICE",
    referenceId: "svc-muw54el4-7omtyn",
    nameSnapshot: "美波澎潤upupSPA",
    unitPrice: 1800,
    quantity: 1,
    lineSubtotal: 1800,
    discountAmount: 0,
    lineTotal: 1800,
    ...partial,
  };
}

function payment(
  partial: Partial<TransactionPaymentSnapshot> = {},
): TransactionPaymentSnapshot {
  return {
    id: "tp-1",
    method: "CASH",
    amount: 1800,
    paidAt: "2026-10-06T06:06:00.000Z",
    ...partial,
  };
}

function tx(partial: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-cash",
    organizationId: ORG,
    locationId: "loc-enjoye-main",
    customerId: "cust-muvxogn2-cljfds",
    transactionNumber: "TX-20261006-0001",
    status: "COMPLETED",
    items: [item()],
    discounts: [],
    payments: [payment()],
    subtotal: 1800,
    discountTotal: 0,
    total: 1800,
    currency: "TWD",
    createdByStaffId: "staff-001",
    completedAt: "2026-10-06T06:06:00.000Z",
    ...partial,
  };
}

const PACKAGE_CATALOG = [
  { id: "cpkg-fb626441e6df43", nameSnapshot: "性感美胸10堂" },
];

describe("transaction tender presentation", () => {
  it("A. CASH service 1800 / payment CASH 1800", () => {
    const tender = presentTransactionTender(tx());
    expect(tender.tenderBadge).toBe("現金");
    expect(tender.tenderKind).toBe("CASH");
    expect(tender.serviceValueMinor).toBe(1800);
    expect(tender.collectedMinor).toBe(1800);
    expect(tender.packageRedemption).toBeNull();
    expect(tender.paymentMethods).toEqual(["CASH"]);
  });

  it("B. PACKAGE full redemption is not a payment method", () => {
    const redeemed = tx({
      id: "tx-dde7b90247284a",
      transactionNumber: "TX-20261006-0003",
      packageRedemption: {
        customerPackageId: "cpkg-fb626441e6df43",
        serviceId: "svc-muw54el4-7omtyn",
        sessions: 1,
      },
      items: [item({ discountAmount: 1800, lineTotal: 0 })],
      discountTotal: 1800,
      total: 0,
      payments: [],
    });
    const tender = presentTransactionTender(redeemed, PACKAGE_CATALOG);
    expect(tender.tenderBadge).toBe("套票 · 性感美胸10堂 · 1堂");
    expect(tender.tenderKind).toBe("PACKAGE");
    expect(tender.serviceValueMinor).toBe(1800);
    expect(tender.packageRedemption?.redeemedValueMinor).toBe(1800);
    expect(tender.collectedMinor).toBe(0);
    expect(tender.packageRedemption?.customerPackageId).toBe("cpkg-fb626441e6df43");
    expect(tender.packageRedemption?.serviceId).toBe("svc-muw54el4-7omtyn");
    expect(tender.paymentMethods).toEqual([]);
  });

  it("does not treat amount=0 as package without redemption identity", () => {
    const zero = tx({
      id: "tx-zero",
      items: [item({ discountAmount: 1800, lineTotal: 0 })],
      discountTotal: 1800,
      total: 0,
      payments: [],
    });
    const tender = presentTransactionTender(zero, PACKAGE_CATALOG);
    expect(tender.packageRedemption).toBeNull();
    expect(tender.tenderKind).toBe("NONE");
    expect(tender.collectedMinor).toBe(0);
    expect(tender.tenderBadge).toBe("無需付款");
  });

  it("C. package selection CTA before / after / cancel", () => {
    expect(
      checkoutConfirmCtaLabel({ packageRedemption: null, dueMinor: 1800 }),
    ).toBe("確認收款 NT$1,800");
    expect(
      checkoutConfirmCtaLabel({
        packageRedemption: {
          customerPackageId: "cpkg-fb626441e6df43",
          serviceId: "svc-muw54el4-7omtyn",
          sessions: 1,
        },
        dueMinor: 0,
      }),
    ).toBe("確認使用 1 堂並完成結帳");
    expect(
      checkoutConfirmCtaLabel({ packageRedemption: null, dueMinor: 1800 }),
    ).toBe("確認收款 NT$1,800");
    expect(
      checkoutPackageDueSummary({
        serviceValueMinor: 1800,
        packageDiscountMinor: 1800,
        dueMinor: 0,
      }),
    ).toEqual({
      serviceValueMinor: 1800,
      packageDiscountMinor: 1800,
      dueMinor: 0,
    });
  });

  it("E. daily cash 1800 + package redemption 1800 stays 今日實收 1800", () => {
    const cash = presentTransactionTender(tx());
    const redeemed = presentTransactionTender(
      tx({
        id: "tx-pkg",
        completedAt: "2026-10-06T08:56:00.000Z",
        packageRedemption: {
          customerPackageId: "cpkg-fb626441e6df43",
          serviceId: "svc-muw54el4-7omtyn",
          sessions: 1,
        },
        items: [item({ discountAmount: 1800, lineTotal: 0 })],
        discountTotal: 1800,
        total: 0,
        payments: [],
      }),
      PACKAGE_CATALOG,
    );
    const summary = countDailyEntitlementSummary(
      [
        { completedAt: "2026-10-06T06:06:00.000Z", status: "COMPLETED", tender: cash },
        { completedAt: "2026-10-06T08:56:00.000Z", status: "COMPLETED", tender: redeemed },
      ],
      NOW,
      (completedAt, now) => matchesTransactionDateFilter(completedAt, "today", now),
    );
    expect(summary.todayCollectedMinor).toBe(1800);
    expect(summary.packageSessions).toBe(1);
    expect(summary.packageRedeemedMinor).toBe(1800);
    expect(summary.storedValueWriteOpen).toBe(false);
    expect(summary.todayCollectedMinor + summary.packageRedeemedMinor).not.toBe(
      summary.todayCollectedMinor,
    );
  });

  it("F. PACKAGE stays reserved and is not an active payment method", () => {
    expect(TENDER_PACKAGE_IS_PAYMENT_METHOD).toBe(false);
    expect(STORED_VALUE_WRITE_OPEN).toBe(false);
    expect(ACTIVE_PAYMENT_METHODS).not.toContain("PACKAGE");
    expect(ACTIVE_PAYMENT_METHODS).toContain("CASH");
    const source = readFileSync(
      path.join(process.cwd(), "lib/commerce/transaction-tender-presentation.ts"),
      "utf8",
    );
    expect(source).toMatch(/PACKAGE is a redemption label/);
    expect(source).not.toMatch(/payments\.push\(\{[\s\S]*method:\s*"PACKAGE"/);
  });
});
