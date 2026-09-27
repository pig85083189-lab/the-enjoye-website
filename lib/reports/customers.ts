import type { CustomerSummary, ReportQuery } from "./domain";
import { listCompletedTransactionsForReport } from "./revenue";

/**
 * Paying customers in range = distinct customerId on COMPLETED txs with total > 0.
 * New vs returning not reported — joinedAt / first-visit history is not reliable enough.
 */
export function getCustomerSummary(query: ReportQuery): CustomerSummary {
  if (!query.organizationId) throw new Error("organizationId is required");
  const txs = listCompletedTransactionsForReport(query).filter((t) => t.total > 0);
  const ids = new Set(txs.map((t) => t.customerId));
  return { payingCustomerCount: ids.size };
}
