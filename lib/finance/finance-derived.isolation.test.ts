import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/commerce/domain";
import { STORED_VALUE_WRITE_OPEN } from "@/lib/commerce/transaction-tender-presentation";
import {
  filterCompletedInScope,
  financeServiceValueMinor,
  presentFinanceTransaction,
  sumFinanceTotals,
} from "@/lib/finance/derived";
import { FINANCE_STORED_VALUE_WRITE_OPEN } from "@/lib/finance/domain";
import { monthRangeContaining } from "@/lib/finance/period";
import { LOC_ENJOYE_PRIMARY_ID, LOC_ENJOYE_SECONDARY_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import type { Expense } from "@/lib/finance/domain";

const ORG = ORG_ENJOYE_ID;
const LOC = LOC_ENJOYE_PRIMARY_ID;
const OTHER_ORG = "org-lumiere";
const OTHER_LOC = LOC_ENJOYE_SECONDARY_ID;

function tx(partial: Partial<Transaction> & Pick<Transaction, "id" | "items" | "payments">): Transaction {
  return {
    organizationId: ORG,
    locationId: LOC,
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

function expense(partial: Partial<Expense> & Pick<Expense, "id" | "amountMinor">): Expense {
  return {
    appId: partial.id,
    organizationId: ORG,
    locationId: LOC,
    expenseDate: "2026-10-06",
    category: "SUPPLIES",
    name: "耗材",
    paymentMethod: "CASH",
    vendor: "",
    note: "",
    receiptUrl: null,
    createdByStaffId: "staff-001",
    createdAt: "2026-10-06T09:00:00.000Z",
    updatedAt: "2026-10-06T09:00:00.000Z",
    ...partial,
  };
}

describe("finance derived metrics", () => {
  it("counts CASH collection as collected revenue", () => {
    const cash = tx({
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
      payments: [
        { id: "p1", method: "CASH", amount: 1800, paidAt: "2026-10-06T09:00:00.000Z" },
      ],
    });
    const metrics = presentFinanceTransaction(cash);
    expect(metrics.collectedMinor).toBe(1800);
    expect(metrics.serviceCollectedMinor).toBe(1800);
    expect(metrics.serviceValueMinor).toBe(1800);
    expect(metrics.packageSalesMinor).toBe(0);
  });

  it("counts package sale as collected + package sales, not service value", () => {
    const sale = tx({
      id: "tx-pkg-sale",
      items: [
        {
          id: "i1",
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
      payments: [
        { id: "p1", method: "CASH", amount: 22000, paidAt: "2026-10-06T08:32:00.000Z" },
      ],
    });
    const metrics = presentFinanceTransaction(sale);
    expect(metrics.collectedMinor).toBe(22000);
    expect(metrics.packageSalesMinor).toBe(22000);
    expect(metrics.serviceValueMinor).toBe(0);
    expect(financeServiceValueMinor(sale)).toBe(0);
  });

  it("does not add package redemption to collected revenue and keeps service value", () => {
    const redemption = tx({
      id: "tx-redeem",
      items: [
        {
          id: "i1",
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
      total: 0,
    });
    const metrics = presentFinanceTransaction(redemption);
    expect(metrics.collectedMinor).toBe(0);
    expect(metrics.serviceValueMinor).toBe(1800);
    expect(metrics.packageRedemptionValueMinor).toBe(1800);
  });

  it("subtracts expenses from operating cash delta", () => {
    const cash = tx({
      id: "tx-cash",
      items: [
        {
          id: "i1",
          type: "SERVICE",
          nameSnapshot: "服務",
          unitPrice: 1800,
          quantity: 1,
          lineSubtotal: 1800,
          discountAmount: 0,
          lineTotal: 1800,
        },
      ],
      payments: [
        { id: "p1", method: "CASH", amount: 1800, paidAt: "2026-10-06T09:00:00.000Z" },
      ],
    });
    const totals = sumFinanceTotals(
      [presentFinanceTransaction(cash)],
      [expense({ id: "exp-1", amountMinor: 300 })],
    );
    expect(totals.collectedRevenueMinor).toBe(1800);
    expect(totals.expenseMinor).toBe(300);
    expect(totals.operatingCashDeltaMinor).toBe(1500);
    expect(totals.storedValueWriteOpen).toBe(false);
    expect(FINANCE_STORED_VALUE_WRITE_OPEN).toBe(false);
    expect(STORED_VALUE_WRITE_OPEN).toBe(false);
  });

  it("isolates organization and location", () => {
    const localTx = tx({
      id: "tx-local",
      items: [
        {
          id: "i1",
          type: "SERVICE",
          nameSnapshot: "服務",
          unitPrice: 1800,
          quantity: 1,
          lineSubtotal: 1800,
          discountAmount: 0,
          lineTotal: 1800,
        },
      ],
      payments: [
        { id: "p1", method: "CASH", amount: 1800, paidAt: "2026-10-06T09:00:00.000Z" },
      ],
    });
    const otherOrg = tx({
      ...localTx,
      id: "tx-other-org",
      organizationId: OTHER_ORG,
    });
    const otherLoc = tx({
      ...localTx,
      id: "tx-other-loc",
      locationId: OTHER_LOC,
    });
    const scoped = filterCompletedInScope({
      transactions: [localTx, otherOrg, otherLoc],
      expenses: [
        expense({ id: "e1", amountMinor: 100 }),
        expense({ id: "e2", amountMinor: 999, organizationId: OTHER_ORG }),
        expense({ id: "e3", amountMinor: 888, locationId: OTHER_LOC }),
      ],
      organizationId: ORG,
      locationId: LOC,
      range: monthRangeContaining("2026-10-06"),
    });
    expect(scoped.metrics).toHaveLength(1);
    expect(scoped.metrics[0].transactionId).toBe("tx-local");
    expect(scoped.expenses.map((row) => row.id)).toEqual(["e1"]);
  });
});
