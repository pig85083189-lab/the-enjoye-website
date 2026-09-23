import { getCustomerById } from "@/data/mock-customers";
import { canAccessLocation } from "@/lib/tenant/access";
import {
  getTransactionCounterKey,
  getTransactionsKey,
} from "@/lib/tenant/storage-keys";
import { newId } from "@/lib/repositories/storage";
import type {
  Transaction,
  TransactionDiscountSnapshot,
  TransactionItemSnapshot,
  TransactionPaymentSnapshot,
} from "./domain";
import type { CheckoutDraft } from "./domain";
import { assertPaymentsMatchTotal, calculateTotals } from "./calculations";

function emit(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("beauty-os:commerce-rev", String(Date.now()));
  window.dispatchEvent(new Event("enjoye-commerce-change"));
}

function readTransactions(organizationId: string): Transaction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getTransactionsKey(organizationId));
    if (!raw) return [];
    return (JSON.parse(raw) as Transaction[]).filter(
      (t) => t.organizationId === organizationId,
    );
  } catch {
    return [];
  }
}

function writeTransactions(organizationId: string, list: Transaction[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    getTransactionsKey(organizationId),
    JSON.stringify(list.filter((t) => t.organizationId === organizationId)),
  );
  emit();
}

function nextTransactionNumber(organizationId: string, completedAt: Date): string {
  const key = getTransactionCounterKey(organizationId);
  const y = completedAt.getFullYear();
  const m = String(completedAt.getMonth() + 1).padStart(2, "0");
  const d = String(completedAt.getDate()).padStart(2, "0");
  const dayKey = `${y}${m}${d}`;
  let map: Record<string, number> = {};
  try {
    const raw = localStorage.getItem(key);
    if (raw) map = JSON.parse(raw) as Record<string, number>;
  } catch {
    map = {};
  }
  const seq = (map[dayKey] ?? 0) + 1;
  map[dayKey] = seq;
  localStorage.setItem(key, JSON.stringify(map));
  return `TX-${dayKey}-${String(seq).padStart(4, "0")}`;
}

export function listTransactions(
  organizationId: string,
  opts?: {
    locationId?: string;
    customerId?: string;
    from?: Date;
    to?: Date;
    status?: Transaction["status"];
  },
): Transaction[] {
  let list = readTransactions(organizationId);
  if (opts?.locationId) list = list.filter((t) => t.locationId === opts.locationId);
  if (opts?.customerId) list = list.filter((t) => t.customerId === opts.customerId);
  if (opts?.status) list = list.filter((t) => t.status === opts.status);
  if (opts?.from || opts?.to) {
    const from = opts.from?.getTime() ?? Number.NEGATIVE_INFINITY;
    const to = opts.to?.getTime() ?? Number.POSITIVE_INFINITY;
    list = list.filter((t) => {
      const ts = new Date(t.completedAt).getTime();
      return ts >= from && ts <= to;
    });
  }
  return list.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

export function getTransaction(
  organizationId: string,
  transactionId: string,
): Transaction | undefined {
  return readTransactions(organizationId).find((t) => t.id === transactionId);
}

export function hasCompletedTransactionForAppointment(
  organizationId: string,
  appointmentId: string,
): boolean {
  return readTransactions(organizationId).some(
    (t) =>
      t.appointmentId === appointmentId &&
      t.status === "COMPLETED" &&
      t.organizationId === organizationId,
  );
}

export function getCompletedTransactionForAppointment(
  organizationId: string,
  appointmentId: string,
): Transaction | undefined {
  return readTransactions(organizationId).find(
    (t) =>
      t.appointmentId === appointmentId &&
      t.status === "COMPLETED" &&
      t.organizationId === organizationId,
  );
}

export function getTransactionByCheckoutDraftId(
  organizationId: string,
  checkoutDraftId: string,
): Transaction | undefined {
  return readTransactions(organizationId).find(
    (t) =>
      t.checkoutDraftId === checkoutDraftId &&
      t.status === "COMPLETED" &&
      t.organizationId === organizationId,
  );
}

/**
 * Persist immutable transaction from a validated checkout draft snapshot.
 * Caller owns draft lifecycle (mark completed).
 */
export function createTransactionFromDraft(
  organizationId: string,
  draft: CheckoutDraft,
): Transaction {
  if (draft.organizationId !== organizationId) {
    throw new Error("Checkout draft organization mismatch");
  }
  if (!canAccessLocation(organizationId, draft.locationId)) {
    throw new Error("Location does not belong to this organization");
  }
  const customer = getCustomerById(draft.customerId, organizationId);
  if (!customer || customer.organizationId !== organizationId) {
    throw new Error("Customer does not belong to this organization");
  }
  if (draft.items.length === 0) {
    throw new Error("checkout requires at least one item");
  }
  if (
    draft.appointmentId &&
    hasCompletedTransactionForAppointment(organizationId, draft.appointmentId)
  ) {
    throw new Error("Appointment already has a completed transaction");
  }

  const totals = calculateTotals(draft.items, draft.discounts);
  assertPaymentsMatchTotal(totals.total, draft.payments);

  const now = new Date();
  const completedAt = now.toISOString();
  const items: TransactionItemSnapshot[] = draft.items.map((item) => ({
    id: item.id,
    type: item.type,
    referenceId: item.referenceId,
    nameSnapshot: item.nameSnapshot,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    lineSubtotal: item.lineSubtotal,
    discountAmount: item.discountAmount,
    lineTotal: item.lineTotal,
    sessionCountSnapshot: item.sessionCountSnapshot,
  }));
  const discounts: TransactionDiscountSnapshot[] = totals.discountBreakdown.map(
    (row) => {
      const src = draft.discounts.find((d) => d.id === row.discountId)!;
      return {
        id: src.id,
        type: src.type,
        value: src.value,
        label: src.label,
        reason: src.reason,
        amountApplied: row.amountApplied,
      };
    },
  );
  const payments: TransactionPaymentSnapshot[] = draft.payments.map((p) => ({
    id: p.id,
    method: p.method,
    amount: p.amount,
    reference: p.reference,
    note: p.note,
    paidAt: completedAt,
  }));

  const transaction: Transaction = {
    id: newId("txn"),
    organizationId,
    locationId: draft.locationId,
    customerId: draft.customerId,
    appointmentId: draft.appointmentId,
    treatmentId: draft.treatmentId,
    checkoutDraftId: draft.id,
    transactionNumber: nextTransactionNumber(organizationId, now),
    status: "COMPLETED",
    items,
    discounts,
    payments,
    packageRedemption: draft.packageRedemption,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    total: totals.total,
    currency: draft.currency,
    createdByStaffId: draft.createdByStaffId,
    completedAt,
  };

  writeTransactions(organizationId, [transaction, ...readTransactions(organizationId)]);
  return transaction;
}

/**
 * Mark COMPLETED → VOIDED. Does not mutate items / payments / totals.
 * Idempotent when already VOIDED (returns existing row).
 */
export function markTransactionVoided(
  organizationId: string,
  transactionId: string,
  input: {
    voidedByStaffId: string;
    voidReason: string;
    voidedAt?: string;
  },
): Transaction {
  const list = readTransactions(organizationId);
  const existing = list.find((t) => t.id === transactionId);
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Transaction not found");
  }
  if (existing.status === "VOIDED") {
    return existing;
  }
  if (existing.status !== "COMPLETED") {
    throw new Error("Only COMPLETED transactions can be voided");
  }
  const reason = input.voidReason.trim();
  if (!reason) throw new Error("void reason required");

  const next: Transaction = {
    ...existing,
    status: "VOIDED",
    voidedAt: input.voidedAt ?? new Date().toISOString(),
    voidedBy: input.voidedByStaffId,
    voidReason: reason,
  };
  writeTransactions(
    organizationId,
    list.map((t) => (t.id === transactionId ? next : t)),
  );
  return next;
}
