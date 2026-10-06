/**
 * Expense presentation helpers. Canonical rows live in public.expenses.
 */
import {
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_PAYMENT_METHOD_LABEL,
  type Expense,
} from "./domain";
import { isYmdInRange, type FinanceDateRange } from "./period";

export type ExpenseDateFilter = "today" | "7d" | "month" | "custom";

export type FinanceExpenseRow = {
  id: string;
  expenseDate: string;
  category: Expense["category"];
  categoryLabel: string;
  name: string;
  amountMinor: number;
  paymentMethod: Expense["paymentMethod"];
  paymentLabel: string;
  vendor: string;
  note: string;
};

export function expenseMatchesSearch(expense: Expense, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [expense.name, expense.vendor, expense.note]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function buildFinanceExpenseRows(input: {
  expenses: Expense[];
  organizationId: string;
  locationId: string;
  range: FinanceDateRange;
  query?: string;
}): FinanceExpenseRow[] {
  return input.expenses
    .filter(
      (row) =>
        row.organizationId === input.organizationId &&
        row.locationId === input.locationId &&
        isYmdInRange(row.expenseDate, input.range) &&
        expenseMatchesSearch(row, input.query ?? ""),
    )
    .sort((a, b) => {
      const date = b.expenseDate.localeCompare(a.expenseDate);
      if (date !== 0) return date;
      return b.createdAt.localeCompare(a.createdAt);
    })
    .map((row) => ({
      id: row.id,
      expenseDate: row.expenseDate,
      category: row.category,
      categoryLabel: EXPENSE_CATEGORY_LABEL[row.category],
      name: row.name,
      amountMinor: row.amountMinor,
      paymentMethod: row.paymentMethod,
      paymentLabel: EXPENSE_PAYMENT_METHOD_LABEL[row.paymentMethod],
      vendor: row.vendor,
      note: row.note,
    }));
}

export function assertExpenseAmountMinor(amountMinor: number): number {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("Expense amount must be a positive integer minor unit");
  }
  return amountMinor;
}
