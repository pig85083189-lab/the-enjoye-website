import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/commerce/domain";
import { presentFinanceTransaction } from "@/lib/finance/derived";
import { FINANCE_DISPLAY_TIMEZONE } from "@/lib/finance/domain";
import {
  dayRange,
  monthRangeContaining,
  resolveFinancePeriod,
  taipeiYmdFromInstant,
  weekRangeContaining,
} from "@/lib/finance/period";
import { utcIsoToTaipeiLocal } from "@/lib/persistence/appointment-time";

describe("finance Taipei business date boundary", () => {
  it("uses Asia/Taipei, not UTC date substring", () => {
    expect(FINANCE_DISPLAY_TIMEZONE).toBe("Asia/Taipei");
    const utcEvening = "2026-10-05T16:30:00.000Z";
    expect(utcEvening.slice(0, 10)).toBe("2026-10-05");
    expect(taipeiYmdFromInstant(utcEvening)).toBe("2026-10-06");
    expect(utcIsoToTaipeiLocal(utcEvening).dateYmd).toBe("2026-10-06");
    expect(taipeiYmdFromInstant(utcEvening)).not.toBe(utcEvening.slice(0, 10));
  });

  it("places 2026/10/06 Taiwan completed transactions on that business day", () => {
    const tx = {
      id: "tx-boundary",
      organizationId: "org-the-enjoye",
      locationId: "loc-enjoye-main",
      customerId: "cust-1",
      transactionNumber: "TX-1",
      status: "COMPLETED" as const,
      items: [
        {
          id: "i1",
          type: "SERVICE" as const,
          nameSnapshot: "美波澎潤upupSPA",
          unitPrice: 1800,
          quantity: 1,
          lineSubtotal: 1800,
          discountAmount: 0,
          lineTotal: 1800,
        },
      ],
      discounts: [],
      payments: [{ id: "p1", method: "CASH" as const, amount: 1800, paidAt: "2026-10-05T16:30:00.000Z" }],
      subtotal: 1800,
      discountTotal: 0,
      total: 1800,
      currency: "TWD" as const,
      createdByStaffId: "staff-001",
      completedAt: "2026-10-05T16:30:00.000Z",
    } satisfies Transaction;
    const metrics = presentFinanceTransaction(tx);
    expect(metrics.completedYmd).toBe("2026-10-06");
    expect(dayRange("2026-10-06")).toEqual({ startYmd: "2026-10-06", endYmd: "2026-10-06" });
    expect(monthRangeContaining("2026-10-06")).toEqual({
      startYmd: "2026-10-01",
      endYmd: "2026-10-31",
    });
  });

  it("day / week / month / custom share resolveFinancePeriod", () => {
    expect(resolveFinancePeriod("day", "2026-10-06")).toEqual(dayRange("2026-10-06"));
    expect(resolveFinancePeriod("week", "2026-10-06")).toEqual(weekRangeContaining("2026-10-06"));
    expect(resolveFinancePeriod("month", "2026-10-06")).toEqual(monthRangeContaining("2026-10-06"));
    expect(
      resolveFinancePeriod("custom", "2026-10-06", {
        startYmd: "2026-10-01",
        endYmd: "2026-10-06",
      }),
    ).toEqual({ startYmd: "2026-10-01", endYmd: "2026-10-06" });
  });
});
