/**
 * Remote commerce hydrate / save / settle rules.
 * Production writes go through the matching Postgres RPCs.
 * Tests and the in-memory RPC fake execute this engine so behavior stays aligned.
 */

import { newId } from "@/lib/repositories/storage";
import { isAuthUuid } from "@/lib/staff-auth/staff-id";
import { canCheckout, type CapabilityActor } from "@/lib/staff-auth/operational-capabilities";
import {
  calculateTotals,
  recomputeItem,
  assertPaymentsMatchTotal,
} from "./calculations";
import {
  COMMERCE_MISSING_SERVICE_PRICE_MESSAGE,
  COMMERCE_PAYMENT_MISMATCH_MESSAGE,
  COMMERCE_STALE_WRITE_MESSAGE,
  COMMERCE_TREATMENT_NOT_COMPLETED_MESSAGE,
  CommerceWriteNotFoundError,
  CommerceWritePilotDeniedError,
  CommerceWriteStaleError,
} from "./commerce-remote-write-errors";
import { assertRemoteCheckoutPaymentMethod } from "./commerce-remote-payments";
import { DEFAULT_CURRENCY, type CheckoutDraft, type Transaction } from "./domain";
import { assertNonNegativeMoney } from "./money";

export const COMMERCE_HYDRATE_RPC = "hydrate_checkout_from_treatment";
export const COMMERCE_PACKAGE_HYDRATE_RPC = "hydrate_checkout_from_package";
export const COMMERCE_SAVE_RPC = "save_checkout_draft";
export const COMMERCE_SETTLE_RPC = "settle_checkout_draft";

export type CommerceEngineAppointment = {
  appId: string;
  dbId: string;
  organizationAppId: string;
  organizationDbId: string;
  locationAppId: string;
  locationDbId: string;
  customerAppId: string;
  customerDbId: string;
  serviceAppId: string;
  serviceDbId: string;
  status: string;
};

export type CommerceEngineTreatment = {
  appId: string;
  dbId: string;
  organizationDbId: string;
  locationDbId: string;
  appointmentDbId: string;
  customerDbId: string;
  serviceDbId: string;
  status: string;
};

export type CommerceEngineService = {
  appId: string;
  dbId: string;
  organizationDbId: string;
  name: string;
  priceMinor: number | null;
};

export type CommerceEngineCustomer = {
  appId: string;
  dbId: string;
  organizationAppId: string;
  organizationDbId: string;
};

export type CommerceEngineLocation = {
  appId: string;
  dbId: string;
  organizationDbId: string;
};

export type CommerceEnginePackageDefinition = {
  appId: string;
  dbId: string;
  organizationDbId: string;
  name: string;
  sessionCount: number;
  priceMinor: number;
  isActive: boolean;
};

export type CommerceEnginePackageSnapshot = {
  now: Date;
  actor: CommerceEngineActor;
  customer: CommerceEngineCustomer;
  location: CommerceEngineLocation;
  packageDefinition: CommerceEnginePackageDefinition;
  drafts: CheckoutDraft[];
  transactions: Transaction[];
};

export type CommerceEngineActor = {
  authUserId: string;
  organizationAppId: string;
  organizationDbId: string;
  operationalStaffId: string;
  role: string;
  isActive: boolean;
  allowedLocationAppIds: string[] | null;
};

export type CommerceDraftBundle = {
  draft: CheckoutDraft;
  transaction: Transaction | null;
};

export type CommerceEngineSnapshot = {
  now: Date;
  actor: CommerceEngineActor;
  appointment: CommerceEngineAppointment;
  treatment: CommerceEngineTreatment;
  service: CommerceEngineService;
  drafts: CheckoutDraft[];
  transactions: Transaction[];
  failSettleAfterLock?: boolean;
};

export function assertCommerceWriteRole(actor: CapabilityActor): void {
  if (!canCheckout(actor)) {
    throw new CommerceWritePilotDeniedError();
  }
}

export function assertOperationalCreatedBy(staffId: string): string {
  if (!staffId || isAuthUuid(staffId)) {
    throw new Error("結帳人員身分無效");
  }
  return staffId;
}

function actorCanAccessLocation(
  actor: CommerceEngineActor,
  locationAppId: string,
): boolean {
  if (actor.allowedLocationAppIds == null) return true;
  return actor.allowedLocationAppIds.includes(locationAppId);
}

function assertActorBoundary(
  snapshot: { actor: CommerceEngineActor },
  organizationDbId: string,
  locationAppId: string,
): void {
  if (!snapshot.actor.isActive) {
    throw new CommerceWritePilotDeniedError();
  }
  assertCommerceWriteRole({
    role: snapshot.actor.role,
    isActive: snapshot.actor.isActive,
  });
  if (snapshot.actor.organizationDbId !== organizationDbId) {
    throw new CommerceWritePilotDeniedError();
  }
  if (!actorCanAccessLocation(snapshot.actor, locationAppId)) {
    throw new CommerceWritePilotDeniedError();
  }
  assertOperationalCreatedBy(snapshot.actor.operationalStaffId);
}

function assertEligibleTreatment(snapshot: CommerceEngineSnapshot): void {
  const { appointment, treatment, service } = snapshot;
  if (appointment.status === "CANCELLED") {
    throw new Error("已取消的預約無法結帳");
  }
  if (appointment.status === "NO_SHOW") {
    throw new Error("未到店的預約無法結帳");
  }
  if (appointment.status === "DRAFT") {
    throw new Error("草稿預約無法結帳");
  }
  if (treatment.status !== "COMPLETED") {
    throw new Error(COMMERCE_TREATMENT_NOT_COMPLETED_MESSAGE);
  }
  if (treatment.organizationDbId !== appointment.organizationDbId) {
    throw new CommerceWritePilotDeniedError();
  }
  if (treatment.appointmentDbId !== appointment.dbId) {
    throw new Error("療程與預約不符");
  }
  if (treatment.customerDbId !== appointment.customerDbId) {
    throw new Error("療程客戶不符");
  }
  if (treatment.locationDbId !== appointment.locationDbId) {
    throw new Error("療程分店不符");
  }
  if (service.organizationDbId !== appointment.organizationDbId) {
    throw new CommerceWritePilotDeniedError();
  }
  if (service.dbId !== appointment.serviceDbId) {
    throw new Error("服務與預約不符");
  }
  if (typeof service.priceMinor !== "number") {
    throw new Error(COMMERCE_MISSING_SERVICE_PRICE_MESSAGE);
  }
  assertNonNegativeMoney(service.priceMinor, "service.priceMinor");
}

function openDraftForAppointment(
  snapshot: CommerceEngineSnapshot,
  appointmentAppId: string,
): CheckoutDraft | undefined {
  return snapshot.drafts.find(
    (draft) =>
      draft.appointmentId === appointmentAppId &&
      (draft.status === "OPEN" || draft.status === "READY"),
  );
}

function completedTransactionFor(
  snapshot: CommerceEngineSnapshot,
  input: { appointmentAppId?: string; draftId?: string },
): Transaction | undefined {
  return snapshot.transactions.find(
    (tx) =>
      tx.status === "COMPLETED" &&
      ((input.draftId && tx.checkoutDraftId === input.draftId) ||
        (input.appointmentAppId && tx.appointmentId === input.appointmentAppId)),
  );
}

function requireDraft(
  snapshot: CommerceEngineSnapshot,
  draftId: string,
): CheckoutDraft {
  const draft = snapshot.drafts.find((row) => row.id === draftId);
  if (!draft) throw new CommerceWriteNotFoundError();
  return draft;
}

export function assembleCheckoutTotals(draft: CheckoutDraft): CheckoutDraft {
  const items = draft.items.map((item) =>
    recomputeItem({
      id: item.id,
      type: item.type,
      referenceId: item.referenceId,
      nameSnapshot: item.nameSnapshot,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      discountAmount: item.discountAmount,
      sessionCountSnapshot: item.sessionCountSnapshot,
    }),
  );
  const totals = calculateTotals(items, draft.discounts);
  return {
    ...draft,
    items,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    total: totals.total,
  };
}

export function nextRemoteTransactionNumber(
  existing: Transaction[],
  organizationId: string,
  completedAt: Date,
): string {
  const y = completedAt.getFullYear();
  const m = String(completedAt.getMonth() + 1).padStart(2, "0");
  const d = String(completedAt.getDate()).padStart(2, "0");
  const prefix = `TX-${y}${m}${d}-`;
  let max = 0;
  for (const tx of existing) {
    if (tx.organizationId !== organizationId) continue;
    if (!tx.transactionNumber.startsWith(prefix)) continue;
    const seq = Number(tx.transactionNumber.slice(prefix.length));
    if (Number.isInteger(seq) && seq > max) max = seq;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export function hydrateCheckoutFromTreatment(
  snapshot: CommerceEngineSnapshot,
): CommerceDraftBundle {
  assertActorBoundary(
    snapshot,
    snapshot.appointment.organizationDbId,
    snapshot.appointment.locationAppId,
  );
  assertEligibleTreatment(snapshot);

  const existingCompleted = completedTransactionFor(snapshot, {
    appointmentAppId: snapshot.appointment.appId,
  });
  const existingOpen = openDraftForAppointment(snapshot, snapshot.appointment.appId);
  if (existingOpen) {
    return {
      draft: existingOpen,
      transaction: existingCompleted ?? null,
    };
  }
  if (existingCompleted) {
    const completedDraft = snapshot.drafts.find(
      (draft) => draft.id === existingCompleted.checkoutDraftId,
    );
    if (completedDraft) {
      return { draft: completedDraft, transaction: existingCompleted };
    }
  }

  const now = snapshot.now.toISOString();
  const item = recomputeItem({
    id: newId("cli"),
    type: "SERVICE",
    referenceId: snapshot.service.appId,
    nameSnapshot: snapshot.service.name,
    unitPrice: snapshot.service.priceMinor as number,
    quantity: 1,
    discountAmount: 0,
  });
  const draft = assembleCheckoutTotals({
    id: newId("chk"),
    organizationId: snapshot.appointment.organizationAppId,
    locationId: snapshot.appointment.locationAppId,
    customerId: snapshot.appointment.customerAppId,
    appointmentId: snapshot.appointment.appId,
    treatmentId: snapshot.treatment.appId,
    items: [item],
    discounts: [],
    payments: [],
    subtotal: item.lineSubtotal,
    discountTotal: 0,
    total: item.lineTotal,
    currency: DEFAULT_CURRENCY,
    status: "OPEN",
    createdByStaffId: snapshot.actor.operationalStaffId,
    createdAt: now,
    updatedAt: now,
  });
  snapshot.drafts = [draft, ...snapshot.drafts];
  return { draft, transaction: existingCompleted ?? null };
}

function openUnscheduledDraftForCustomer(
  snapshot: CommerceEnginePackageSnapshot,
  customerAppId: string,
): CheckoutDraft | undefined {
  return snapshot.drafts.find(
    (draft) =>
      draft.customerId === customerAppId &&
      !draft.appointmentId &&
      (draft.status === "OPEN" || draft.status === "READY"),
  );
}

export function hydrateCheckoutFromPackage(
  snapshot: CommerceEnginePackageSnapshot,
): CommerceDraftBundle {
  assertActorBoundary(
    snapshot,
    snapshot.customer.organizationDbId,
    snapshot.location.appId,
  );
  if (snapshot.location.organizationDbId !== snapshot.customer.organizationDbId) {
    throw new CommerceWritePilotDeniedError();
  }
  if (snapshot.packageDefinition.organizationDbId !== snapshot.customer.organizationDbId) {
    throw new CommerceWritePilotDeniedError();
  }
  if (!snapshot.packageDefinition.isActive) {
    throw new Error("套票方案已停用，無法結帳");
  }
  if (!Number.isInteger(snapshot.packageDefinition.sessionCount) || snapshot.packageDefinition.sessionCount < 1) {
    throw new Error("套票堂數尚未設定，無法結帳");
  }
  assertNonNegativeMoney(snapshot.packageDefinition.priceMinor, "package.priceMinor");

  const matching = snapshot.drafts.find(
    (draft) =>
      draft.customerId === snapshot.customer.appId &&
      !draft.appointmentId &&
      (draft.status === "OPEN" || draft.status === "READY") &&
      draft.items.some(
        (item) =>
          item.type === "PACKAGE_PURCHASE" &&
          item.referenceId === snapshot.packageDefinition.appId,
      ),
  );
  if (matching) {
    return { draft: matching, transaction: null };
  }

  const existingOpen = openUnscheduledDraftForCustomer(snapshot, snapshot.customer.appId);
  if (existingOpen) {
    return { draft: existingOpen, transaction: null };
  }

  const now = snapshot.now.toISOString();
  const item = recomputeItem({
    id: newId("cli"),
    type: "PACKAGE_PURCHASE",
    referenceId: snapshot.packageDefinition.appId,
    nameSnapshot: snapshot.packageDefinition.name,
    unitPrice: snapshot.packageDefinition.priceMinor,
    quantity: 1,
    discountAmount: 0,
    sessionCountSnapshot: snapshot.packageDefinition.sessionCount,
  });
  const draft = assembleCheckoutTotals({
    id: newId("chk"),
    organizationId: snapshot.customer.organizationAppId,
    locationId: snapshot.location.appId,
    customerId: snapshot.customer.appId,
    items: [item],
    discounts: [],
    payments: [],
    subtotal: item.lineSubtotal,
    discountTotal: 0,
    total: item.lineTotal,
    currency: DEFAULT_CURRENCY,
    status: "OPEN",
    createdByStaffId: snapshot.actor.operationalStaffId,
    createdAt: now,
    updatedAt: now,
  });
  snapshot.drafts = [draft, ...snapshot.drafts];
  return { draft, transaction: null };
}

export function saveCheckoutDraft(
  snapshot: CommerceEngineSnapshot,
  input: {
    draftId: string;
    expectedUpdatedAt: string;
    payments: CheckoutDraft["payments"];
    discounts: CheckoutDraft["discounts"];
  },
): CommerceDraftBundle {
  const current = requireDraft(snapshot, input.draftId);
  assertActorBoundary(snapshot, snapshot.appointment.organizationDbId, current.locationId);
  if (current.updatedAt !== input.expectedUpdatedAt) {
    throw new CommerceWriteStaleError();
  }
  if (current.status === "COMPLETED" || current.status === "VOIDED") {
    throw new Error("已完成的結帳不能再修改");
  }
  for (const payment of input.payments) {
    assertRemoteCheckoutPaymentMethod(payment.method);
    assertNonNegativeMoney(payment.amount, "payment.amount");
    if (payment.amount === 0) throw new Error("付款金額不可為 0");
  }
  const next = assembleCheckoutTotals({
    ...current,
    payments: input.payments.map((payment) => ({
      ...payment,
      id: payment.id || newId("pay"),
    })),
    discounts: input.discounts.map((discount) => ({
      ...discount,
      id: discount.id || newId("cds"),
    })),
    updatedAt: snapshot.now.toISOString(),
  });
  snapshot.drafts = [next, ...snapshot.drafts.filter((row) => row.id !== next.id)];
  return {
    draft: next,
    transaction: completedTransactionFor(snapshot, { draftId: next.id }) ?? null,
  };
}

export function settleCheckoutDraft(
  snapshot: CommerceEngineSnapshot,
  input: {
    draftId: string;
    expectedUpdatedAt: string;
  },
): CommerceDraftBundle {
  const current = requireDraft(snapshot, input.draftId);
  assertActorBoundary(snapshot, snapshot.appointment.organizationDbId, current.locationId);
  if (current.status === "COMPLETED") {
    const existing = completedTransactionFor(snapshot, {
      draftId: current.id,
      appointmentAppId: current.appointmentId,
    });
    if (existing) return { draft: current, transaction: existing };
    throw new Error("結帳已完成，但找不到交易");
  }
  if (current.status === "VOIDED") {
    throw new Error("已作廢的結帳不能收款");
  }
  if (current.status !== "OPEN" && current.status !== "READY") {
    throw new Error("結帳狀態無法收款");
  }
  if (current.updatedAt !== input.expectedUpdatedAt) {
    throw new CommerceWriteStaleError(COMMERCE_STALE_WRITE_MESSAGE);
  }

  assertEligibleTreatment(snapshot);

  const existing = completedTransactionFor(snapshot, {
    draftId: current.id,
    appointmentAppId: current.appointmentId,
  });
  if (existing) {
    const completed: CheckoutDraft = {
      ...current,
      status: "COMPLETED",
      updatedAt: snapshot.now.toISOString(),
    };
    snapshot.drafts = [completed, ...snapshot.drafts.filter((row) => row.id !== current.id)];
    return { draft: completed, transaction: existing };
  }

  const assembled = assembleCheckoutTotals(current);
  try {
    assertPaymentsMatchTotal(assembled.total, assembled.payments);
  } catch (error) {
    throw new Error(COMMERCE_PAYMENT_MISMATCH_MESSAGE, { cause: error });
  }
  for (const payment of assembled.payments) {
    assertRemoteCheckoutPaymentMethod(payment.method);
  }
  if (assembled.items.length === 0) {
    throw new Error("結帳至少需要一個項目");
  }

  if (snapshot.failSettleAfterLock) {
    throw new Error("settlement_forced_failure");
  }

  const completedAt = snapshot.now.toISOString();
  const transaction: Transaction = {
    id: newId("tx"),
    organizationId: assembled.organizationId,
    locationId: assembled.locationId,
    customerId: assembled.customerId,
    appointmentId: assembled.appointmentId,
    treatmentId: assembled.treatmentId,
    checkoutDraftId: assembled.id,
    transactionNumber: nextRemoteTransactionNumber(
      snapshot.transactions,
      assembled.organizationId,
      snapshot.now,
    ),
    status: "COMPLETED",
    items: assembled.items.map((item) => ({ ...item })),
    discounts: assembled.discounts.map((discount, index) => ({
      id: discount.id,
      type: discount.type,
      value: discount.value,
      label: discount.label,
      reason: discount.reason,
      amountApplied:
        calculateTotals(assembled.items, assembled.discounts).discountBreakdown[index]
          ?.amountApplied ?? 0,
    })),
    payments: assembled.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount: payment.amount,
      reference: payment.reference,
      note: payment.note,
      paidAt: completedAt,
    })),
    subtotal: assembled.subtotal,
    discountTotal: assembled.discountTotal,
    total: assembled.total,
    currency: assembled.currency,
    createdByStaffId: snapshot.actor.operationalStaffId,
    completedAt,
  };
  const completedDraft: CheckoutDraft = {
    ...assembled,
    status: "COMPLETED",
    updatedAt: completedAt,
  };
  snapshot.transactions = [transaction, ...snapshot.transactions];
  snapshot.drafts = [
    completedDraft,
    ...snapshot.drafts.filter((row) => row.id !== assembled.id),
  ];
  return { draft: completedDraft, transaction };
}

export function commerceEngineErrorName(error: unknown): string {
  if (error instanceof CommerceWriteStaleError) return "checkout_stale";
  if (error instanceof CommerceWritePilotDeniedError) return "checkout_forbidden";
  if (error instanceof CommerceWriteNotFoundError) return "checkout_not_found";
  return "checkout_failed";
}
