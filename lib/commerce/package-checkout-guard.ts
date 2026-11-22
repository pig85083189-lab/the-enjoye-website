import type { CheckoutDraft } from "./domain";

/** No partial package settlement: reject mixed carts, discounts and invalid snapshots. */
export function validateAtomicPackagePurchaseDraft(
  draft: CheckoutDraft,
): string | null {
  if (draft.status !== "OPEN" && draft.status !== "READY") return "結帳單狀態無法收款";
  if (draft.packageRedemption) return "購買套票不可同時扣堂";
  if (draft.items.length !== 1 || draft.items[0]?.type !== "PACKAGE_PURCHASE") {
    return "套票購買目前僅支援單一方案";
  }
  const item = draft.items[0];
  if (!item.referenceId || item.quantity !== 1 || !item.sessionCountSnapshot ||
      item.sessionCountSnapshot < 1 || item.unitPrice < 0 ||
      item.lineSubtotal !== item.unitPrice || item.lineTotal !== item.unitPrice ||
      item.discountAmount !== 0 || draft.discounts.length !== 0 ||
      draft.subtotal !== item.lineSubtotal || draft.discountTotal !== 0 ||
      draft.total !== item.lineTotal) {
    return "套票方案、價格或折扣資料不一致";
  }
  const paid = draft.payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (paid !== draft.total || draft.payments.some((payment) =>
    !Number.isSafeInteger(payment.amount) || payment.amount <= 0 || payment.method === "PACKAGE"
  )) {
    return "套票付款金額不符";
  }
  return null;
}
