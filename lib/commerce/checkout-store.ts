import { listTodayAppointments } from "@/lib/appointments/store";
import { getCustomerById } from "@/data/mock-customers";
import { getServiceById } from "@/data/mock-services";
import { getScheduleAppointment } from "@/lib/appointments/store";
import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import { canAccessLocation } from "@/lib/tenant/access";
import { getCheckoutDraftsKey } from "@/lib/tenant/storage-keys";
import { newId } from "@/lib/repositories/storage";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import {
  getCompletedTreatmentsForCustomer,
  loadDraft,
} from "@/lib/treatment-draft";
import { getPackageDefinition } from "@/lib/packages/store";
import {
  getCustomerStoredValueBalance,
  getOrCreateStoredValueAccount,
} from "@/lib/stored-value/store";
import { getPackageUsableBalance, listUsablePackagesForService } from "@/lib/packages/store";
import {
  calculateTotals,
  recomputeItem,
} from "./calculations";
import {
  ACTIVE_PAYMENT_METHODS,
  CHECKOUT_ELIGIBLE_APPOINTMENT_STATUSES,
  DEFAULT_CURRENCY,
  EXTERNAL_PAYMENT_METHODS,
  type CheckoutDiscount,
  type CheckoutDraft,
  type CheckoutItemType,
  type DiscountType,
  type PackageRedemptionSelection,
  type PaymentDraft,
  type PaymentMethod,
} from "./domain";
import { assertNonNegativeMoney } from "./money";
import { getServicePriceMinor } from "./pricing";
import { applyCommerceLedgerEffects } from "./settle-effects";
import { hasCompletedTransactionForAppointment, createTransactionFromDraft, getTransactionByCheckoutDraftId, getCompletedTransactionForAppointment } from "./transaction-store";
import type { Transaction } from "./domain";

const CHANGE_EVENT = "enjoye-commerce-change";

export function subscribeCommerce(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function getCommerceRevision(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("beauty-os:commerce-rev") ?? "";
}

function emit(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("beauty-os:commerce-rev", String(Date.now()));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function readDrafts(organizationId: string): CheckoutDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getCheckoutDraftsKey(organizationId));
    if (!raw) return [];
    return (JSON.parse(raw) as CheckoutDraft[]).filter(
      (d) => d.organizationId === organizationId,
    );
  } catch {
    return [];
  }
}

function writeDrafts(organizationId: string, list: CheckoutDraft[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    getCheckoutDraftsKey(organizationId),
    JSON.stringify(list.filter((d) => d.organizationId === organizationId)),
  );
  emit();
}

function assertStaff(organizationId: string, staffId: string): void {
  const m = SEED_MEMBERSHIPS.find(
    (item) =>
      item.organizationId === organizationId &&
      item.userId === staffId &&
      item.isActive,
  );
  if (!m) throw new Error("Staff membership does not belong to this organization");
}

/** Fail closed when treatmentId is present but not owned by this org/appointment. */
function assertTreatmentRef(
  organizationId: string,
  treatmentId: string,
  apt: ScheduleAppointment,
): void {
  const live = loadDraft(organizationId, apt.id);
  if (live?.id === treatmentId) {
    if (live.organizationId && live.organizationId !== organizationId) {
      throw new Error("Treatment does not belong to this organization");
    }
    if (live.customerId !== apt.customerId) {
      throw new Error("Treatment customer mismatch");
    }
    return;
  }
  const completed = getCompletedTreatmentsForCustomer(organizationId, apt.customerId);
  const hit = completed.find((t) => t.id === treatmentId);
  if (hit) {
    if (hit.organizationId && hit.organizationId !== organizationId) {
      throw new Error("Treatment does not belong to this organization");
    }
    if (hit.appointmentId && hit.appointmentId !== apt.id) {
      throw new Error("Treatment does not belong to this appointment");
    }
    return;
  }
  throw new Error("Treatment not found");
}

function assertEditable(draft: CheckoutDraft): void {
  if (draft.status === "COMPLETED" || draft.status === "VOIDED") {
    throw new Error("completed checkout cannot be edited");
  }
}

function refreshTotals(draft: CheckoutDraft): CheckoutDraft {
  const items = draft.items.map((item) => recomputeItem(item));
  const totals = calculateTotals(items, draft.discounts);
  return {
    ...draft,
    items,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    total: totals.total,
    updatedAt: new Date().toISOString(),
  };
}

export function listCheckoutDrafts(
  organizationId: string,
  opts?: { locationId?: string; status?: CheckoutDraft["status"] },
): CheckoutDraft[] {
  let list = readDrafts(organizationId);
  if (opts?.locationId) list = list.filter((d) => d.locationId === opts.locationId);
  if (opts?.status) list = list.filter((d) => d.status === opts.status);
  return list;
}

export function getCheckoutDraft(
  organizationId: string,
  draftId: string,
): CheckoutDraft | undefined {
  return readDrafts(organizationId).find((d) => d.id === draftId);
}

export function getOpenDraftForAppointment(
  organizationId: string,
  appointmentId: string,
): CheckoutDraft | undefined {
  return readDrafts(organizationId).find(
    (d) =>
      d.appointmentId === appointmentId &&
      (d.status === "OPEN" || d.status === "READY"),
  );
}

export interface CreateCheckoutFromAppointmentInput {
  appointmentId: string;
  createdByStaffId: string;
  treatmentId?: string;
}

/**
 * Eligibility: appointment must be IN_SERVICE or COMPLETED,
 * same org, and not already have a COMPLETED transaction.
 * Location is taken from the appointment (not current UI location).
 */
export function createCheckoutFromAppointment(
  organizationId: string,
  input: CreateCheckoutFromAppointmentInput,
): CheckoutDraft {
  assertStaff(organizationId, input.createdByStaffId);
  const apt = getScheduleAppointment(organizationId, input.appointmentId);
  if (!apt || apt.organizationId !== organizationId) {
    throw new Error("Appointment not found");
  }
  if (!canAccessLocation(organizationId, apt.locationId)) {
    throw new Error("Location does not belong to this organization");
  }
  if (
    !(CHECKOUT_ELIGIBLE_APPOINTMENT_STATUSES as readonly string[]).includes(
      apt.status,
    )
  ) {
    throw new Error(
      `Appointment status ${apt.status} is not eligible for checkout`,
    );
  }
  if (hasCompletedTransactionForAppointment(organizationId, apt.id)) {
    throw new Error("Appointment already has a completed transaction");
  }

  const existing = getOpenDraftForAppointment(organizationId, apt.id);
  if (existing) {
    if (input.treatmentId && !existing.treatmentId) {
      const patched = { ...existing, treatmentId: input.treatmentId, updatedAt: new Date().toISOString() };
      writeDrafts(organizationId, [
        patched,
        ...readDrafts(organizationId).filter((d) => d.id !== patched.id),
      ]);
      return patched;
    }
    return existing;
  }

  if (input.treatmentId) {
    assertTreatmentRef(organizationId, input.treatmentId, apt);
  }

  const customer = getCustomerById(apt.customerId, organizationId);
  if (!customer || customer.organizationId !== organizationId) {
    throw new Error("Customer does not belong to this organization");
  }
  const service = getServiceById(apt.serviceId, organizationId);
  if (!service || service.organizationId !== organizationId) {
    throw new Error("Service does not belong to this organization");
  }

  const now = new Date().toISOString();
  const item = recomputeItem({
    id: newId("cli"),
    type: "SERVICE",
    referenceId: service.id,
    nameSnapshot: service.name,
    unitPrice: getServicePriceMinor(service),
    quantity: 1,
    discountAmount: 0,
  });

  const draft: CheckoutDraft = {
    id: newId("chk"),
    organizationId,
    locationId: apt.locationId,
    customerId: apt.customerId,
    appointmentId: apt.id,
    treatmentId: input.treatmentId,
    items: [item],
    discounts: [],
    payments: [],
    subtotal: item.lineSubtotal,
    discountTotal: 0,
    total: item.lineTotal,
    currency: DEFAULT_CURRENCY,
    status: "OPEN",
    createdByStaffId: input.createdByStaffId,
    createdAt: now,
    updatedAt: now,
  };

  writeDrafts(organizationId, [draft, ...readDrafts(organizationId)]);
  return draft;
}

export function createEmptyCheckoutDraft(
  organizationId: string,
  input: {
    locationId: string;
    customerId: string;
    createdByStaffId: string;
  },
): CheckoutDraft {
  assertStaff(organizationId, input.createdByStaffId);
  if (!canAccessLocation(organizationId, input.locationId)) {
    throw new Error("Location does not belong to this organization");
  }
  const customer = getCustomerById(input.customerId, organizationId);
  if (!customer || customer.organizationId !== organizationId) {
    throw new Error("Customer does not belong to this organization");
  }
  const now = new Date().toISOString();
  const draft: CheckoutDraft = {
    id: newId("chk"),
    organizationId,
    locationId: input.locationId,
    customerId: input.customerId,
    items: [],
    discounts: [],
    payments: [],
    subtotal: 0,
    discountTotal: 0,
    total: 0,
    currency: DEFAULT_CURRENCY,
    status: "OPEN",
    createdByStaffId: input.createdByStaffId,
    createdAt: now,
    updatedAt: now,
  };
  writeDrafts(organizationId, [draft, ...readDrafts(organizationId)]);
  return draft;
}

function saveDraft(organizationId: string, draft: CheckoutDraft): CheckoutDraft {
  if (draft.organizationId !== organizationId) {
    throw new Error("Checkout draft organization mismatch");
  }
  const next = refreshTotals(draft);
  const rest = readDrafts(organizationId).filter((d) => d.id !== next.id);
  writeDrafts(organizationId, [next, ...rest]);
  return next;
}

export function addCheckoutItem(
  organizationId: string,
  draftId: string,
  input: {
    type: CheckoutItemType;
    referenceId?: string;
    name: string;
    unitPrice: number;
    quantity?: number;
  },
): CheckoutDraft {
  const draft = getCheckoutDraft(organizationId, draftId);
  if (!draft) throw new Error("Checkout draft not found");
  assertEditable(draft);

  if (input.type === "SERVICE") {
    if (!input.referenceId) throw new Error("SERVICE item requires referenceId");
    const service = getServiceById(input.referenceId, organizationId);
    if (!service || service.organizationId !== organizationId) {
      throw new Error("Service does not belong to this organization");
    }
    const item = recomputeItem({
      id: newId("cli"),
      type: "SERVICE",
      referenceId: service.id,
      nameSnapshot: service.name,
      unitPrice: getServicePriceMinor(service),
      quantity: input.quantity ?? 1,
      discountAmount: 0,
    });
    return saveDraft(organizationId, {
      ...draft,
      items: [...draft.items, item],
    });
  }

  if (input.type === "PRODUCT") {
    throw new Error("PRODUCT items are not enabled");
  }

  if (input.type === "PACKAGE_PURCHASE") {
    if (!input.referenceId) throw new Error("PACKAGE_PURCHASE requires referenceId");
    const def = getPackageDefinition(organizationId, input.referenceId);
    if (!def || !def.isActive) throw new Error("Package definition not found or inactive");
    const item = recomputeItem({
      id: newId("cli"),
      type: "PACKAGE_PURCHASE",
      referenceId: def.id,
      nameSnapshot: def.name,
      unitPrice: def.priceMinor,
      quantity: 1,
      discountAmount: 0,
      sessionCountSnapshot: def.sessionCount,
    });
    return saveDraft(organizationId, {
      ...draft,
      items: [...draft.items, item],
    });
  }

  if (input.type === "STORED_VALUE_TOP_UP") {
    const amount = assertNonNegativeMoney(input.unitPrice, "top-up amount");
    if (amount === 0) throw new Error("top-up amount cannot be zero");
    const item = recomputeItem({
      id: newId("cli"),
      type: "STORED_VALUE_TOP_UP",
      nameSnapshot: `儲值 ${amount}`,
      unitPrice: amount,
      quantity: 1,
      discountAmount: 0,
    });
    return saveDraft(organizationId, {
      ...draft,
      items: [...draft.items, item],
    });
  }

  const item = recomputeItem({
    id: newId("cli"),
    type: "CUSTOM",
    nameSnapshot: input.name.trim() || "自訂項目",
    unitPrice: assertNonNegativeMoney(input.unitPrice, "unitPrice"),
    quantity: input.quantity ?? 1,
    discountAmount: 0,
  });
  return saveDraft(organizationId, {
    ...draft,
    items: [...draft.items, item],
  });
}

export function removeCheckoutItem(
  organizationId: string,
  draftId: string,
  itemId: string,
): CheckoutDraft {
  const draft = getCheckoutDraft(organizationId, draftId);
  if (!draft) throw new Error("Checkout draft not found");
  assertEditable(draft);
  return saveDraft(organizationId, {
    ...draft,
    items: draft.items.filter((i) => i.id !== itemId),
  });
}

export function updateCheckoutItemQuantity(
  organizationId: string,
  draftId: string,
  itemId: string,
  quantity: number,
): CheckoutDraft {
  const draft = getCheckoutDraft(organizationId, draftId);
  if (!draft) throw new Error("Checkout draft not found");
  assertEditable(draft);
  const items = draft.items.map((item) => {
    if (item.id !== itemId) return item;
    if (item.type === "SERVICE" && quantity !== 1) {
      // Services default to 1; allow override only if explicitly set for prototype flexibility
    }
    return recomputeItem({ ...item, quantity });
  });
  return saveDraft(organizationId, { ...draft, items });
}

export function setCheckoutDiscounts(
  organizationId: string,
  draftId: string,
  discounts: Array<{
    type: DiscountType;
    value: number;
    label?: string;
    reason?: string;
    createdByStaffId?: string;
  }>,
): CheckoutDraft {
  const draft = getCheckoutDraft(organizationId, draftId);
  if (!draft) throw new Error("Checkout draft not found");
  assertEditable(draft);
  const next: CheckoutDiscount[] = discounts.map((d) => ({
    id: newId("cds"),
    type: d.type,
    value: d.value,
    label: d.label,
    reason: d.reason,
    createdByStaffId: d.createdByStaffId,
  }));
  // validate via calculateTotals
  calculateTotals(draft.items, next);
  return saveDraft(organizationId, { ...draft, discounts: next });
}

export function setCheckoutPayments(
  organizationId: string,
  draftId: string,
  payments: Array<{
    method: PaymentMethod;
    amount: number;
    reference?: string;
    note?: string;
  }>,
): CheckoutDraft {
  const draft = getCheckoutDraft(organizationId, draftId);
  if (!draft) throw new Error("Checkout draft not found");
  assertEditable(draft);

  const hasTopUp = draft.items.some((i) => i.type === "STORED_VALUE_TOP_UP");
  const next: PaymentDraft[] = payments.map((p) => {
    if (!ACTIVE_PAYMENT_METHODS.includes(p.method)) {
      throw new Error(`unsupported payment method: ${p.method}`);
    }
    if (p.method === "PACKAGE") {
      throw new Error("unsupported payment method: PACKAGE");
    }
    if (hasTopUp && p.method === "STORED_VALUE") {
      throw new Error("stored value cannot purchase stored-value top-up");
    }
    assertNonNegativeMoney(p.amount, "payment.amount");
    if (p.amount === 0) throw new Error("payment amount cannot be zero");
    if (p.method === "STORED_VALUE") {
      const bal = getCustomerStoredValueBalance(organizationId, draft.customerId);
      if (p.amount > bal) throw new Error("insufficient stored value balance");
      // ensure account exists for customer
      getOrCreateStoredValueAccount(organizationId, draft.customerId, draft.createdByStaffId);
    }
    return {
      id: newId("pay"),
      method: p.method,
      amount: p.amount,
      reference: p.reference,
      note: p.note,
    };
  });

  const refreshed = refreshTotals({ ...draft, payments: next });
  const svPay = next.filter((p) => p.method === "STORED_VALUE").reduce((s, p) => s + p.amount, 0);
  if (svPay > refreshed.total) {
    throw new Error("stored value amount cannot exceed checkout total");
  }
  return saveDraft(organizationId, { ...draft, payments: next });
}

/**
 * Select package redemption for the primary SERVICE line.
 * Does NOT deduct sessions until completeCheckout.
 * Zeros covered service line via line discount so payable can be 0.
 */
export function setPackageRedemption(
  organizationId: string,
  draftId: string,
  selection: PackageRedemptionSelection | null,
): CheckoutDraft {
  const draft = getCheckoutDraft(organizationId, draftId);
  if (!draft) throw new Error("Checkout draft not found");
  assertEditable(draft);

  if (!selection) {
    const items = draft.items.map((item) => {
      if (item.type !== "SERVICE") return item;
      return recomputeItem({ ...item, discountAmount: 0 });
    });
    return saveDraft(organizationId, {
      ...draft,
      packageRedemption: undefined,
      items,
    });
  }

  if (selection.sessions !== 1) throw new Error("only 1 session redemption supported");
  const usable = listUsablePackagesForService(
    organizationId,
    draft.customerId,
    selection.serviceId,
  );
  const pkg = usable.find((p) => p.id === selection.customerPackageId);
  if (!pkg) throw new Error("Package not usable for this service");
  const bal = getPackageUsableBalance(organizationId, selection.customerPackageId);
  if (bal.usableBalance < 1) throw new Error("insufficient package sessions");

  const items = draft.items.map((item) => {
    if (item.type !== "SERVICE" || item.referenceId !== selection.serviceId) {
      return item;
    }
    return recomputeItem({
      ...item,
      discountAmount: item.lineSubtotal,
    });
  });

  return saveDraft(organizationId, {
    ...draft,
    packageRedemption: selection,
    items,
  });
}

/** Settle OPEN/READY draft → immutable COMPLETED transaction + ledger effects.
 * Retry-safe: returns existing TX and re-applies idempotent ledger effects when needed.
 */
export function completeCheckout(
  organizationId: string,
  draftId: string,
): Transaction {
  const draft = getCheckoutDraft(organizationId, draftId);
  if (!draft || draft.organizationId !== organizationId) {
    throw new Error("Checkout draft not found");
  }

  // Already completed — return linked transaction (UI double-submit)
  if (draft.status === "COMPLETED") {
    const existing =
      getTransactionByCheckoutDraftId(organizationId, draftId) ??
      (draft.appointmentId
        ? getCompletedTransactionForAppointment(organizationId, draft.appointmentId)
        : undefined);
    if (existing) return existing;
    throw new Error("checkout already completed");
  }
  if (draft.status === "VOIDED") {
    throw new Error("checkout already completed");
  }

  // Resume: TX exists for this draft (or appointment) but draft not marked COMPLETED
  const orphan =
    getTransactionByCheckoutDraftId(organizationId, draftId) ??
    (draft.appointmentId
      ? getCompletedTransactionForAppointment(organizationId, draft.appointmentId)
      : undefined);
  if (orphan) {
    applyCommerceLedgerEffects(organizationId, orphan, draft);
    markCheckoutCompleted(organizationId, draftId);
    return orphan;
  }

  // Pre-validate tenders / redemptions before creating transaction (no financial writes yet)
  if (draft.packageRedemption) {
    const red = draft.packageRedemption;
    const bal = getPackageUsableBalance(organizationId, red.customerPackageId);
    if (bal.status === "EXPIRED") throw new Error("Package expired");
    if (bal.status === "VOIDED") throw new Error("Package voided");
    if (bal.usableBalance < 1) throw new Error("insufficient package sessions");
    const usable = listUsablePackagesForService(
      organizationId,
      draft.customerId,
      red.serviceId,
    );
    if (!usable.some((p) => p.id === red.customerPackageId)) {
      throw new Error("Package not usable for this service");
    }
  }
  for (const pay of draft.payments) {
    if (pay.method === "STORED_VALUE") {
      const bal = getCustomerStoredValueBalance(organizationId, draft.customerId);
      if (pay.amount > bal) throw new Error("insufficient stored value balance");
    }
  }
  if (draft.items.some((i) => i.type === "STORED_VALUE_TOP_UP")) {
    const hasExternal = draft.payments.some((p) =>
      EXTERNAL_PAYMENT_METHODS.includes(p.method),
    );
    const hasSv = draft.payments.some((p) => p.method === "STORED_VALUE");
    if (hasSv) throw new Error("stored value cannot purchase stored-value top-up");
    if (draft.total > 0 && !hasExternal && draft.payments.length === 0) {
      throw new Error("top-up requires external payment");
    }
  }

  const transaction = createTransactionFromDraft(organizationId, draft);
  applyCommerceLedgerEffects(organizationId, transaction, draft);
  markCheckoutCompleted(organizationId, draftId);
  return transaction;
}

export function markCheckoutReady(
  organizationId: string,
  draftId: string,
): CheckoutDraft {
  const draft = getCheckoutDraft(organizationId, draftId);
  if (!draft) throw new Error("Checkout draft not found");
  assertEditable(draft);
  if (draft.items.length === 0) throw new Error("checkout requires at least one item");
  return saveDraft(organizationId, { ...draft, status: "READY" });
}

/** Internal: mark draft COMPLETED after transaction settle */
export function markCheckoutCompleted(
  organizationId: string,
  draftId: string,
): void {
  const draft = getCheckoutDraft(organizationId, draftId);
  if (!draft || draft.organizationId !== organizationId) return;
  const next: CheckoutDraft = {
    ...draft,
    status: "COMPLETED",
    updatedAt: new Date().toISOString(),
  };
  const rest = readDrafts(organizationId).filter((d) => d.id !== draftId);
  writeDrafts(organizationId, [next, ...rest]);
}

export type CheckoutCandidate = {
  appointmentId: string;
  customerId: string;
  customerName: string;
  serviceName: string;
  staffName: string;
  status: string;
  startAt: string;
  alreadyCheckedOut: boolean;
};

export function listCheckoutCandidates(
  organizationId: string,
  locationId: string,
  day: Date = new Date(),
): CheckoutCandidate[] {
  return listTodayAppointments(organizationId, locationId, day)
    .filter((a) =>
      (CHECKOUT_ELIGIBLE_APPOINTMENT_STATUSES as readonly string[]).includes(a.status),
    )
    .map((a) => ({
      appointmentId: a.id,
      customerId: a.customerId,
      customerName: a.customerName,
      serviceName: a.serviceName,
      staffName: a.staffName,
      status: a.status,
      startAt: a.startAt,
      alreadyCheckedOut: hasCompletedTransactionForAppointment(organizationId, a.id),
    }));
}
