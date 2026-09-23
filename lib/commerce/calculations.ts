import type { CheckoutDiscount, CheckoutItem, PaymentDraft } from "./domain";
import { assertMoney, assertNonNegativeMoney } from "./money";

export interface TotalsResult {
  subtotal: number;
  discountTotal: number;
  total: number;
  discountBreakdown: Array<{ discountId: string; amountApplied: number }>;
}

export function lineSubtotal(unitPrice: number, quantity: number): number {
  assertNonNegativeMoney(unitPrice, "unitPrice");
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("quantity must be an integer >= 1");
  }
  return unitPrice * quantity;
}

export function recomputeItem(item: Omit<CheckoutItem, "lineSubtotal" | "lineTotal"> & {
  lineSubtotal?: number;
  lineTotal?: number;
}): CheckoutItem {
  const sub = lineSubtotal(item.unitPrice, item.quantity);
  const discountAmount = assertNonNegativeMoney(
    item.discountAmount ?? 0,
    "line.discountAmount",
  );
  if (discountAmount > sub) {
    throw new Error("line discount cannot exceed line subtotal");
  }
  return {
    id: item.id,
    type: item.type,
    referenceId: item.referenceId,
    nameSnapshot: item.nameSnapshot,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    lineSubtotal: sub,
    discountAmount,
    lineTotal: sub - discountAmount,
    sessionCountSnapshot: item.sessionCountSnapshot,
  };
}

/**
 * Percentage discounts use basis points: 1000 = 10.00%.
 * Subtotal = sum(lineSubtotal). Line discounts applied first, then order discounts.
 * Cap: discountTotal cannot exceed subtotal; total never negative.
 */
export function calculateTotals(
  items: CheckoutItem[],
  discounts: CheckoutDiscount[],
): TotalsResult {
  const subtotal = items.reduce((sum, item) => {
    assertNonNegativeMoney(item.lineSubtotal, "lineSubtotal");
    return sum + item.lineSubtotal;
  }, 0);

  const lineDiscountTotal = items.reduce((sum, item) => {
    assertNonNegativeMoney(item.discountAmount, "line.discountAmount");
    return sum + item.discountAmount;
  }, 0);

  let remaining = subtotal - lineDiscountTotal;
  let discountTotal = lineDiscountTotal;
  const discountBreakdown: TotalsResult["discountBreakdown"] = [];

  for (const d of discounts) {
    let amount = 0;
    if (d.type === "ORDER_FIXED") {
      assertNonNegativeMoney(d.value, "fixed discount");
      amount = Math.min(d.value, remaining);
    } else if (d.type === "ORDER_PERCENTAGE") {
      assertMoney(d.value, "percentage bps");
      if (d.value < 0 || d.value > 10_000) {
        throw new Error("percentage discount must be 0–10000 basis points");
      }
      // Percentage of original subtotal, capped by remaining after line discounts
      amount = Math.min(Math.floor((subtotal * d.value) / 10_000), remaining);
    } else {
      throw new Error("unsupported discount type");
    }
    discountTotal += amount;
    remaining -= amount;
    discountBreakdown.push({ discountId: d.id, amountApplied: amount });
  }

  if (discountTotal > subtotal) {
    throw new Error("discountTotal cannot exceed subtotal");
  }
  const total = subtotal - discountTotal;
  if (total < 0) throw new Error("total cannot be negative");

  return { subtotal, discountTotal, total, discountBreakdown };
}

export function paymentSum(payments: PaymentDraft[]): number {
  return payments.reduce((sum, p) => {
    assertNonNegativeMoney(p.amount, "payment.amount");
    if (p.amount === 0) throw new Error("payment amount cannot be zero");
    return sum + p.amount;
  }, 0);
}

export function remainingDue(total: number, payments: PaymentDraft[]): number {
  if (payments.length === 0) return total;
  return total - paymentSum(payments.map((p) => ({ ...p })));
}

export function assertPaymentsMatchTotal(
  total: number,
  payments: PaymentDraft[],
): void {
  assertNonNegativeMoney(total, "total");
  // Zero-total checkout (e.g. full package redemption) needs no payment rows.
  if (total === 0) {
    if (payments.length === 0) return;
    const sum = paymentSum(payments);
    if (sum !== 0) {
      throw new Error(`payment total mismatch: paid ${sum} vs due 0`);
    }
    return;
  }
  if (payments.length === 0) throw new Error("at least one payment is required");
  const sum = paymentSum(payments);
  if (sum !== total) {
    throw new Error(`payment total mismatch: paid ${sum} vs due ${total}`);
  }
}
