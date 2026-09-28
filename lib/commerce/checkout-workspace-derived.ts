/**
 * Checkout Workspace presentation helpers — derived view only.
 * Reads existing appointments, checkout drafts, and transactions.
 * Does not persist a second checkout status or store.
 */
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import { membershipBadge } from "@/lib/customers/crm-derived";
import { remainingDue } from "@/lib/commerce/calculations";
import {
  CHECKOUT_ELIGIBLE_APPOINTMENT_STATUSES,
  DEFAULT_SERVICE_PRICE_MINOR,
  type CheckoutDraft,
  type PaymentDraft,
  type Transaction,
} from "@/lib/commerce/domain";
import type { Customer } from "@/types";

export const CHECKOUT_PANEL_WIDTH_PX = 400;
export const CHECKOUT_INLINE_MIN_PX = 1200;
export const CHECKOUT_WORKSPACE_GAP_PX = 16;

export type CheckoutListFilter = "pending" | "paid" | "all";
export type CheckoutDateFilter = "today" | "7d" | "all";
export type CheckoutRowKind = "appointment" | "draft" | "transaction";

export type CheckoutWorkspaceStatusKind =
  | "pending"
  | "paid"
  | "in_service"
  | "other";

export const MUTED_CHECKOUT_APPOINTMENT_STATUSES = new Set([
  "CANCELLED",
  "NO_SHOW",
  "DRAFT",
]);

export interface CheckoutCatalogHint {
  id: string;
  name: string;
  durationMinutes?: number;
  priceMinor?: number;
  serviceType?: string;
  category?: string;
}

export interface CheckoutWorkspaceStatusView {
  kind: CheckoutWorkspaceStatusKind;
  title: string;
}

export interface CheckoutWorkspaceItem {
  id: string;
  kind: CheckoutRowKind;
  appointmentId: string;
  draftId: string;
  transactionId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerInitials: string;
  membership: { id: "vip" | "new"; label: string } | null;
  serviceName: string;
  serviceCategory: string;
  durationMinutes: number | null;
  staffName: string;
  staffInitials: string;
  startAt: string | null;
  amountMinor: number | null;
  paid: boolean;
  status: CheckoutWorkspaceStatusView;
  appointment: ScheduleAppointment | null;
  draft: CheckoutDraft | null;
  transaction: Transaction | null;
}

export interface CheckoutWorkspaceSummary {
  pending: number;
  completedService: number;
  inService: number;
  todayRevenueMinor: number;
}

function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function initialsFrom(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "—";
}

export function isCheckoutEligibleStatus(status: string): boolean {
  return (CHECKOUT_ELIGIBLE_APPOINTMENT_STATUSES as readonly string[]).includes(
    status,
  );
}

export function isMutedCheckoutAppointmentStatus(status: string): boolean {
  return MUTED_CHECKOUT_APPOINTMENT_STATUSES.has(status);
}

export function checkoutRowId(
  kind: CheckoutRowKind,
  entityId: string,
): string {
  return `${kind}:${entityId}`;
}

export function parseCheckoutRowId(
  id: string | null,
): { kind: CheckoutRowKind; entityId: string } | null {
  if (!id || typeof id !== "string") return null;
  const split = id.indexOf(":");
  if (split <= 0) return null;
  const kind = id.slice(0, split) as CheckoutRowKind;
  const entityId = id.slice(split + 1);
  if (!entityId) return null;
  if (kind !== "appointment" && kind !== "draft" && kind !== "transaction") {
    return null;
  }
  return { kind, entityId };
}

export function deriveCheckoutRowStatus(input: {
  kind: CheckoutRowKind;
  appointmentStatus?: string;
  paid: boolean;
}): CheckoutWorkspaceStatusView {
  if (input.paid || input.kind === "transaction") {
    return { kind: "paid", title: "已結帳" };
  }
  if (input.appointmentStatus === "IN_SERVICE") {
    return { kind: "in_service", title: "服務中" };
  }
  if (input.kind === "draft" || input.appointmentStatus === "COMPLETED") {
    return { kind: "pending", title: "待結帳" };
  }
  return { kind: "other", title: "其他" };
}

export function itemOccursOn(item: {
  startAt: string | null;
  completedAt?: string;
  createdAt?: string;
}): Date | null {
  return (
    parseInstant(item.startAt) ??
    parseInstant(item.completedAt ?? null) ??
    parseInstant(item.createdAt ?? null)
  );
}

export function matchesCheckoutDateFilter(
  when: Date | null,
  filter: CheckoutDateFilter,
  now: Date,
): boolean {
  if (filter === "all") return true;
  if (!when) return false;
  if (filter === "today") return localDayKey(when) === localDayKey(now);
  const from = startOfLocalDay(now);
  from.setDate(from.getDate() - 6);
  const point = startOfLocalDay(when);
  return (
    point.getTime() >= from.getTime() &&
    point.getTime() <= startOfLocalDay(now).getTime()
  );
}

export function lookupServicePriceMinor(
  catalog: CheckoutCatalogHint[],
  serviceId: string,
): number | null {
  const service = catalog.find((item) => item.id === serviceId);
  if (!service) return null;
  if (typeof service.priceMinor === "number") return service.priceMinor;
  return DEFAULT_SERVICE_PRICE_MINOR;
}

export function buildCheckoutWorkspaceItems(input: {
  appointments: ScheduleAppointment[];
  transactions: Transaction[];
  openDrafts: CheckoutDraft[];
  customers: Customer[];
  catalog: CheckoutCatalogHint[];
  locationId?: string;
}): CheckoutWorkspaceItem[] {
  const locationOk = (locationId: string | undefined) =>
    !input.locationId || !locationId || locationId === input.locationId;

  const customersById = new Map(input.customers.map((item) => [item.id, item]));
  const paidByAppointment = new Map<string, Transaction>();
  const txRows: CheckoutWorkspaceItem[] = [];

  for (const tx of input.transactions) {
    if (tx.status !== "COMPLETED") continue;
    if (!locationOk(tx.locationId)) continue;
    if (tx.appointmentId) paidByAppointment.set(tx.appointmentId, tx);
    txRows.push(toTransactionItem(tx, customersById, input.catalog));
  }

  const openByAppointment = new Map<string, CheckoutDraft>();
  const walkInDrafts: CheckoutWorkspaceItem[] = [];
  for (const draft of input.openDrafts) {
    if (draft.status !== "OPEN" && draft.status !== "READY") continue;
    if (!locationOk(draft.locationId)) continue;
    if (draft.appointmentId) {
      openByAppointment.set(draft.appointmentId, draft);
      continue;
    }
    walkInDrafts.push(toDraftItem(draft, customersById, input.catalog));
  }

  const appointmentRows: CheckoutWorkspaceItem[] = [];
  for (const appointment of input.appointments) {
    if (!locationOk(appointment.locationId)) continue;
    if (isMutedCheckoutAppointmentStatus(appointment.status)) continue;
    if (!isCheckoutEligibleStatus(appointment.status)) continue;
    const paidTx = paidByAppointment.get(appointment.id);
    if (paidTx) continue;
    appointmentRows.push(
      toAppointmentItem({
        appointment,
        draft: openByAppointment.get(appointment.id) ?? null,
        customer: customersById.get(appointment.customerId),
        catalog: input.catalog,
      }),
    );
  }

  return [...appointmentRows, ...walkInDrafts, ...txRows].sort((a, b) => {
    const aTime = a.startAt ?? a.transaction?.completedAt ?? a.draft?.createdAt ?? "";
    const bTime = b.startAt ?? b.transaction?.completedAt ?? b.draft?.createdAt ?? "";
    return aTime.localeCompare(bTime);
  });
}

function toAppointmentItem(input: {
  appointment: ScheduleAppointment;
  draft: CheckoutDraft | null;
  customer?: Customer;
  catalog: CheckoutCatalogHint[];
}): CheckoutWorkspaceItem {
  const appointment = input.appointment;
  const customer = input.customer;
  const catalogService = input.catalog.find((item) => item.id === appointment.serviceId);
  const amountMinor =
    input.draft?.total ??
    lookupServicePriceMinor(input.catalog, appointment.serviceId);
  return {
    id: checkoutRowId("appointment", appointment.id),
    kind: "appointment",
    appointmentId: appointment.id,
    draftId: input.draft?.id ?? "",
    transactionId: "",
    customerId: appointment.customerId,
    customerName: customer?.name || appointment.customerName,
    customerPhone: customer?.phone ?? "",
    customerInitials: initialsFrom(customer?.name || appointment.customerName),
    membership: customer
      ? membershipBadge(customer)
      : appointment.membership === "vip"
        ? { id: "vip", label: "VIP" }
        : appointment.membership === "new"
          ? { id: "new", label: "新客" }
          : null,
    serviceName: catalogService?.name || appointment.serviceName,
    serviceCategory: catalogService?.category ?? "",
    durationMinutes:
      catalogService?.durationMinutes ?? appointment.durationMinutes ?? null,
    staffName: appointment.staffName,
    staffInitials: initialsFrom(appointment.staffName),
    startAt: appointment.startAt,
    amountMinor,
    paid: false,
    status: deriveCheckoutRowStatus({
      kind: "appointment",
      appointmentStatus: appointment.status,
      paid: false,
    }),
    appointment,
    draft: input.draft,
    transaction: null,
  };
}

function toDraftItem(
  draft: CheckoutDraft,
  customersById: Map<string, Customer>,
  catalog: CheckoutCatalogHint[],
): CheckoutWorkspaceItem {
  const customer = customersById.get(draft.customerId);
  const primary = draft.items.find((item) => item.type === "SERVICE") ?? draft.items[0];
  const catalogService = primary?.referenceId
    ? catalog.find((item) => item.id === primary.referenceId)
    : undefined;
  const name = customer?.name || draft.customerId;
  return {
    id: checkoutRowId("draft", draft.id),
    kind: "draft",
    appointmentId: "",
    draftId: draft.id,
    transactionId: "",
    customerId: draft.customerId,
    customerName: name,
    customerPhone: customer?.phone ?? "",
    customerInitials: initialsFrom(name),
    membership: customer ? membershipBadge(customer) : null,
    serviceName: primary?.nameSnapshot || "一般銷售",
    serviceCategory: catalogService?.category ?? "",
    durationMinutes: catalogService?.durationMinutes ?? null,
    staffName: "",
    staffInitials: "",
    startAt: draft.createdAt,
    amountMinor: draft.total,
    paid: false,
    status: deriveCheckoutRowStatus({ kind: "draft", paid: false }),
    appointment: null,
    draft,
    transaction: null,
  };
}

function toTransactionItem(
  tx: Transaction,
  customersById: Map<string, Customer>,
  catalog: CheckoutCatalogHint[],
): CheckoutWorkspaceItem {
  const customer = customersById.get(tx.customerId);
  const primary = tx.items[0];
  const catalogService = primary?.referenceId
    ? catalog.find((item) => item.id === primary.referenceId)
    : undefined;
  const name = customer?.name || tx.customerId;
  return {
    id: checkoutRowId("transaction", tx.id),
    kind: "transaction",
    appointmentId: tx.appointmentId ?? "",
    draftId: tx.checkoutDraftId ?? "",
    transactionId: tx.id,
    customerId: tx.customerId,
    customerName: name,
    customerPhone: customer?.phone ?? "",
    customerInitials: initialsFrom(name),
    membership: customer ? membershipBadge(customer) : null,
    serviceName: primary?.nameSnapshot || tx.transactionNumber,
    serviceCategory: catalogService?.category ?? "",
    durationMinutes: catalogService?.durationMinutes ?? null,
    staffName: "",
    staffInitials: "",
    startAt: tx.completedAt,
    amountMinor: tx.total,
    paid: true,
    status: deriveCheckoutRowStatus({ kind: "transaction", paid: true }),
    appointment: null,
    draft: null,
    transaction: tx,
  };
}

export function itemMatchesPendingFilter(item: CheckoutWorkspaceItem): boolean {
  return !item.paid && (item.status.kind === "pending" || item.status.kind === "in_service");
}

export function filterCheckoutItems(
  items: CheckoutWorkspaceItem[],
  filter: CheckoutListFilter,
  query: string,
  dateFilter: CheckoutDateFilter,
  now: Date,
): CheckoutWorkspaceItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter === "pending" && !itemMatchesPendingFilter(item)) return false;
    if (filter === "paid" && !item.paid) return false;
    const when = itemOccursOn({
      startAt: item.startAt,
      completedAt: item.transaction?.completedAt,
      createdAt: item.draft?.createdAt,
    });
    if (!matchesCheckoutDateFilter(when, dateFilter, now)) return false;
    if (!q) return true;
    return (
      item.customerName.toLowerCase().includes(q) ||
      item.serviceName.toLowerCase().includes(q) ||
      item.staffName.toLowerCase().includes(q)
    );
  });
}

export function countCheckoutSummary(
  items: CheckoutWorkspaceItem[],
  appointments: ScheduleAppointment[],
  now: Date,
): CheckoutWorkspaceSummary {
  const todayAppointments = appointments.filter((item) => {
    const start = parseInstant(item.startAt);
    return start ? localDayKey(start) === localDayKey(now) : false;
  });
  const pending = items.filter((item) => {
    const when = itemOccursOn({
      startAt: item.startAt,
      completedAt: item.transaction?.completedAt,
      createdAt: item.draft?.createdAt,
    });
    return itemMatchesPendingFilter(item) && matchesCheckoutDateFilter(when, "today", now);
  });
  const todayRevenueMinor = items
    .filter((item) => item.paid && item.transaction)
    .filter((item) => {
      const when = parseInstant(item.transaction?.completedAt);
      return when ? localDayKey(when) === localDayKey(now) : false;
    })
    .reduce((sum, item) => sum + (item.amountMinor ?? 0), 0);

  return {
    pending: pending.length,
    completedService: todayAppointments.filter((item) => item.status === "COMPLETED")
      .length,
    inService: todayAppointments.filter((item) => item.status === "IN_SERVICE").length,
    todayRevenueMinor,
  };
}

export function remapCheckoutSelection(
  items: CheckoutWorkspaceItem[],
  selectedId: string | null,
): string | null {
  if (!selectedId) return null;
  if (items.some((item) => item.id === selectedId)) return selectedId;
  const parsed = parseCheckoutRowId(selectedId);
  if (!parsed) return selectedId;
  if (parsed.kind === "appointment") {
    return (
      items.find((item) => item.appointmentId === parsed.entityId)?.id ??
      selectedId
    );
  }
  if (parsed.kind === "draft") {
    return items.find((item) => item.draftId === parsed.entityId)?.id ?? selectedId;
  }
  return selectedId;
}

export function resolveSelectedCheckout(
  items: CheckoutWorkspaceItem[],
  selectedId: string | null,
): CheckoutWorkspaceItem | null {
  if (!selectedId) return null;
  const remapped = remapCheckoutSelection(items, selectedId);
  return items.find((item) => item.id === remapped) ?? null;
}

export function shouldResetCheckoutSelection(input: {
  selectedId: string | null;
  visibleItems: CheckoutWorkspaceItem[];
}): boolean {
  if (!input.selectedId) return false;
  return !input.visibleItems.some((item) => item.id === input.selectedId);
}

export function shouldRenderCheckoutPanel(
  selected: CheckoutWorkspaceItem | null,
): boolean {
  return selected !== null;
}

export function isInlineCheckoutPanelViewport(widthPx: number): boolean {
  return widthPx >= CHECKOUT_INLINE_MIN_PX;
}

export function checkoutListPresentation(
  widthPx: number,
): "desktop-rows" | "mobile-cards" {
  return isInlineCheckoutPanelViewport(widthPx) ? "desktop-rows" : "mobile-cards";
}

export function isCheckoutRowKeyboardActivation(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function checkoutRemainingDue(
  total: number,
  payments: PaymentDraft[],
): number {
  if (payments.length === 0) return total;
  return remainingDue(total, payments);
}

export function canConfirmCheckoutPayment(input: {
  itemCount: number;
  total: number;
  payments: PaymentDraft[];
}): boolean {
  if (input.itemCount <= 0) return false;
  return checkoutRemainingDue(input.total, input.payments) === 0;
}

export function mixedPaymentRemaining(
  total: number,
  parts: Partial<Record<"CASH" | "CARD" | "STORED_VALUE", number>>,
): number {
  const cash = parts.CASH ?? 0;
  const card = parts.CARD ?? 0;
  const stored = parts.STORED_VALUE ?? 0;
  return total - cash - card - stored;
}

export function isMixedPaymentComplete(
  total: number,
  parts: Partial<Record<"CASH" | "CARD" | "STORED_VALUE", number>>,
): boolean {
  return mixedPaymentRemaining(total, parts) === 0;
}

export function checkoutVisitCountLabel(
  totalVisits: number | undefined,
): string | null {
  if (!totalVisits || totalVisits <= 0) return null;
  return `第 ${totalVisits} 次來店`;
}

/** Line discounts applied by package redemption (not order promotions). */
export function packageRedemptionDiscountMinor(
  draft: CheckoutDraft | null,
): number {
  if (!draft?.packageRedemption) return 0;
  return draft.items
    .filter((item) => item.type === "SERVICE")
    .reduce((sum, item) => sum + item.discountAmount, 0);
}

export function storedValuePaymentMinor(payments: PaymentDraft[]): number {
  return payments
    .filter((item) => item.method === "STORED_VALUE")
    .reduce((sum, item) => sum + item.amount, 0);
}

export function promotionDiscountMinor(draft: CheckoutDraft | null): number {
  if (!draft) return 0;
  return Math.max(0, draft.discountTotal - packageRedemptionDiscountMinor(draft));
}
