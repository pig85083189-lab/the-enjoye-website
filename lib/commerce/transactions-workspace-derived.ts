/**
 * Transactions Workspace — presentation helpers only.
 * Source of truth remains Transaction via listTransactions / completeCheckout.
 * Does not persist a second transaction store, balance, status, or payment system.
 */
import { membershipBadge } from "@/lib/customers/crm-derived";
import {
  EXTERNAL_PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  TRANSACTION_STATUS_LABEL,
  type PaymentMethod,
  type Transaction,
  type TransactionItemSnapshot,
  type TransactionPaymentSnapshot,
  type TransactionStatus,
} from "@/lib/commerce/domain";
import { CHECKOUT_ITEM_TYPE_LABEL } from "@/lib/products/domain";
import type { Customer } from "@/types";

export const TRANSACTIONS_PANEL_WIDTH_PX = 400;
export const TRANSACTIONS_INLINE_MIN_PX = 1200;
export const TRANSACTIONS_WORKSPACE_GAP_PX = 16;

/** Domain flags — UI must not invent missing accounting dimensions. */
export const TRANSACTIONS_HAS_PENDING_STATUS = false;
export const TRANSACTIONS_HAS_BALANCE_FIELD = false;
export const TRANSACTIONS_HAS_EXPORT = false;
export const TRANSACTIONS_PACKAGE_IS_PAYMENT_METHOD = false;

export const TRANSACTIONS_DISPLAY_TIMEZONE = "Asia/Taipei";

export type TransactionListStatusFilter = "all" | TransactionStatus;
export type TransactionDateFilter = "today" | "yesterday" | "7d" | "month" | "all";
export type TransactionPaymentFilter =
  | "all"
  | Extract<PaymentMethod, "CASH" | "CARD" | "TRANSFER" | "OTHER" | "STORED_VALUE">;

export const TRANSACTION_STATUS_FILTER_OPTIONS: Array<{
  id: TransactionListStatusFilter;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "COMPLETED", label: TRANSACTION_STATUS_LABEL.COMPLETED },
  { id: "VOIDED", label: TRANSACTION_STATUS_LABEL.VOIDED },
];

export const TRANSACTION_DATE_FILTER_OPTIONS: Array<{
  id: TransactionDateFilter;
  label: string;
}> = [
  { id: "today", label: "今天" },
  { id: "yesterday", label: "昨天" },
  { id: "7d", label: "最近 7 天" },
  { id: "month", label: "本月" },
  { id: "all", label: "全部" },
];

export const TRANSACTION_PAYMENT_FILTER_OPTIONS: Array<{
  id: TransactionPaymentFilter;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "CASH", label: PAYMENT_METHOD_LABEL.CASH },
  { id: "CARD", label: PAYMENT_METHOD_LABEL.CARD },
  { id: "TRANSFER", label: PAYMENT_METHOD_LABEL.TRANSFER },
  { id: "OTHER", label: PAYMENT_METHOD_LABEL.OTHER },
  { id: "STORED_VALUE", label: PAYMENT_METHOD_LABEL.STORED_VALUE },
];

export const TRANSACTION_EXTERNAL_BREAKDOWN_METHODS: Array<
  Extract<PaymentMethod, "CASH" | "CARD" | "TRANSFER" | "OTHER">
> = ["CASH", "CARD", "TRANSFER", "OTHER"];

export interface TransactionCatalogHint {
  id: string;
  name: string;
  durationMinutes?: number;
  category?: string;
}

export interface TransactionAppointmentHint {
  id: string;
  staffId?: string;
  staffName?: string;
  locationId?: string;
}

export interface TransactionLocationHint {
  id: string;
  name: string;
}

export interface TransactionStaffHint {
  id: string;
  displayName: string;
}

export interface TransactionWorkspaceStatusView {
  kind: TransactionStatus;
  title: string;
}

export interface TransactionWorkspaceRow {
  transactionId: string;
  transactionNumber: string;
  organizationId: string;
  locationId: string;
  locationName: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerInitials: string;
  membership: { id: "vip" | "new"; label: string } | null;
  status: TransactionWorkspaceStatusView;
  completedAt: string;
  voidedAt?: string;
  createdByStaffId: string;
  cashierName: string;
  beauticianName: string;
  beauticianInitials: string;
  lineSummary: string;
  extraItemCount: number;
  paymentBadge: string;
  mixedPayment: boolean;
  paymentMethods: PaymentMethod[];
  totalMinor: number;
  subtotalMinor: number;
  discountTotalMinor: number;
  promotionDiscountMinor: number;
  packageRedemptionMinor: number;
  storedValueTenderMinor: number;
  externalInflowMinor: number;
  currency: string;
  transaction: Transaction;
}

export interface TransactionWorkspaceSummary {
  todayExternalInflowMinor: number;
  todayTransactionCount: number;
  monthExternalInflowMinor: number;
  voidedCount: number;
}

export interface TransactionPaymentBreakdownRow {
  method: PaymentMethod | "PACKAGE_REDEMPTION";
  label: string;
  amountMinor: number;
  count: number;
  kind: "external" | "non_cash";
}

export interface TransactionTodayPaymentBreakdown {
  external: TransactionPaymentBreakdownRow[];
  nonCash: TransactionPaymentBreakdownRow[];
}

export interface TransactionLineItemView {
  id: string;
  name: string;
  type: TransactionItemSnapshot["type"];
  typeLabel: string;
  quantity: number;
  unitPriceMinor: number;
  lineSubtotalMinor: number;
  discountAmountMinor: number;
  lineTotalMinor: number;
  durationMinutes: number | null;
  sessionCount: number | null;
}

export interface TransactionPaymentView {
  id: string;
  method: PaymentMethod;
  label: string;
  amountMinor: number;
  kind: "external" | "stored_value" | "other";
}

export interface TransactionQuickViewModel {
  transactionId: string;
  transactionNumber: string;
  status: TransactionWorkspaceStatusView;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerInitials: string;
  completedAt: string;
  completedLabel: { dateLabel: string; timeLabel: string };
  lineItems: TransactionLineItemView[];
  subtotalMinor: number;
  promotionDiscountMinor: number;
  packageRedemptionMinor: number;
  storedValueTenderMinor: number;
  totalMinor: number;
  externalInflowMinor: number;
  payments: TransactionPaymentView[];
  mixedPayment: boolean;
  cashierName: string;
  beauticianName: string;
  locationName: string;
  voidedAt?: string;
  voidReason?: string;
  voidedBy?: string;
}

function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function zonedYmd(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TRANSACTIONS_DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function zonedYearMonth(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TRANSACTIONS_DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).format(date);
}

function startOfZonedDay(now: Date): Date {
  const [year, month, day] = zonedYmd(now).split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function initialsFrom(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "—";
}

export function isExternalPaymentMethod(method: PaymentMethod): boolean {
  return (EXTERNAL_PAYMENT_METHODS as PaymentMethod[]).includes(method);
}

export function uniquePaymentMethods(
  payments: TransactionPaymentSnapshot[],
): PaymentMethod[] {
  const seen: PaymentMethod[] = [];
  for (const payment of payments) {
    if (!seen.includes(payment.method)) seen.push(payment.method);
  }
  return seen;
}

export function isMixedPayment(payments: TransactionPaymentSnapshot[]): boolean {
  return uniquePaymentMethods(payments).length > 1;
}

export function paymentBadgeLabel(payments: TransactionPaymentSnapshot[]): string {
  const methods = uniquePaymentMethods(payments);
  if (methods.length === 0) return "無需付款";
  if (methods.length > 1) return "混合付款";
  return PAYMENT_METHOD_LABEL[methods[0]];
}

export function externalInflowMinor(transaction: Transaction): number {
  if (transaction.status !== "COMPLETED") return 0;
  return transaction.payments
    .filter((payment) => isExternalPaymentMethod(payment.method))
    .reduce((sum, payment) => sum + payment.amount, 0);
}

export function storedValueTenderMinor(transaction: Transaction): number {
  return transaction.payments
    .filter((payment) => payment.method === "STORED_VALUE")
    .reduce((sum, payment) => sum + payment.amount, 0);
}

/** Package redemption is a SERVICE line discount, not a payment method. */
export function packageRedemptionMinor(transaction: Transaction): number {
  if (!transaction.packageRedemption) return 0;
  return transaction.items
    .filter((item) => item.type === "SERVICE")
    .reduce((sum, item) => sum + item.discountAmount, 0);
}

export function promotionDiscountMinor(transaction: Transaction): number {
  return Math.max(0, transaction.discountTotal - packageRedemptionMinor(transaction));
}

export function summarizeLineItems(items: TransactionItemSnapshot[]): {
  primaryName: string;
  extraCount: number;
  label: string;
} {
  if (items.length === 0) {
    return { primaryName: "一般銷售", extraCount: 0, label: "一般銷售" };
  }
  const primaryName = items[0]?.nameSnapshot?.trim() || "一般銷售";
  const extraCount = Math.max(0, items.length - 1);
  return {
    primaryName,
    extraCount,
    label: extraCount > 0 ? `${primaryName} + ${extraCount} 項` : primaryName,
  };
}

export function formatTransactionTimestamp(iso: string | null | undefined): {
  dateLabel: string;
  timeLabel: string;
} {
  const date = parseInstant(iso ?? null);
  if (!date) return { dateLabel: "", timeLabel: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRANSACTIONS_DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    dateLabel: `${get("year")}/${get("month")}/${get("day")}`,
    timeLabel: `${get("hour")}:${get("minute")}`,
  };
}

export function matchesTransactionDateFilter(
  completedAt: string,
  filter: TransactionDateFilter,
  now: Date,
): boolean {
  if (filter === "all") return true;
  const when = parseInstant(completedAt);
  if (!when) return false;
  const day = zonedYmd(when);
  const today = zonedYmd(now);
  if (filter === "today") return day === today;
  if (filter === "yesterday") {
    const yesterday = startOfZonedDay(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return day === zonedYmd(yesterday);
  }
  if (filter === "month") return zonedYearMonth(when) === zonedYearMonth(now);
  const from = startOfZonedDay(now);
  from.setDate(from.getDate() - 6);
  const point = startOfZonedDay(when);
  return (
    point.getTime() >= from.getTime() &&
    point.getTime() <= startOfZonedDay(now).getTime()
  );
}

export function matchesTransactionSearch(
  row: Pick<
    TransactionWorkspaceRow,
    "customerName" | "customerPhone" | "transactionId" | "transactionNumber"
  >,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.customerName.toLowerCase().includes(q) ||
    row.customerPhone.toLowerCase().includes(q) ||
    row.transactionId.toLowerCase().includes(q) ||
    row.transactionNumber.toLowerCase().includes(q)
  );
}

export function matchesTransactionPaymentFilter(
  methods: PaymentMethod[],
  filter: TransactionPaymentFilter,
): boolean {
  if (filter === "all") return true;
  return methods.includes(filter);
}

export function buildTransactionWorkspaceRows(input: {
  organizationId: string;
  transactions: Transaction[];
  customers: Customer[];
  locations?: TransactionLocationHint[];
  staff?: TransactionStaffHint[];
  appointments?: TransactionAppointmentHint[];
  catalog?: TransactionCatalogHint[];
}): TransactionWorkspaceRow[] {
  const customersById = new Map(
    input.customers
      .filter((customer) => customer.organizationId === input.organizationId)
      .map((customer) => [customer.id, customer]),
  );
  const locationsById = new Map(
    (input.locations ?? []).map((location) => [location.id, location.name]),
  );
  const staffById = new Map(
    (input.staff ?? []).map((staff) => [staff.id, staff.displayName]),
  );
  const appointmentsById = new Map(
    (input.appointments ?? []).map((appointment) => [appointment.id, appointment]),
  );

  return input.transactions
    .filter((transaction) => transaction.organizationId === input.organizationId)
    .map((transaction) => {
      const customer = customersById.get(transaction.customerId);
      const name = customer?.name || transaction.customerId;
      const appointment = transaction.appointmentId
        ? appointmentsById.get(transaction.appointmentId)
        : undefined;
      const beauticianName = appointment?.staffName?.trim() || "";
      const summary = summarizeLineItems(transaction.items);
      const methods = uniquePaymentMethods(transaction.payments);
      return {
        transactionId: transaction.id,
        transactionNumber: transaction.transactionNumber,
        organizationId: transaction.organizationId,
        locationId: transaction.locationId,
        locationName: locationsById.get(transaction.locationId) ?? "",
        customerId: transaction.customerId,
        customerName: name,
        customerPhone: customer?.phone ?? "",
        customerInitials: initialsFrom(name),
        membership: customer ? membershipBadge(customer) : null,
        status: {
          kind: transaction.status,
          title: TRANSACTION_STATUS_LABEL[transaction.status],
        },
        completedAt: transaction.completedAt,
        voidedAt: transaction.voidedAt,
        createdByStaffId: transaction.createdByStaffId,
        cashierName: staffById.get(transaction.createdByStaffId) ?? "",
        beauticianName,
        beauticianInitials: initialsFrom(beauticianName),
        lineSummary: summary.label,
        extraItemCount: summary.extraCount,
        paymentBadge: paymentBadgeLabel(transaction.payments),
        mixedPayment: isMixedPayment(transaction.payments),
        paymentMethods: methods,
        totalMinor: transaction.total,
        subtotalMinor: transaction.subtotal,
        discountTotalMinor: transaction.discountTotal,
        promotionDiscountMinor: promotionDiscountMinor(transaction),
        packageRedemptionMinor: packageRedemptionMinor(transaction),
        storedValueTenderMinor: storedValueTenderMinor(transaction),
        externalInflowMinor: externalInflowMinor(transaction),
        currency: transaction.currency,
        transaction,
      } satisfies TransactionWorkspaceRow;
    })
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

export function filterTransactionsByLocation(
  rows: TransactionWorkspaceRow[],
  locationId?: string | null,
): TransactionWorkspaceRow[] {
  if (!locationId) return rows;
  return rows.filter((row) => row.locationId === locationId);
}

export function filterTransactionRows(
  rows: TransactionWorkspaceRow[],
  input: {
    status: TransactionListStatusFilter;
    query: string;
    date: TransactionDateFilter;
    payment: TransactionPaymentFilter;
    now: Date;
    locationId?: string | null;
  },
): TransactionWorkspaceRow[] {
  const scoped = filterTransactionsByLocation(rows, input.locationId);
  return scoped.filter((row) => {
    if (input.status !== "all" && row.status.kind !== input.status) return false;
    if (!matchesTransactionDateFilter(row.completedAt, input.date, input.now)) {
      return false;
    }
    if (!matchesTransactionPaymentFilter(row.paymentMethods, input.payment)) {
      return false;
    }
    return matchesTransactionSearch(row, input.query);
  });
}

export function countTransactionSummary(
  rows: TransactionWorkspaceRow[],
  now: Date,
): TransactionWorkspaceSummary {
  let todayExternalInflowMinor = 0;
  let todayTransactionCount = 0;
  let monthExternalInflowMinor = 0;
  let voidedCount = 0;

  for (const row of rows) {
    if (row.status.kind === "VOIDED") voidedCount += 1;
    const completed = row.status.kind === "COMPLETED";
    if (matchesTransactionDateFilter(row.completedAt, "today", now)) {
      if (completed) {
        todayTransactionCount += 1;
        todayExternalInflowMinor += row.externalInflowMinor;
      }
    }
    if (
      completed &&
      matchesTransactionDateFilter(row.completedAt, "month", now)
    ) {
      monthExternalInflowMinor += row.externalInflowMinor;
    }
  }

  return {
    todayExternalInflowMinor,
    todayTransactionCount,
    monthExternalInflowMinor,
    voidedCount,
  };
}

export function countTodayPaymentBreakdown(
  rows: TransactionWorkspaceRow[],
  now: Date,
): TransactionTodayPaymentBreakdown {
  const todayCompleted = rows.filter(
    (row) =>
      row.status.kind === "COMPLETED" &&
      matchesTransactionDateFilter(row.completedAt, "today", now),
  );

  const amountByMethod = new Map<PaymentMethod, { amount: number; count: number }>();
  for (const method of TRANSACTION_EXTERNAL_BREAKDOWN_METHODS) {
    amountByMethod.set(method, { amount: 0, count: 0 });
  }
  amountByMethod.set("STORED_VALUE", { amount: 0, count: 0 });

  let packageAmount = 0;
  let packageCount = 0;

  for (const row of todayCompleted) {
    const counted = new Set<PaymentMethod>();
    for (const payment of row.transaction.payments) {
      const bucket = amountByMethod.get(payment.method);
      if (!bucket) continue;
      bucket.amount += payment.amount;
      if (!counted.has(payment.method)) {
        bucket.count += 1;
        counted.add(payment.method);
      }
    }
    if (row.packageRedemptionMinor > 0) {
      packageAmount += row.packageRedemptionMinor;
      packageCount += 1;
    }
  }

  const external = TRANSACTION_EXTERNAL_BREAKDOWN_METHODS.map((method) => {
    const bucket = amountByMethod.get(method) ?? { amount: 0, count: 0 };
    return {
      method,
      label: PAYMENT_METHOD_LABEL[method],
      amountMinor: bucket.amount,
      count: bucket.count,
      kind: "external" as const,
    };
  });

  const stored = amountByMethod.get("STORED_VALUE") ?? { amount: 0, count: 0 };
  const nonCash: TransactionPaymentBreakdownRow[] = [
    {
      method: "STORED_VALUE",
      label: PAYMENT_METHOD_LABEL.STORED_VALUE,
      amountMinor: stored.amount,
      count: stored.count,
      kind: "non_cash",
    },
    {
      method: "PACKAGE_REDEMPTION",
      label: "套票折抵",
      amountMinor: packageAmount,
      count: packageCount,
      kind: "non_cash",
    },
  ];

  return { external, nonCash };
}

export function mapTransactionLineItems(
  transaction: Transaction,
  catalog: TransactionCatalogHint[] = [],
): TransactionLineItemView[] {
  return transaction.items.map((item) => {
    const catalogItem = item.referenceId
      ? catalog.find((entry) => entry.id === item.referenceId)
      : undefined;
    return {
      id: item.id,
      name: item.nameSnapshot,
      type: item.type,
      typeLabel: CHECKOUT_ITEM_TYPE_LABEL[item.type] ?? item.type,
      quantity: item.quantity,
      unitPriceMinor: item.unitPrice,
      lineSubtotalMinor: item.lineSubtotal,
      discountAmountMinor: item.discountAmount,
      lineTotalMinor: item.lineTotal,
      durationMinutes: catalogItem?.durationMinutes ?? null,
      sessionCount: item.sessionCountSnapshot ?? null,
    };
  });
}

export function mapTransactionPayments(
  transaction: Transaction,
): TransactionPaymentView[] {
  return transaction.payments.map((payment) => ({
    id: payment.id,
    method: payment.method,
    label: PAYMENT_METHOD_LABEL[payment.method],
    amountMinor: payment.amount,
    kind: isExternalPaymentMethod(payment.method)
      ? "external"
      : payment.method === "STORED_VALUE"
        ? "stored_value"
        : "other",
  }));
}

export function mapTransactionQuickView(
  row: TransactionWorkspaceRow,
  catalog: TransactionCatalogHint[] = [],
): TransactionQuickViewModel {
  const tx = row.transaction;
  return {
    transactionId: row.transactionId,
    transactionNumber: row.transactionNumber,
    status: row.status,
    customerId: row.customerId,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerInitials: row.customerInitials,
    completedAt: row.completedAt,
    completedLabel: formatTransactionTimestamp(row.completedAt),
    lineItems: mapTransactionLineItems(tx, catalog),
    subtotalMinor: row.subtotalMinor,
    promotionDiscountMinor: row.promotionDiscountMinor,
    packageRedemptionMinor: row.packageRedemptionMinor,
    storedValueTenderMinor: row.storedValueTenderMinor,
    totalMinor: row.totalMinor,
    externalInflowMinor: row.externalInflowMinor,
    payments: mapTransactionPayments(tx),
    mixedPayment: row.mixedPayment,
    cashierName: row.cashierName,
    beauticianName: row.beauticianName,
    locationName: row.locationName,
    voidedAt: tx.voidedAt,
    voidReason: tx.voidReason,
    voidedBy: tx.voidedBy,
  };
}

export function resolveSelectedTransactionRow(
  rows: TransactionWorkspaceRow[],
  selectedTransactionId: string | null,
): TransactionWorkspaceRow | null {
  if (!selectedTransactionId) return null;
  return rows.find((row) => row.transactionId === selectedTransactionId) ?? null;
}

export function shouldResetTransactionSelection(input: {
  selectedTransactionId: string | null;
  visibleRows: TransactionWorkspaceRow[];
}): boolean {
  if (!input.selectedTransactionId) return false;
  return !input.visibleRows.some(
    (row) => row.transactionId === input.selectedTransactionId,
  );
}

export function shouldRenderTransactionQuickView(
  selected: TransactionWorkspaceRow | null,
): boolean {
  return selected !== null;
}

export function isInlineTransactionQuickViewViewport(widthPx: number): boolean {
  return widthPx >= TRANSACTIONS_INLINE_MIN_PX;
}

export function transactionListPresentation(
  widthPx: number,
): "desktop-rows" | "mobile-cards" {
  return isInlineTransactionQuickViewViewport(widthPx)
    ? "desktop-rows"
    : "mobile-cards";
}

export function isTransactionRowKeyboardActivation(key: string): boolean {
  return key === "Enter" || key === " ";
}
