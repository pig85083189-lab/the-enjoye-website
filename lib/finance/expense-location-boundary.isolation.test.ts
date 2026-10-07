import { describe, expect, it } from "vitest";
import { buildFinanceExpenseRows } from "@/lib/finance/expense";
import { filterCompletedInScope, sumFinanceTotals } from "@/lib/finance/derived";
import { monthRangeContaining } from "@/lib/finance/period";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  ORG_ENJOYE_ID,
} from "@/lib/tenant/constants";
import type { Expense } from "@/lib/finance/domain";

function expense(over: Partial<Expense> & Pick<Expense, "id" | "locationId" | "organizationId">): Expense {
  return {
    appId: over.id,
    expenseDate: "2026-10-06",
    category: "RENT",
    name: "店租",
    amountMinor: 23000,
    paymentMethod: "TRANSFER",
    vendor: "房東",
    note: "",
    receiptUrl: null,
    createdByStaffId: "staff-001",
    createdAt: "2026-10-06T02:00:00.000Z",
    updatedAt: "2026-10-06T02:00:00.000Z",
    ...over,
  };
}

describe("expense location boundary", () => {
  it("does not show another location's expense in list or dashboard totals", () => {
    const primary = expense({
      id: "exp-main-aaa111",
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
    });
    const gongyi = expense({
      id: "exp-gongyi-bbb222",
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_SECONDARY_ID,
      amountMinor: 99999,
    });
    const otherOrg = expense({
      id: "exp-other-ccc333",
      organizationId: "org-lumiere",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      amountMinor: 88888,
    });
    const range = monthRangeContaining("2026-10-06");
    const rows = buildFinanceExpenseRows({
      expenses: [primary, gongyi, otherOrg],
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      range,
    });
    expect(rows.map((row) => row.id)).toEqual(["exp-main-aaa111"]);
    const scoped = filterCompletedInScope({
      transactions: [],
      expenses: [primary, gongyi, otherOrg],
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      range,
    });
    expect(sumFinanceTotals([], scoped.expenses).expenseMinor).toBe(23000);
  });
});
