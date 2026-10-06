/**
 * Derived Finance metrics from canonical Transaction + Expense.
 * PACKAGE redemption is entitlement, never collected revenue.
 */
import type { CheckoutItemType, Transaction } from "@/lib/commerce/domain";
import {
  presentTransactionTender,
  type PackageNameHint,
  type TransactionTenderPresentation,
} from "@/lib/commerce/transaction-tender-presentation";
import {
  FINANCE_STORED_VALUE_WRITE_OPEN,
  type Expense,
  type FinanceIncomeKind,
} from "./domain";
import { eachYmd, isYmdInRange, taipeiYmdFromInstant, type FinanceDateRange } from "./period";

export type FinanceTransactionMetrics = {
  transactionId: string;
  organizationId: string;
  locationId: string;
  completedYmd: string;
  incomeKind: FinanceIncomeKind;
  collectedMinor: number;
  serviceValueMinor: number;
  serviceCollectedMinor: number;
  packageSalesMinor: number;
  productSalesMinor: number;
  otherCollectedMinor: number;
  packageRedemptionValueMinor: number;
  storedValueRedemptionMinor: number;
  tender: TransactionTenderPresentation;
};

export type FinanceTotals = {
  collectedRevenueMinor: number;
  serviceValueMinor: number;
  serviceCollectedMinor: number;
  packageSalesMinor: number;
  productSalesMinor: number;
  otherCollectedMinor: number;
  packageRedemptionValueMinor: number;
  storedValueRedemptionMinor: number;
  expenseMinor: number;
  operatingCashDeltaMinor: number;
  storedValueWriteOpen: false;
};

export type FinanceComparison = {
  kind: "up" | "down" | "flat" | "hidden";
  percent: number | null;
  label: string;
};

export type FinanceTrendPoint = {
  ymd: string;
  label: string;
  collectedMinor: number;
  expenseMinor: number;
};

export type FinanceExpenseCategorySlice = {
  category: Expense["category"];
  amountMinor: number;
  share: number;
};

function lineCollectedWeight(type: CheckoutItemType, lineTotal: number): number {
  if (lineTotal <= 0) return 0;
  return lineTotal;
}

function incomeKindFromItems(types: CheckoutItemType[]): FinanceIncomeKind {
  if (types.includes("PACKAGE_PURCHASE")) return "PACKAGE_SALE";
  if (types.includes("PRODUCT") && !types.includes("SERVICE")) return "PRODUCT";
  if (types.includes("SERVICE")) return "SERVICE";
  return "OTHER";
}

/** SERVICE value only — package purchases are not service value. */
export function financeServiceValueMinor(transaction: Transaction): number {
  return transaction.items
    .filter((item) => item.type === "SERVICE")
    .reduce((sum, item) => {
      if (item.lineSubtotal > 0) return sum + item.lineSubtotal;
      return sum + item.unitPrice * item.quantity;
    }, 0);
}

export function presentFinanceTransaction(
  transaction: Transaction,
  catalog?: PackageNameHint[],
): FinanceTransactionMetrics {
  const tender = presentTransactionTender(transaction, catalog);
  const collected = transaction.status === "COMPLETED" ? tender.collectedMinor : 0;
  const types = transaction.items.map((item) => item.type);
  const weights: Record<"SERVICE" | "PACKAGE_PURCHASE" | "PRODUCT" | "OTHER", number> = {
    SERVICE: 0,
    PACKAGE_PURCHASE: 0,
    PRODUCT: 0,
    OTHER: 0,
  };
  for (const item of transaction.items) {
    const weight = lineCollectedWeight(item.type, item.lineTotal);
    if (item.type === "SERVICE") weights.SERVICE += weight;
    else if (item.type === "PACKAGE_PURCHASE") weights.PACKAGE_PURCHASE += weight;
    else if (item.type === "PRODUCT") weights.PRODUCT += weight;
    else weights.OTHER += weight;
  }
  const weightTotal =
    weights.SERVICE + weights.PACKAGE_PURCHASE + weights.PRODUCT + weights.OTHER;
  let serviceCollectedMinor = 0;
  let packageSalesMinor = 0;
  let productSalesMinor = 0;
  let otherCollectedMinor = 0;
  if (collected > 0 && weightTotal > 0) {
    serviceCollectedMinor = Math.round((collected * weights.SERVICE) / weightTotal);
    packageSalesMinor = Math.round((collected * weights.PACKAGE_PURCHASE) / weightTotal);
    productSalesMinor = Math.round((collected * weights.PRODUCT) / weightTotal);
    otherCollectedMinor = collected - serviceCollectedMinor - packageSalesMinor - productSalesMinor;
  } else if (collected > 0) {
    otherCollectedMinor = collected;
  }

  return {
    transactionId: transaction.id,
    organizationId: transaction.organizationId,
    locationId: transaction.locationId,
    completedYmd: taipeiYmdFromInstant(transaction.completedAt),
    incomeKind: incomeKindFromItems(types),
    collectedMinor: collected,
    serviceValueMinor: financeServiceValueMinor(transaction),
    serviceCollectedMinor,
    packageSalesMinor,
    productSalesMinor,
    otherCollectedMinor,
    packageRedemptionValueMinor:
      transaction.status === "COMPLETED" ? tender.packageRedemption?.redeemedValueMinor ?? 0 : 0,
    storedValueRedemptionMinor:
      transaction.status === "COMPLETED" ? tender.storedValueMinor : 0,
    tender,
  };
}

export function emptyFinanceTotals(): FinanceTotals {
  return {
    collectedRevenueMinor: 0,
    serviceValueMinor: 0,
    serviceCollectedMinor: 0,
    packageSalesMinor: 0,
    productSalesMinor: 0,
    otherCollectedMinor: 0,
    packageRedemptionValueMinor: 0,
    storedValueRedemptionMinor: 0,
    expenseMinor: 0,
    operatingCashDeltaMinor: 0,
    storedValueWriteOpen: FINANCE_STORED_VALUE_WRITE_OPEN,
  };
}

export function sumFinanceTotals(
  metrics: FinanceTransactionMetrics[],
  expenses: Expense[],
): FinanceTotals {
  const totals = emptyFinanceTotals();
  for (const row of metrics) {
    totals.collectedRevenueMinor += row.collectedMinor;
    totals.serviceValueMinor += row.serviceValueMinor;
    totals.serviceCollectedMinor += row.serviceCollectedMinor;
    totals.packageSalesMinor += row.packageSalesMinor;
    totals.productSalesMinor += row.productSalesMinor;
    totals.otherCollectedMinor += row.otherCollectedMinor;
    totals.packageRedemptionValueMinor += row.packageRedemptionValueMinor;
    totals.storedValueRedemptionMinor += row.storedValueRedemptionMinor;
  }
  for (const expense of expenses) {
    totals.expenseMinor += expense.amountMinor;
  }
  totals.operatingCashDeltaMinor = totals.collectedRevenueMinor - totals.expenseMinor;
  return totals;
}

export function filterCompletedInScope(input: {
  transactions: Transaction[];
  expenses: Expense[];
  organizationId: string;
  locationId: string;
  range: FinanceDateRange;
  catalog?: PackageNameHint[];
}): {
  metrics: FinanceTransactionMetrics[];
  expenses: Expense[];
} {
  const metrics = input.transactions
    .filter(
      (row) =>
        row.status === "COMPLETED" &&
        row.organizationId === input.organizationId &&
        row.locationId === input.locationId,
    )
    .map((row) => presentFinanceTransaction(row, input.catalog))
    .filter((row) => isYmdInRange(row.completedYmd, input.range));
  const expenses = input.expenses.filter(
    (row) =>
      row.organizationId === input.organizationId &&
      row.locationId === input.locationId &&
      isYmdInRange(row.expenseDate, input.range),
  );
  return { metrics, expenses };
}

export function compareMinor(current: number, previous: number): FinanceComparison {
  if (previous === 0 && current === 0) {
    return { kind: "hidden", percent: null, label: "" };
  }
  if (previous === 0) {
    return { kind: "up", percent: 100, label: "+100%" };
  }
  const delta = (current - previous) / Math.abs(previous);
  const percent = Math.round(delta * 1000) / 10;
  if (percent === 0) return { kind: "flat", percent: 0, label: "持平" };
  const sign = percent > 0 ? "+" : "";
  return {
    kind: percent > 0 ? "up" : "down",
    percent: Math.abs(percent),
    label: `${sign}${Number.isInteger(percent) ? String(percent) : percent.toFixed(1)}%`,
  };
}

export function shareOf(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return part / whole;
}

export function buildFinanceTrend(
  range: FinanceDateRange,
  metrics: FinanceTransactionMetrics[],
  expenses: Expense[],
): FinanceTrendPoint[] {
  const collected = new Map<string, number>();
  const spent = new Map<string, number>();
  for (const row of metrics) {
    collected.set(row.completedYmd, (collected.get(row.completedYmd) ?? 0) + row.collectedMinor);
  }
  for (const row of expenses) {
    spent.set(row.expenseDate, (spent.get(row.expenseDate) ?? 0) + row.amountMinor);
  }
  return eachYmd(range).map((ymd) => ({
    ymd,
    label: ymd.slice(5).replace("-", "/"),
    collectedMinor: collected.get(ymd) ?? 0,
    expenseMinor: spent.get(ymd) ?? 0,
  }));
}

export function buildExpenseCategorySlices(
  expenses: Expense[],
): FinanceExpenseCategorySlice[] {
  const totals = new Map<Expense["category"], number>();
  for (const row of expenses) {
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.amountMinor);
  }
  const whole = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return [...totals.entries()]
    .map(([category, amountMinor]) => ({
      category,
      amountMinor,
      share: shareOf(amountMinor, whole),
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

export function formatSharePercent(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return "0%";
  const pct = Math.round(share * 1000) / 10;
  return `${Number.isInteger(pct) ? String(pct) : pct.toFixed(1)}%`;
}
