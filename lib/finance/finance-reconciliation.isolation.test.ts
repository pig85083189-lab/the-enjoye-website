import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/commerce/domain";
import { collectedMinor } from "@/lib/commerce/transaction-tender-presentation";
import { monthRangeContaining } from "@/lib/finance/period";
import { reconcileFinanceToTransactions } from "@/lib/finance/reconciliation";
import { LOC_ENJOYE_PRIMARY_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

function tx(partial: Partial<Transaction> & Pick<Transaction, "id" | "items" | "payments">): Transaction {
  return {
    organizationId: ORG_ENJOYE_ID,
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "cust-1",
    transactionNumber: "TX-1",
    status: "COMPLETED",
    discounts: [],
    subtotal: partial.items.reduce((sum, item) => sum + item.lineSubtotal, 0),
    discountTotal: partial.items.reduce((sum, item) => sum + item.discountAmount, 0),
    total: partial.items.reduce((sum, item) => sum + item.lineTotal, 0),
    currency: "TWD",
    createdByStaffId: "staff-001",
    completedAt: "2026-10-06T09:00:00.000Z",
    ...partial,
  };
}

const CASH = tx({
  id: "tx-cash",
  items: [
    {
      id: "i1",
      type: "SERVICE",
      nameSnapshot: "美波澎潤upupSPA",
      unitPrice: 1800,
      quantity: 1,
      lineSubtotal: 1800,
      discountAmount: 0,
      lineTotal: 1800,
    },
  ],
  payments: [{ id: "p1", method: "CASH", amount: 1800, paidAt: "2026-10-06T09:12:00.000Z" }],
});

const PACKAGE_SALE = tx({
  id: "tx-sale",
  items: [
    {
      id: "i2",
      type: "PACKAGE_PURCHASE",
      nameSnapshot: "性感美胸10堂",
      unitPrice: 22000,
      quantity: 1,
      lineSubtotal: 22000,
      discountAmount: 0,
      lineTotal: 22000,
      sessionCountSnapshot: 10,
    },
  ],
  payments: [{ id: "p2", method: "CASH", amount: 22000, paidAt: "2026-10-06T08:32:00.000Z" }],
});

const REDEMPTION = tx({
  id: "tx-redeem",
  total: 0,
  items: [
    {
      id: "i3",
      type: "SERVICE",
      nameSnapshot: "美波澎潤upupSPA",
      unitPrice: 1800,
      quantity: 1,
      lineSubtotal: 1800,
      discountAmount: 1800,
      lineTotal: 0,
    },
  ],
  payments: [],
  packageRedemption: {
    customerPackageId: "cpkg-1",
    serviceId: "svc-1",
    sessions: 1,
  },
});

describe("finance ↔ transactions reconciliation", () => {
  it("matches Transactions-page collected for cash, package sale, and redemption", () => {
    const rows = [CASH, PACKAGE_SALE, REDEMPTION];
    const result = reconcileFinanceToTransactions({
      transactions: rows,
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      range: monthRangeContaining("2026-10-06"),
    });
    const transactionsCollected = rows.reduce((sum, row) => sum + collectedMinor(row), 0);
    expect(result.transactionCount).toBe(3);
    expect(result.collectedMinor).toBe(23800);
    expect(result.transactionsCollectedMinor).toBe(transactionsCollected);
    expect(result.matched).toBe(true);
    expect(result.packageSalesMinor).toBe(22000);
    expect(result.serviceValueMinor).toBe(3600);
    expect(result.packageRedemptionValueMinor).toBe(1800);
    expect(result.productSalesMinor).toBe(0);
    expect(collectedMinor(REDEMPTION)).toBe(0);
  });

  it("fails closed when collected would be confused with service value", () => {
    const result = reconcileFinanceToTransactions({
      transactions: [REDEMPTION],
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      range: monthRangeContaining("2026-10-06"),
    });
    expect(result.collectedMinor).toBe(0);
    expect(result.serviceValueMinor).toBe(1800);
    expect(result.matched).toBe(true);
    expect(result.collectedMinor === result.serviceValueMinor).toBe(false);
  });
});
