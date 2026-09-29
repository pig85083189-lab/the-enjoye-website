/**
 * Reports Workspace — presentation / read model only.
 * Aggregates canonical stores. Does not persist analytics or mutate commerce.
 */
import { getServiceById } from "@/data/mock-services";
import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import type { CheckoutItemType, Transaction } from "@/lib/commerce/domain";
import { externalInflowMinor } from "@/lib/commerce/transactions-workspace-derived";
import { getProductStock } from "@/lib/inventory/store";
import { listProducts } from "@/lib/products/store";
import {
  PRODUCTS_LOW_STOCK_THRESHOLD,
  deriveProductStockKind,
  productStockTitle,
  type ProductStockKind,
} from "@/lib/products/products-workspace-derived";
import { listLocations } from "@/lib/tenant/organization-store";
import { getAppointmentSummary } from "./appointments";
import {
  eachLocalDayYmd,
  previousPeriodRange,
} from "./date-range";
import type { ReportPreset, ReportQuery } from "./domain";
import { getFollowUpSummary } from "./follow-ups-metrics";
import { getRevenueSummary, listCompletedTransactionsForReport } from "./revenue";
import { listCompletedTreatmentsForReport } from "./treatments";
import { formatYmd } from "@/lib/appointments/domain";

export const REPORTS_HAS_SECOND_STORE = false;
export const REPORTS_HAS_PERSISTED_ANALYTICS = false;
export const REPORTS_HAS_PACKAGE_EXPIRY_ATTENTION = false;
export const REPORTS_HAS_REBOOK_COLUMN = false;
/** Same presentation threshold as Products Workspace — not a second magic number. */
export const REPORTS_LOW_STOCK_THRESHOLD = PRODUCTS_LOW_STOCK_THRESHOLD;

export type ReportsComparisonKind = "up" | "down" | "flat" | "hidden";

export interface ReportsComparison {
  kind: ReportsComparisonKind;
  /** Absolute percent points, 1 decimal. Null when hidden. */
  percent: number | null;
  label: string;
}

export type SalesCompositionKey =
  | "treatment"
  | "product"
  | "package"
  | "storedValue";

export const SALES_COMPOSITION_LABEL: Record<SalesCompositionKey, string> = {
  treatment: "療程",
  product: "商品",
  package: "套票銷售",
  storedValue: "儲值銷售",
};

export interface ReportsStaffHint {
  id: string;
  displayName: string;
}

export interface ReportsTrendPoint {
  key: string;
  label: string;
  revenueMinor: number;
  transactionCount: number;
}

export interface ReportsKpiView {
  revenueMinor: number;
  transactionCount: number;
  averageTicketMinor: number;
  completedTreatments: number;
  zeroTotalCompletedCount: number;
  revenueComparison: ReportsComparison;
  transactionComparison: ReportsComparison;
  ticketComparison: ReportsComparison;
  treatmentComparison: ReportsComparison;
}

export interface ReportsAppointmentOpsView {
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  incomplete: number;
  completionRate: number;
  cancellationRate: number;
  noShowRate: number;
  incompleteRate: number;
}

export interface ReportsSalesCompositionView {
  totalExternalMinor: number;
  treatmentMinor: number;
  productMinor: number;
  packageMinor: number;
  storedValueMinor: number;
}

export interface ReportsPopularTreatmentRow {
  serviceId: string;
  name: string;
  completedCount: number;
  /** Only set when a transaction.treatmentId matches a completed treatment. */
  revenueMinor: number | null;
}

export interface ReportsPopularProductRow {
  productId: string;
  name: string;
  quantity: number;
  salesMinor: number;
  stock: number;
  stockKind: ProductStockKind;
  stockTitle: string;
}

export interface ReportsStaffOpsRow {
  staffId: string;
  displayName: string;
  completedTreatments: number;
  handledExternalMinor: number;
  handledTransactionCount: number;
  averageTicketMinor: number;
}

export type ReportsAttentionKind =
  | "low_stock"
  | "follow_up_overdue"
  | "appointment_no_show";

export interface ReportsAttentionRow {
  kind: ReportsAttentionKind;
  count: number;
  label: string;
  href: string;
  actionLabel: string;
}

export interface ReportsWorkspaceDashboard {
  query: ReportQuery;
  previousQuery: ReportQuery;
  kpis: ReportsKpiView;
  trend: ReportsTrendPoint[];
  trendGranularity: "hour" | "day" | "week";
  appointments: ReportsAppointmentOpsView;
  sales: ReportsSalesCompositionView;
  popularTreatments: ReportsPopularTreatmentRow[];
  showTreatmentRevenue: boolean;
  popularProducts: ReportsPopularProductRow[];
  staff: ReportsStaffOpsRow[];
  attention: ReportsAttentionRow[];
}

function formatComparisonPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Derived only. Hidden when previous is 0 and current is not — do not fake ∞%. */
export function comparePeriod(
  current: number,
  previous: number,
): ReportsComparison {
  if (previous === 0 && current === 0) {
    return { kind: "flat", percent: 0, label: "持平" };
  }
  if (previous === 0) {
    return { kind: "hidden", percent: null, label: "" };
  }
  const raw = ((current - previous) / previous) * 100;
  const percent = Math.round(raw * 10) / 10;
  if (percent === 0) {
    return { kind: "flat", percent: 0, label: "持平" };
  }
  if (percent > 0) {
    return {
      kind: "up",
      percent,
      label: `↑ ${formatComparisonPercent(percent)}%`,
    };
  }
  return {
    kind: "down",
    percent: Math.abs(percent),
    label: `↓ ${formatComparisonPercent(Math.abs(percent))}%`,
  };
}

function lineTypeToCompositionKey(
  type: CheckoutItemType,
): SalesCompositionKey | null {
  if (type === "SERVICE" || type === "CUSTOM") return "treatment";
  if (type === "PRODUCT") return "product";
  if (type === "PACKAGE_PURCHASE") return "package";
  if (type === "STORED_VALUE_TOP_UP") return "storedValue";
  return null;
}

function allocateIntegerShares(total: number, weights: number[]): number[] {
  if (total <= 0 || weights.length === 0) return weights.map(() => 0);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) return weights.map(() => 0);
  const raw = weights.map((weight) => (total * weight) / weightSum);
  const floors = raw.map((value) => Math.floor(value));
  const remain = total - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remain; i += 1) {
    floors[order[i]!.index] += 1;
  }
  return floors;
}

/**
 * Split one transaction's external inflow across line types by lineTotal weight.
 * Redemption-only txs (external = 0) contribute nothing.
 */
export function allocateExternalInflowByLineType(
  transaction: Transaction,
): Record<SalesCompositionKey, number> {
  const empty: Record<SalesCompositionKey, number> = {
    treatment: 0,
    product: 0,
    package: 0,
    storedValue: 0,
  };
  const external = externalInflowMinor(transaction);
  if (external <= 0) return empty;

  const keyed = transaction.items
    .map((item) => ({
      key: lineTypeToCompositionKey(item.type),
      weight: Number.isFinite(item.lineTotal) ? Math.max(0, item.lineTotal) : 0,
    }))
    .filter((row): row is { key: SalesCompositionKey; weight: number } =>
      Boolean(row.key && row.weight > 0),
    );

  if (keyed.length === 0) return empty;

  const shares = allocateIntegerShares(
    external,
    keyed.map((row) => row.weight),
  );
  const result = { ...empty };
  keyed.forEach((row, index) => {
    result[row.key] += shares[index] ?? 0;
  });
  return result;
}

export function sumSalesComposition(
  transactions: Transaction[],
): ReportsSalesCompositionView {
  const sales: ReportsSalesCompositionView = {
    totalExternalMinor: 0,
    treatmentMinor: 0,
    productMinor: 0,
    packageMinor: 0,
    storedValueMinor: 0,
  };
  for (const transaction of transactions) {
    const allocated = allocateExternalInflowByLineType(transaction);
    sales.totalExternalMinor += externalInflowMinor(transaction);
    sales.treatmentMinor += allocated.treatment;
    sales.productMinor += allocated.product;
    sales.packageMinor += allocated.package;
    sales.storedValueMinor += allocated.storedValue;
  }
  return sales;
}

function payingTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter((transaction) => externalInflowMinor(transaction) > 0);
}

export function resolveTrendGranularity(
  preset: ReportPreset,
  range: ReportQuery["range"],
): "hour" | "day" | "week" {
  const days = eachLocalDayYmd(range).length;
  if (preset === "today") return "hour";
  if (preset === "week" || preset === "month") return "day";
  if (days <= 1) return "hour";
  if (days <= 45) return "day";
  return "week";
}

function localHour(date: Date): number {
  return date.getHours();
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function buildReportsTrendPoints(
  query: ReportQuery,
  preset: ReportPreset,
  transactions: Transaction[] = listCompletedTransactionsForReport(query),
): ReportsTrendPoint[] {
  const paying = payingTransactions(transactions);
  const granularity = resolveTrendGranularity(preset, query.range);

  if (granularity === "hour") {
    const hours = Array.from({ length: 24 }, (_, hour) => hour);
    const byHour = new Map<number, { revenueMinor: number; transactionCount: number }>();
    for (const hour of hours) {
      byHour.set(hour, { revenueMinor: 0, transactionCount: 0 });
    }
    for (const transaction of paying) {
      const hour = localHour(new Date(transaction.completedAt));
      const bucket = byHour.get(hour) ?? { revenueMinor: 0, transactionCount: 0 };
      bucket.revenueMinor += externalInflowMinor(transaction);
      bucket.transactionCount += 1;
      byHour.set(hour, bucket);
    }
    const activeHours = hours.filter((hour) => (byHour.get(hour)?.transactionCount ?? 0) > 0);
    const startHour = activeHours.length ? Math.min(8, ...activeHours) : 9;
    const endHour = activeHours.length ? Math.max(20, ...activeHours) : 20;
    const points: ReportsTrendPoint[] = [];
    for (let hour = startHour; hour <= endHour; hour += 1) {
      const bucket = byHour.get(hour)!;
      points.push({
        key: `h-${hour}`,
        label: hourLabel(hour),
        revenueMinor: bucket.revenueMinor,
        transactionCount: bucket.transactionCount,
      });
    }
    return points;
  }

  if (granularity === "week") {
    const days = eachLocalDayYmd(query.range);
    const byWeek = new Map<string, ReportsTrendPoint>();
    for (const ymd of days) {
      const [year, month, day] = ymd.split("-").map(Number);
      const date = new Date(year, (month ?? 1) - 1, day ?? 1);
      const weekday = date.getDay();
      const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
      const monday = new Date(date);
      monday.setDate(date.getDate() + mondayOffset);
      const weekKey = formatYmd(monday);
      if (!byWeek.has(weekKey)) {
        byWeek.set(weekKey, {
          key: weekKey,
          label: weekKey.slice(5),
          revenueMinor: 0,
          transactionCount: 0,
        });
      }
    }
    for (const transaction of paying) {
      const completed = new Date(transaction.completedAt);
      const weekday = completed.getDay();
      const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
      const monday = new Date(completed);
      monday.setDate(completed.getDate() + mondayOffset);
      const weekKey = formatYmd(monday);
      const bucket = byWeek.get(weekKey);
      if (!bucket) continue;
      bucket.revenueMinor += externalInflowMinor(transaction);
      bucket.transactionCount += 1;
    }
    return Array.from(byWeek.values());
  }

  const byDay = new Map<string, ReportsTrendPoint>();
  for (const ymd of eachLocalDayYmd(query.range)) {
    byDay.set(ymd, {
      key: ymd,
      label: ymd.slice(5),
      revenueMinor: 0,
      transactionCount: 0,
    });
  }
  for (const transaction of paying) {
    const ymd = formatYmd(new Date(transaction.completedAt));
    const bucket = byDay.get(ymd);
    if (!bucket) continue;
    bucket.revenueMinor += externalInflowMinor(transaction);
    bucket.transactionCount += 1;
  }
  return Array.from(byDay.values());
}

function resolveStaffName(
  organizationId: string,
  staffId: string,
  hints: ReportsStaffHint[],
): string | null {
  const hint = hints.find((row) => row.id === staffId);
  if (hint?.displayName) return hint.displayName;
  const membership = SEED_MEMBERSHIPS.find(
    (row) =>
      row.organizationId === organizationId &&
      row.userId === staffId &&
      row.isActive,
  );
  return membership?.displayName ?? null;
}

function stockForScope(
  organizationId: string,
  locationId: string | undefined,
  productId: string,
): number {
  if (locationId) {
    return getProductStock(organizationId, locationId, productId);
  }
  return listLocations(organizationId).reduce(
    (sum, location) =>
      sum + getProductStock(organizationId, location.id, productId),
    0,
  );
}

export function listLowStockProductIds(
  organizationId: string,
  locationId?: string,
): string[] {
  const products = listProducts(organizationId, { activeOnly: true }).filter(
    (product) => product.organizationId === organizationId,
  );
  const locations = locationId
    ? [locationId]
    : listLocations(organizationId).map((location) => location.id);

  const low = new Set<string>();
  for (const product of products) {
    for (const loc of locations) {
      const stock = getProductStock(organizationId, loc, product.id);
      if (deriveProductStockKind(stock) === "low") {
        low.add(product.id);
      }
    }
  }
  return Array.from(low);
}

export function buildPopularTreatments(
  query: ReportQuery,
  transactions: Transaction[] = listCompletedTransactionsForReport(query),
): { rows: ReportsPopularTreatmentRow[]; showRevenue: boolean } {
  const completed = listCompletedTreatmentsForReport(query);
  const byService = new Map<
    string,
    { count: number; revenueMinor: number; linked: boolean }
  >();

  for (const treatment of completed) {
    const current = byService.get(treatment.serviceId) ?? {
      count: 0,
      revenueMinor: 0,
      linked: false,
    };
    current.count += 1;
    byService.set(treatment.serviceId, current);
  }

  const completedIds = new Set(completed.map((treatment) => treatment.id));
  let anyLinked = false;
  for (const transaction of transactions) {
    if (!transaction.treatmentId || !completedIds.has(transaction.treatmentId)) {
      continue;
    }
    const treatment = completed.find((row) => row.id === transaction.treatmentId);
    if (!treatment) continue;
    const allocated = allocateExternalInflowByLineType(transaction);
    const current = byService.get(treatment.serviceId);
    if (!current) continue;
    current.revenueMinor += allocated.treatment;
    current.linked = true;
    anyLinked = true;
    byService.set(treatment.serviceId, current);
  }

  const rows = Array.from(byService.entries())
    .map(([serviceId, stats]) => ({
      serviceId,
      name:
        getServiceById(serviceId, query.organizationId)?.name ?? serviceId,
      completedCount: stats.count,
      revenueMinor: stats.linked ? stats.revenueMinor : null,
    }))
    .sort((a, b) => {
      if (b.completedCount !== a.completedCount) {
        return b.completedCount - a.completedCount;
      }
      return a.name.localeCompare(b.name, "zh-Hant");
    })
    .slice(0, 5);

  return { rows, showRevenue: anyLinked };
}

export function buildPopularProducts(
  query: ReportQuery,
  transactions: Transaction[] = listCompletedTransactionsForReport(query),
): ReportsPopularProductRow[] {
  const byProduct = new Map<
    string,
    { name: string; quantity: number; salesMinor: number }
  >();

  for (const transaction of transactions) {
    const allocated = allocateExternalInflowByLineType(transaction);
    const productLines = transaction.items.filter((item) => item.type === "PRODUCT");
    const shares = allocateIntegerShares(
      allocated.product,
      productLines.map((item) =>
        Number.isFinite(item.lineTotal) ? Math.max(0, item.lineTotal) : 0,
      ),
    );

    productLines.forEach((item, index) => {
      const productId = item.referenceId;
      if (!productId) return;
      const current = byProduct.get(productId) ?? {
        name: item.nameSnapshot,
        quantity: 0,
        salesMinor: 0,
      };
      current.quantity += Number.isFinite(item.quantity) ? item.quantity : 0;
      current.salesMinor += shares[index] ?? 0;
      if (!current.name) current.name = item.nameSnapshot;
      byProduct.set(productId, current);
    });
  }

  return Array.from(byProduct.entries())
    .map(([productId, stats]) => {
      const stock = stockForScope(
        query.organizationId,
        query.locationId,
        productId,
      );
      const catalog = listProducts(query.organizationId).find(
        (product) => product.id === productId,
      );
      const stockKind = deriveProductStockKind(stock);
      return {
        productId,
        name: catalog?.name ?? stats.name,
        quantity: stats.quantity,
        salesMinor: stats.salesMinor,
        stock,
        stockKind,
        stockTitle: productStockTitle(stockKind),
      };
    })
    .sort((a, b) => {
      if (b.quantity !== a.quantity) return b.quantity - a.quantity;
      if (b.salesMinor !== a.salesMinor) return b.salesMinor - a.salesMinor;
      return a.name.localeCompare(b.name, "zh-Hant");
    })
    .slice(0, 5);
}

export function buildStaffOperations(
  query: ReportQuery,
  input: {
    transactions?: Transaction[];
    staff?: ReportsStaffHint[];
  } = {},
): ReportsStaffOpsRow[] {
  const transactions =
    input.transactions ?? listCompletedTransactionsForReport(query);
  const treatments = listCompletedTreatmentsForReport(query);
  const hints = input.staff ?? [];

  const ids = new Set<string>();
  for (const treatment of treatments) {
    if (treatment.staffId) ids.add(treatment.staffId);
  }
  for (const transaction of payingTransactions(transactions)) {
    if (transaction.createdByStaffId) ids.add(transaction.createdByStaffId);
  }

  const rows: ReportsStaffOpsRow[] = [];
  for (const staffId of ids) {
    const displayName = resolveStaffName(query.organizationId, staffId, hints);
    if (!displayName) continue;

    const completedTreatments = treatments.filter(
      (treatment) => treatment.staffId === staffId,
    ).length;
    const handled = payingTransactions(transactions).filter(
      (transaction) => transaction.createdByStaffId === staffId,
    );
    const handledExternalMinor = handled.reduce(
      (sum, transaction) => sum + externalInflowMinor(transaction),
      0,
    );
    rows.push({
      staffId,
      displayName,
      completedTreatments,
      handledExternalMinor,
      handledTransactionCount: handled.length,
      averageTicketMinor:
        handled.length === 0
          ? 0
          : Math.floor(handledExternalMinor / handled.length),
    });
  }

  return rows.sort((a, b) => {
    if (b.handledExternalMinor !== a.handledExternalMinor) {
      return b.handledExternalMinor - a.handledExternalMinor;
    }
    if (b.completedTreatments !== a.completedTreatments) {
      return b.completedTreatments - a.completedTreatments;
    }
    return a.displayName.localeCompare(b.displayName, "zh-Hant");
  });
}

export function buildNeedsAttention(
  query: ReportQuery,
  now: Date = new Date(),
): ReportsAttentionRow[] {
  const rows: ReportsAttentionRow[] = [];

  const lowStockCount = listLowStockProductIds(
    query.organizationId,
    query.locationId,
  ).length;
  if (lowStockCount > 0) {
    rows.push({
      kind: "low_stock",
      count: lowStockCount,
      label: `${lowStockCount} 個商品低庫存`,
      href: "/staff/products",
      actionLabel: "查看商品",
    });
  }

  const followUps = getFollowUpSummary(query, now);
  if (followUps.overdueCount > 0) {
    rows.push({
      kind: "follow_up_overdue",
      count: followUps.overdueCount,
      label: `${followUps.overdueCount} 位客人追蹤逾期`,
      href: "/staff/follow-ups",
      actionLabel: "查看追蹤",
    });
  }

  const appointments = getAppointmentSummary(query);
  if (appointments.noShow > 0) {
    rows.push({
      kind: "appointment_no_show",
      count: appointments.noShow,
      label: `${appointments.noShow} 筆預約未到`,
      href: "/staff/calendar",
      actionLabel: "查看行事曆",
    });
  }

  return rows;
}

export function getReportsWorkspaceDashboard(
  query: ReportQuery,
  input: {
    preset: ReportPreset;
    now?: Date;
    staff?: ReportsStaffHint[];
  },
): ReportsWorkspaceDashboard {
  if (!query.organizationId) {
    throw new Error("organizationId is required");
  }
  const now = input.now ?? new Date();
  const previousRange = previousPeriodRange(input.preset, query.range, now);
  const previousQuery: ReportQuery = {
    organizationId: query.organizationId,
    range: previousRange,
    locationId: query.locationId,
  };

  const transactions = listCompletedTransactionsForReport(query);
  const currentRevenue = getRevenueSummary(query);
  const previousRevenue = getRevenueSummary(previousQuery);
  const currentTreatments = listCompletedTreatmentsForReport(query).length;
  const previousTreatments = listCompletedTreatmentsForReport(previousQuery).length;
  const appointments = getAppointmentSummary(query);
  const popularTreatments = buildPopularTreatments(query, transactions);

  return {
    query,
    previousQuery,
    kpis: {
      revenueMinor: currentRevenue.revenueMinor,
      transactionCount: currentRevenue.transactionCount,
      averageTicketMinor: currentRevenue.averageTicketMinor,
      completedTreatments: currentTreatments,
      zeroTotalCompletedCount: currentRevenue.zeroTotalCompletedCount,
      revenueComparison: comparePeriod(
        currentRevenue.revenueMinor,
        previousRevenue.revenueMinor,
      ),
      transactionComparison: comparePeriod(
        currentRevenue.transactionCount,
        previousRevenue.transactionCount,
      ),
      ticketComparison: comparePeriod(
        currentRevenue.averageTicketMinor,
        previousRevenue.averageTicketMinor,
      ),
      treatmentComparison: comparePeriod(
        currentTreatments,
        previousTreatments,
      ),
    },
    trend: buildReportsTrendPoints(query, input.preset, transactions),
    trendGranularity: resolveTrendGranularity(input.preset, query.range),
    appointments: {
      total: appointments.total,
      completed: appointments.completed,
      cancelled: appointments.cancelled,
      noShow: appointments.noShow,
      incomplete: appointments.incomplete,
      completionRate: appointments.completionRate,
      cancellationRate: appointments.cancellationRate,
      noShowRate: appointments.noShowRate,
      incompleteRate: appointments.incompleteRate,
    },
    sales: sumSalesComposition(transactions),
    popularTreatments: popularTreatments.rows,
    showTreatmentRevenue: popularTreatments.showRevenue,
    popularProducts: buildPopularProducts(query, transactions),
    staff: buildStaffOperations(query, {
      transactions,
      staff: input.staff,
    }),
    attention: buildNeedsAttention(query, now),
  };
}
