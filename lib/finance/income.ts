/**
 * Income records are a read model over canonical completed Transactions.
 * Do not persist a second income ledger.
 */
import { PAYMENT_METHOD_LABEL, type Transaction } from "@/lib/commerce/domain";
import { formatTransactionTimestamp } from "@/lib/commerce/transactions-workspace-derived";
import type { PackageNameHint } from "@/lib/commerce/transaction-tender-presentation";
import {
  FINANCE_INCOME_KIND_LABEL,
  type FinanceCustomerHint,
  type FinanceIncomeKind,
  type FinanceStaffHint,
} from "./domain";
import { presentFinanceTransaction } from "./derived";
import { isYmdInRange, type FinanceDateRange } from "./period";

export type FinanceIncomeRow = {
  transactionId: string;
  transactionNumber: string;
  completedAt: string;
  dateLabel: string;
  timeLabel: string;
  customerId: string;
  customerName: string;
  content: string;
  incomeKind: FinanceIncomeKind;
  incomeKindLabel: string;
  serviceValueMinor: number;
  packageOffsetMinor: number;
  storedValueOffsetMinor: number;
  collectedMinor: number;
  paymentLabel: string;
  staffName: string;
};

export function financeIncomeContent(transaction: Transaction): string {
  const items = transaction.items;
  if (items.length === 0) return "一般銷售";
  const primary = items[0]?.nameSnapshot?.trim() || "一般銷售";
  return items.length > 1 ? `${primary} + ${items.length - 1} 項` : primary;
}

export function buildFinanceIncomeRows(input: {
  transactions: Transaction[];
  organizationId: string;
  locationId: string;
  range: FinanceDateRange;
  customers?: FinanceCustomerHint[];
  staff?: FinanceStaffHint[];
  catalog?: PackageNameHint[];
}): FinanceIncomeRow[] {
  const customers = new Map((input.customers ?? []).map((row) => [row.id, row]));
  const staff = new Map((input.staff ?? []).map((row) => [row.id, row]));
  const rows: FinanceIncomeRow[] = [];
  for (const transaction of input.transactions) {
    if (transaction.status !== "COMPLETED") continue;
    if (transaction.organizationId !== input.organizationId) continue;
    if (transaction.locationId !== input.locationId) continue;
    const metrics = presentFinanceTransaction(transaction, input.catalog);
    if (!isYmdInRange(metrics.completedYmd, input.range)) continue;
    const stamp = formatTransactionTimestamp(transaction.completedAt);
    const paymentLabel =
      metrics.tender.tenderBadge ||
      (metrics.tender.paymentMethods[0]
        ? PAYMENT_METHOD_LABEL[metrics.tender.paymentMethods[0]]
        : "無需付款");
    rows.push({
      transactionId: transaction.id,
      transactionNumber: transaction.transactionNumber,
      completedAt: transaction.completedAt,
      dateLabel: stamp.dateLabel,
      timeLabel: stamp.timeLabel,
      customerId: transaction.customerId,
      customerName: customers.get(transaction.customerId)?.name ?? "客戶",
      content: financeIncomeContent(transaction),
      incomeKind: metrics.incomeKind,
      incomeKindLabel: FINANCE_INCOME_KIND_LABEL[metrics.incomeKind],
      serviceValueMinor: metrics.serviceValueMinor,
      packageOffsetMinor: metrics.packageRedemptionValueMinor,
      storedValueOffsetMinor: metrics.storedValueRedemptionMinor,
      collectedMinor: metrics.collectedMinor,
      paymentLabel,
      staffName: staff.get(transaction.createdByStaffId)?.displayName ?? "—",
    });
  }
  return rows.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}
