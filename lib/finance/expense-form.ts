/**
 * Expense create form validation. Amount stays NT$ integer (no * 100).
 */
import {
  isExpenseCategory,
  isExpensePaymentMethod,
  type ExpenseCategory,
  type ExpensePaymentMethod,
} from "./domain";
import { EXPENSE_WRITE_UI } from "./expense-write-ui-error";
import { parseYmd } from "./period";

export type ExpenseFormDraft = {
  expenseDate: string;
  category: string;
  name: string;
  amount: string;
  paymentMethod: string;
  vendor: string;
  note: string;
};

export type ParsedExpenseForm = {
  expenseDate: string;
  category: ExpenseCategory;
  name: string;
  amountMinor: number;
  paymentMethod: ExpensePaymentMethod | null;
  vendor: string;
  note: string;
};

export function parseExpenseAmountInput(raw: string): number | null {
  const trimmed = raw.replace(/NT\$/gi, "").replace(/[,，\s]/g, "").trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

export function parseExpenseFormDraft(
  draft: ExpenseFormDraft,
): { ok: true; value: ParsedExpenseForm } | { ok: false; error: string } {
  const expenseDate = draft.expenseDate.trim();
  if (!expenseDate) return { ok: false, error: EXPENSE_WRITE_UI.date };
  try {
    parseYmd(expenseDate);
  } catch {
    return { ok: false, error: EXPENSE_WRITE_UI.date };
  }
  if (!isExpenseCategory(draft.category)) {
    return { ok: false, error: EXPENSE_WRITE_UI.category };
  }
  const name = draft.name.trim();
  if (!name) return { ok: false, error: EXPENSE_WRITE_UI.name };
  const amountMinor = parseExpenseAmountInput(draft.amount);
  if (amountMinor == null) return { ok: false, error: EXPENSE_WRITE_UI.amount };
  const paymentRaw = draft.paymentMethod.trim();
  if (paymentRaw && !isExpensePaymentMethod(paymentRaw)) {
    return { ok: false, error: EXPENSE_WRITE_UI.generic };
  }
  return {
    ok: true,
    value: {
      expenseDate,
      category: draft.category,
      name,
      amountMinor,
      paymentMethod: paymentRaw && isExpensePaymentMethod(paymentRaw) ? paymentRaw : null,
      vendor: draft.vendor.trim(),
      note: draft.note.trim(),
    },
  };
}
