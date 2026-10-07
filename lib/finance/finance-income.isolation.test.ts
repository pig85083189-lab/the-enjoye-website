import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/commerce/domain";
import { buildFinanceIncomeRows } from "@/lib/finance/income";
import { monthRangeContaining } from "@/lib/finance/period";
import { LOC_ENJOYE_PRIMARY_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

function tx(partial: Partial<Transaction> & Pick<Transaction, "id" | "items" | "payments">): Transaction {
  return {
    organizationId: ORG_ENJOYE_ID,
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "cust-1",
    transactionNumber: "TX-20261006-0001",
    status: "COMPLETED",
    discounts: [],
    subtotal: 1800,
    discountTotal: 0,
    total: 1800,
    currency: "TWD",
    createdByStaffId: "staff-001",
    completedAt: "2026-10-06T09:12:00.000Z",
    ...partial,
  };
}

describe("finance income rows", () => {
  it("presents cash service value and collected separately", () => {
    const rows = buildFinanceIncomeRows({
      transactions: [
        tx({
          id: "tx-cash",
          transactionNumber: "TX-20261006-0004",
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
            { id: "p1", method: "CASH", amount: 1800, paidAt: "2026-10-06T09:12:00.000Z" },
          ],
        }),
      ],
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      range: monthRangeContaining("2026-10-06"),
      customers: [{ id: "cust-1", name: "喻茗楷", phone: "" }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].incomeKind).toBe("SERVICE");
    expect(rows[0].serviceValueMinor).toBe(1800);
    expect(rows[0].collectedMinor).toBe(1800);
    expect(rows[0].packageOffsetMinor).toBe(0);
    expect(rows[0].paymentLabel).toBe("現金");
  });

  it("shows package redemption as service value with zero collected, not unpaid income", () => {
    const rows = buildFinanceIncomeRows({
      transactions: [
        tx({
          id: "tx-pkg",
          transactionNumber: "TX-20261006-0006",
          total: 0,
          discountTotal: 1800,
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
        }),
      ],
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      range: monthRangeContaining("2026-10-06"),
      customers: [{ id: "cust-1", name: "喻至敬", phone: "" }],
    });
    expect(rows[0].incomeKind).toBe("SERVICE");
    expect(rows[0].serviceValueMinor).toBe(1800);
    expect(rows[0].packageOffsetMinor).toBe(1800);
    expect(rows[0].collectedMinor).toBe(0);
    expect(rows[0].paymentLabel).toMatch(/套票/);
  });

  it("classifies package purchase as PACKAGE_SALE", () => {
    const rows = buildFinanceIncomeRows({
      transactions: [
        tx({
          id: "tx-sale",
          transactionNumber: "TX-20261006-0002",
          subtotal: 22000,
          total: 22000,
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
            },
          ],
          payments: [
            { id: "p1", method: "CASH", amount: 22000, paidAt: "2026-10-06T08:32:00.000Z" },
          ],
        }),
      ],
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      range: monthRangeContaining("2026-10-06"),
    });
    expect(rows[0].incomeKind).toBe("PACKAGE_SALE");
    expect(rows[0].collectedMinor).toBe(22000);
    expect(rows[0].serviceValueMinor).toBe(0);
  });
});
