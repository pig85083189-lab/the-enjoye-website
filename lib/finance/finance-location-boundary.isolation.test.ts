import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/commerce/domain";
import { filterCompletedInScope } from "@/lib/finance/derived";
import { monthRangeContaining } from "@/lib/finance/period";
import { reconcileFinanceToTransactions } from "@/lib/finance/reconciliation";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";

function tx(partial: Partial<Transaction> & Pick<Transaction, "id">): Transaction {
  return {
    organizationId: ORG_ENJOYE_ID,
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "cust-1",
    transactionNumber: "TX-1",
    status: "COMPLETED",
    items: [
      {
        id: `i-${partial.id}`,
        type: "SERVICE",
        nameSnapshot: "服務",
        unitPrice: 1800,
        quantity: 1,
        lineSubtotal: 1800,
        discountAmount: 0,
        lineTotal: 1800,
      },
    ],
    discounts: [],
    payments: [{ id: `p-${partial.id}`, method: "CASH", amount: 1800, paidAt: "2026-10-06T09:00:00.000Z" }],
    subtotal: 1800,
    discountTotal: 0,
    total: 1800,
    currency: "TWD",
    createdByStaffId: "staff-001",
    completedAt: "2026-10-06T09:00:00.000Z",
    ...partial,
  };
}

describe("finance location boundary", () => {
  it("does not aggregate across locations or organizations", () => {
    const primary = tx({ id: "tx-primary" });
    const otherLoc = tx({ id: "tx-gongyi", locationId: LOC_ENJOYE_SECONDARY_ID });
    const otherOrg = tx({ id: "tx-lumiere", organizationId: ORG_LUMIERE_ID });
    const range = monthRangeContaining("2026-10-06");
    const scoped = filterCompletedInScope({
      transactions: [primary, otherLoc, otherOrg],
      expenses: [],
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      range,
    });
    expect(scoped.metrics.map((row) => row.transactionId)).toEqual(["tx-primary"]);
    const reconciled = reconcileFinanceToTransactions({
      transactions: [primary, otherLoc, otherOrg],
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      range,
    });
    expect(reconciled.transactionCount).toBe(1);
    expect(reconciled.collectedMinor).toBe(1800);
  });
});
