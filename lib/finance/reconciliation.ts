/**
 * Finance collected revenue must equal Transactions-page collected
 * for the same org, location, and Taipei business-date range.
 * Fail closed — do not patch UI numbers.
 */
import type { Transaction } from "@/lib/commerce/domain";
import { collectedMinor as transactionsCollectedMinor } from "@/lib/commerce/transaction-tender-presentation";
import { filterCompletedInScope, sumFinanceTotals } from "./derived";
import type { FinanceDateRange } from "./domain";

export type FinanceTransactionReconciliation = {
  matched: boolean;
  transactionCount: number;
  collectedMinor: number;
  serviceValueMinor: number;
  packageSalesMinor: number;
  packageRedemptionValueMinor: number;
  productSalesMinor: number;
  transactionsCollectedMinor: number;
};

export function reconcileFinanceToTransactions(input: {
  transactions: Transaction[];
  organizationId: string;
  locationId: string;
  range: FinanceDateRange;
}): FinanceTransactionReconciliation {
  const scoped = filterCompletedInScope({
    transactions: input.transactions,
    expenses: [],
    organizationId: input.organizationId,
    locationId: input.locationId,
    range: input.range,
  });
  const totals = sumFinanceTotals(scoped.metrics, []);
  const transactionsCollected = scoped.metrics.reduce((sum, row) => {
    const source = input.transactions.find((tx) => tx.id === row.transactionId);
    return sum + (source ? transactionsCollectedMinor(source) : 0);
  }, 0);
  return {
    matched: totals.collectedRevenueMinor === transactionsCollected,
    transactionCount: scoped.metrics.length,
    collectedMinor: totals.collectedRevenueMinor,
    serviceValueMinor: totals.serviceValueMinor,
    packageSalesMinor: totals.packageSalesMinor,
    packageRedemptionValueMinor: totals.packageRedemptionValueMinor,
    productSalesMinor: totals.productSalesMinor,
    transactionsCollectedMinor: transactionsCollected,
  };
}
