import type {
  CheckoutDiscount,
  CheckoutDraft,
  CheckoutItem,
  PaymentDraft,
  Transaction,
  TransactionDiscountSnapshot,
  TransactionItemSnapshot,
  TransactionPaymentSnapshot,
} from "@/lib/commerce/domain";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asOptionalString(value: unknown): string | undefined {
  const text = asString(value).trim();
  return text ? text : undefined;
}

export function checkoutItemFromRemoteJson(row: Record<string, unknown>): CheckoutItem {
  return {
    id: asString(row.id),
    type: asString(row.type) as CheckoutItem["type"],
    referenceId: asOptionalString(row.referenceId),
    nameSnapshot: asString(row.nameSnapshot),
    unitPrice: asNumber(row.unitPrice),
    quantity: asNumber(row.quantity),
    lineSubtotal: asNumber(row.lineSubtotal),
    discountAmount: asNumber(row.discountAmount),
    lineTotal: asNumber(row.lineTotal),
    sessionCountSnapshot:
      typeof row.sessionCountSnapshot === "number" ? row.sessionCountSnapshot : undefined,
  };
}

export function checkoutDiscountFromRemoteJson(
  row: Record<string, unknown>,
): CheckoutDiscount {
  return {
    id: asString(row.id),
    type: asString(row.type) as CheckoutDiscount["type"],
    value: asNumber(row.value),
    label: asOptionalString(row.label),
    reason: asOptionalString(row.reason),
    createdByStaffId: asOptionalString(row.createdByStaffId),
  };
}

export function checkoutPaymentFromRemoteJson(row: Record<string, unknown>): PaymentDraft {
  return {
    id: asString(row.id),
    method: asString(row.method) as PaymentDraft["method"],
    amount: asNumber(row.amount),
    reference: asOptionalString(row.reference),
    note: asOptionalString(row.note),
  };
}

export function checkoutDraftFromRemoteJson(row: Record<string, unknown>): CheckoutDraft {
  return {
    id: asString(row.id),
    organizationId: asString(row.organizationId),
    locationId: asString(row.locationId),
    customerId: asString(row.customerId),
    appointmentId: asOptionalString(row.appointmentId),
    treatmentId: asOptionalString(row.treatmentId),
    items: Array.isArray(row.items)
      ? row.items.map((item) => checkoutItemFromRemoteJson(item as Record<string, unknown>))
      : [],
    discounts: Array.isArray(row.discounts)
      ? row.discounts.map((item) =>
          checkoutDiscountFromRemoteJson(item as Record<string, unknown>),
        )
      : [],
    payments: Array.isArray(row.payments)
      ? row.payments.map((item) =>
          checkoutPaymentFromRemoteJson(item as Record<string, unknown>),
        )
      : [],
    subtotal: asNumber(row.subtotal),
    discountTotal: asNumber(row.discountTotal),
    total: asNumber(row.total),
    currency: asString(row.currency) || "TWD",
    status: asString(row.status) as CheckoutDraft["status"],
    createdByStaffId: asString(row.createdByStaffId),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

export function transactionFromRemoteJson(row: Record<string, unknown>): Transaction {
  return {
    id: asString(row.id),
    organizationId: asString(row.organizationId),
    locationId: asString(row.locationId),
    customerId: asString(row.customerId),
    appointmentId: asOptionalString(row.appointmentId),
    treatmentId: asOptionalString(row.treatmentId),
    checkoutDraftId: asOptionalString(row.checkoutDraftId),
    transactionNumber: asString(row.transactionNumber),
    status: asString(row.status) as Transaction["status"],
    items: Array.isArray(row.items)
      ? (row.items as Record<string, unknown>[]).map((item) => ({
          id: asString(item.id),
          type: asString(item.type) as TransactionItemSnapshot["type"],
          referenceId: asOptionalString(item.referenceId),
          nameSnapshot: asString(item.nameSnapshot),
          unitPrice: asNumber(item.unitPrice),
          quantity: asNumber(item.quantity),
          lineSubtotal: asNumber(item.lineSubtotal),
          discountAmount: asNumber(item.discountAmount),
          lineTotal: asNumber(item.lineTotal),
          sessionCountSnapshot:
            typeof item.sessionCountSnapshot === "number"
              ? item.sessionCountSnapshot
              : undefined,
        }))
      : [],
    discounts: Array.isArray(row.discounts)
      ? (row.discounts as Record<string, unknown>[]).map((item) => ({
          id: asString(item.id),
          type: asString(item.type) as TransactionDiscountSnapshot["type"],
          value: asNumber(item.value),
          label: asOptionalString(item.label),
          reason: asOptionalString(item.reason),
          amountApplied: asNumber(item.amountApplied),
        }))
      : [],
    payments: Array.isArray(row.payments)
      ? (row.payments as Record<string, unknown>[]).map((item) => ({
          id: asString(item.id),
          method: asString(item.method) as TransactionPaymentSnapshot["method"],
          amount: asNumber(item.amount),
          reference: asOptionalString(item.reference),
          note: asOptionalString(item.note),
          paidAt: asString(item.paidAt),
        }))
      : [],
    subtotal: asNumber(row.subtotal),
    discountTotal: asNumber(row.discountTotal),
    total: asNumber(row.total),
    currency: asString(row.currency) || "TWD",
    createdByStaffId: asString(row.createdByStaffId),
    completedAt: asString(row.completedAt),
    voidedAt: asOptionalString(row.voidedAt),
    voidedBy: asOptionalString(row.voidedBy),
    voidReason: asOptionalString(row.voidReason),
  };
}

export function commerceBundleFromRemoteJson(payload: unknown): {
  draft: CheckoutDraft;
  transaction: Transaction | null;
} {
  const row = (payload ?? {}) as Record<string, unknown>;
  const draftRaw = (row.draft ?? row) as Record<string, unknown>;
  return {
    draft: checkoutDraftFromRemoteJson(draftRaw),
    transaction: row.transaction
      ? transactionFromRemoteJson(row.transaction as Record<string, unknown>)
      : null,
  };
}
