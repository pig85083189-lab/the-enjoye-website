import type { CheckoutDraft } from "./domain";

/** Package redemption is a single zero-value SERVICE settlement, not a tender. */
export function validateAtomicPackageRedemptionDraft(
  draft: CheckoutDraft,
): string | null {
  const redemption = draft.packageRedemption;
  if (!redemption || !redemption.customerPackageId || !redemption.serviceId ||
      redemption.sessions !== 1) return "請選擇有效的套票及指定療程";
  if (draft.status !== "OPEN" && draft.status !== "READY") return "結帳單狀態無法扣堂";
  if (draft.items.length !== 1 || draft.items[0]?.type !== "SERVICE") {
    return "套票扣堂只支援單一指定療程";
  }
  const item = draft.items[0];
  if (!item.referenceId || item.referenceId !== redemption.serviceId ||
      item.quantity !== 1 || item.unitPrice !== 0 ||
      item.lineSubtotal !== 0 || item.discountAmount !== 0 ||
      item.lineTotal !== 0 || draft.subtotal !== 0 ||
      draft.discountTotal !== 0 || draft.total !== 0 ||
      draft.payments.length !== 0 || draft.discounts.length !== 0) {
    return "套票扣堂必須是無付款、無折扣的零元指定療程";
  }
  return null;
}
