import { describe, expect, it } from "vitest";
import { formatTwd } from "@/lib/commerce/money";
import type { Transaction } from "@/lib/commerce/domain";
import {
  presentFinanceTransaction,
  sumFinanceTotals,
} from "@/lib/finance/derived";
import { FINANCE_STORED_VALUE_WRITE_OPEN, type Expense } from "@/lib/finance/domain";
import { STORED_VALUE_WRITE_OPEN } from "@/lib/commerce/transaction-tender-presentation";
import { LOC_ENJOYE_PRIMARY_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

function cashTx(): Transaction {
  return {
    id: "tx-270fdc87a51e43",
    organizationId: ORG_ENJOYE_ID,
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "cust-1",
    transactionNumber: "TX-20261005-0001",
    status: "COMPLETED",
    items: [
      {
        id: "i1",
        type: "SERVICE",
        nameSnapshot: "Remote QA Bust Care",
        unitPrice: 3200,
        quantity: 1,
        lineSubtotal: 3200,
        discountAmount: 0,
        lineTotal: 3200,
      },
    ],
    discounts: [],
    payments: [{ id: "p1", method: "CASH", amount: 3200, paidAt: "2026-10-05T06:44:41.329Z" }],
    subtotal: 3200,
    discountTotal: 0,
    total: 3200,
    currency: "TWD",
    createdByStaffId: "staff-001",
    completedAt: "2026-10-05T06:44:41.329Z",
  };
}

function rent(): Expense {
  return {
    id: "exp-mtest01-abc123",
    appId: "exp-mtest01-abc123",
    organizationId: ORG_ENJOYE_ID,
    locationId: LOC_ENJOYE_PRIMARY_ID,
    expenseDate: "2026-10-06",
    category: "RENT",
    name: "10 月店租",
    amountMinor: 23000,
    paymentMethod: "TRANSFER",
    vendor: "房東",
    note: "10 月份店租",
    receiptUrl: null,
    createdByStaffId: "staff-001",
    createdAt: "2026-10-06T02:00:00.000Z",
    updatedAt: "2026-10-06T02:00:00.000Z",
  };
}

describe("expense finance derivation", () => {
  it("subtracts expenses from collected revenue and does not mutate commerce income", () => {
    const tx = cashTx();
    const metrics = presentFinanceTransaction(tx);
    expect(metrics.collectedMinor).toBe(3200);
    const totals = sumFinanceTotals([metrics], [rent()]);
    expect(totals.collectedRevenueMinor).toBe(3200);
    expect(totals.expenseMinor).toBe(23000);
    expect(totals.operatingCashDeltaMinor).toBe(-19800);
    expect(formatTwd(totals.operatingCashDeltaMinor)).toBe("-NT$19,800");
    expect(formatTwd(totals.operatingCashDeltaMinor)).not.toMatch(/^NT\$-/);
    expect(tx.total).toBe(3200);
    expect(tx.transactionNumber).toBe("TX-20261005-0001");
    expect(FINANCE_STORED_VALUE_WRITE_OPEN).toBe(false);
    expect(STORED_VALUE_WRITE_OPEN).toBe(false);
  });

  it("does not add package redemption to collected revenue", () => {
    const redemption: Transaction = {
      ...cashTx(),
      id: "tx-redeem",
      transactionNumber: "TX-REDEEM",
      items: [
        {
          id: "i2",
          type: "SERVICE",
          nameSnapshot: "服務",
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
      subtotal: 1800,
      discountTotal: 1800,
      total: 0,
    };
    const metrics = presentFinanceTransaction(redemption);
    expect(metrics.collectedMinor).toBe(0);
    expect(metrics.packageRedemptionValueMinor).toBe(1800);
    const totals = sumFinanceTotals([metrics], [rent()]);
    expect(totals.collectedRevenueMinor).toBe(0);
    expect(totals.operatingCashDeltaMinor).toBe(-23000);
  });
});
