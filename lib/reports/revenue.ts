/**
 * Revenue / payment / sales-mix aggregators — COMPLETED Transaction only.
 */
import type { PaymentMethod, Transaction } from "@/lib/commerce/domain";
import { listTransactions } from "@/lib/commerce/transaction-store";
import { formatYmd } from "@/lib/appointments/domain";
import type {
  PaymentBreakdownRow,
  ReportQuery,
  RevenueByDayRow,
  RevenueSummary,
  SalesMixSummary,
} from "./domain";
import { eachLocalDayYmd, isInstantInRange } from "./date-range";

function requireOrg(organizationId: string): void {
  if (!organizationId) throw new Error("organizationId is required");
}

/** COMPLETED in range (+ optional location). VOIDED never included. */
export function listCompletedTransactionsForReport(
  query: ReportQuery,
): Transaction[] {
  requireOrg(query.organizationId);
  return listTransactions(query.organizationId, {
    locationId: query.locationId,
    status: "COMPLETED",
    from: query.range.startAt,
    to: query.range.endAt,
  }).filter(
    (t) =>
      t.organizationId === query.organizationId &&
      t.status === "COMPLETED" &&
      isInstantInRange(t.completedAt, query.range),
  );
}

/**
 * Ops revenue = sum(COMPLETED.total).
 * Zero-total package redemptions contribute 0 and are excluded from transactionCount / AOV.
 * VOIDED excluded by list filter.
 */
export function getRevenueSummary(query: ReportQuery): RevenueSummary {
  const txs = listCompletedTransactionsForReport(query);
  let revenueMinor = 0;
  let transactionCount = 0;
  let zeroTotalCompletedCount = 0;
  for (const t of txs) {
    const total = Number.isFinite(t.total) ? t.total : 0;
    if (total > 0) {
      revenueMinor += total;
      transactionCount += 1;
    } else {
      zeroTotalCompletedCount += 1;
    }
  }
  return {
    revenueMinor,
    transactionCount,
    zeroTotalCompletedCount,
    averageTicketMinor:
      transactionCount === 0 ? 0 : Math.floor(revenueMinor / transactionCount),
  };
}

const PAYMENT_ORDER: PaymentMethod[] = [
  "CASH",
  "CARD",
  "TRANSFER",
  "STORED_VALUE",
  "OTHER",
  "PACKAGE",
];

/** Mixed tender: sum payment rows (not whole TX once). Only COMPLETED. */
export function getPaymentBreakdown(query: ReportQuery): PaymentBreakdownRow[] {
  const txs = listCompletedTransactionsForReport(query);
  const map = new Map<PaymentMethod, number>();
  for (const method of PAYMENT_ORDER) map.set(method, 0);

  for (const t of txs) {
    for (const p of t.payments) {
      const prev = map.get(p.method) ?? 0;
      map.set(p.method, prev + (Number.isFinite(p.amount) ? p.amount : 0));
    }
  }

  return PAYMENT_ORDER.filter((m) => m !== "PACKAGE").map((method) => ({
    method,
    amountMinor: map.get(method) ?? 0,
  }));
}

/**
 * Sales mix from immutable item snapshots.
 * SERVICE / PRODUCT only for primary mix; package purchase & SV top-up tracked separately.
 */
export function getSalesMixSummary(query: ReportQuery): SalesMixSummary {
  const txs = listCompletedTransactionsForReport(query);
  let serviceSalesMinor = 0;
  let productSalesMinor = 0;
  let serviceLineCount = 0;
  let productQuantity = 0;
  let packagePurchaseMinor = 0;
  let storedValueTopUpMinor = 0;

  for (const t of txs) {
    for (const item of t.items) {
      const line = Number.isFinite(item.lineTotal) ? item.lineTotal : 0;
      const qty = Number.isFinite(item.quantity) ? item.quantity : 0;
      if (item.type === "SERVICE") {
        serviceSalesMinor += line;
        serviceLineCount += 1;
      } else if (item.type === "PRODUCT") {
        productSalesMinor += line;
        productQuantity += qty;
      } else if (item.type === "PACKAGE_PURCHASE") {
        packagePurchaseMinor += line;
      } else if (item.type === "STORED_VALUE_TOP_UP") {
        storedValueTopUpMinor += line;
      }
    }
  }

  return {
    serviceSalesMinor,
    productSalesMinor,
    serviceLineCount,
    productQuantity,
    packagePurchaseMinor,
    storedValueTopUpMinor,
  };
}

export function getRevenueByDay(query: ReportQuery): RevenueByDayRow[] {
  const txs = listCompletedTransactionsForReport(query);
  const byDay = new Map<string, number>();
  for (const ymd of eachLocalDayYmd(query.range)) {
    byDay.set(ymd, 0);
  }
  for (const t of txs) {
    if (!(t.total > 0)) continue;
    const ymd = formatYmd(new Date(t.completedAt));
    byDay.set(ymd, (byDay.get(ymd) ?? 0) + t.total);
  }
  return Array.from(byDay.entries()).map(([dateYmd, revenueMinor]) => ({
    dateYmd,
    revenueMinor,
  }));
}
