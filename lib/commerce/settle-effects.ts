/**
 * Post-settle ledger orchestration — Phase 4.9B.
 * Called only after Transaction is created. Effects are idempotent via effectKey.
 */

import type { CheckoutDraft, Transaction } from "@/lib/commerce/domain";
import {
  createCustomerPackageFromPurchase,
  redeemPackageSession,
} from "@/lib/packages/store";
import {
  postStoredValuePayment,
  postStoredValueTopUp,
} from "@/lib/stored-value/store";

export function effectKey(
  transactionId: string,
  kind: string,
  sourceId: string,
): string {
  return `${transactionId}:${kind}:${sourceId}`;
}

/**
 * Apply package purchase / redemption and stored-value top-up / payment
 * after an immutable Transaction exists. Safe to retry.
 */
export function applyCommerceLedgerEffects(
  organizationId: string,
  transaction: Transaction,
  draft: CheckoutDraft,
): void {
  if (transaction.organizationId !== organizationId) {
    throw new Error("transaction organization mismatch");
  }
  const staffId = transaction.createdByStaffId;
  const locationId = transaction.locationId;

  // Package purchases
  for (const item of transaction.items) {
    if (item.type !== "PACKAGE_PURCHASE" || !item.referenceId) continue;
    createCustomerPackageFromPurchase(organizationId, {
      customerId: transaction.customerId,
      packageDefinitionId: item.referenceId,
      purchaseTransactionId: transaction.id,
      locationId,
      createdByStaffId: staffId,
      effectKey: effectKey(transaction.id, "PACKAGE_PURCHASE", item.id),
    });
  }

  // Stored value top-ups
  for (const item of transaction.items) {
    if (item.type !== "STORED_VALUE_TOP_UP") continue;
    postStoredValueTopUp(organizationId, {
      customerId: transaction.customerId,
      amount: item.lineTotal,
      transactionId: transaction.id,
      locationId,
      createdByStaffId: staffId,
      effectKey: effectKey(transaction.id, "STORED_VALUE_TOP_UP", item.id),
    });
  }

  // Package redemption (from draft selection — applied only on complete)
  if (draft.packageRedemption) {
    const red = draft.packageRedemption;
    redeemPackageSession(organizationId, {
      customerPackageId: red.customerPackageId,
      customerId: transaction.customerId,
      serviceId: red.serviceId,
      locationId,
      appointmentId: transaction.appointmentId,
      treatmentId: transaction.treatmentId,
      transactionId: transaction.id,
      createdByStaffId: staffId,
      effectKey: effectKey(
        transaction.id,
        "PACKAGE_REDEMPTION",
        red.customerPackageId,
      ),
    });
  }

  // Stored value payments
  for (const pay of transaction.payments) {
    if (pay.method !== "STORED_VALUE") continue;
    postStoredValuePayment(organizationId, {
      customerId: transaction.customerId,
      amount: pay.amount,
      transactionId: transaction.id,
      appointmentId: transaction.appointmentId,
      locationId,
      createdByStaffId: staffId,
      effectKey: effectKey(transaction.id, "STORED_VALUE_PAYMENT", pay.id),
    });
  }
}
