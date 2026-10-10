/**
 * User-safe messages for Expense remote create.
 * Never forwards raw PostgreSQL / PostgREST text to the UI.
 */

import { IdentityCatalogError, UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import {
  EXPENSE_WRITE_UNAUTHORIZED_MESSAGE,
  ExpenseWriteCreateOnlyError,
  ExpenseWritePilotOffError,
  ExpenseWriteUnauthorizedError,
} from "./expense-write-guard";

export const EXPENSE_WRITE_UI = {
  name: "請輸入支出名稱",
  amount: "支出金額必須大於 0",
  date: "請選擇支出日期",
  category: "請選擇支出分類",
  unauthorized: "你沒有新增支出的權限",
  generic: "無法建立支出，請稍後再試",
  off: "支出寫入尚未開放",
  createOnly: "目前僅能新增支出",
} as const;

function looksLikeDatabaseText(message: string): boolean {
  return /23505|42501|RLS|row-level|duplicate key|unique constraint|violates|SQLSTATE|postgres|permission denied|PGRST/i.test(
    message,
  );
}

export function expenseWriteUserMessage(error: unknown): string {
  if (error instanceof ExpenseWritePilotOffError) return EXPENSE_WRITE_UI.off;
  if (error instanceof ExpenseWriteCreateOnlyError) return EXPENSE_WRITE_UI.createOnly;
  if (error instanceof ExpenseWriteUnauthorizedError) return EXPENSE_WRITE_UI.unauthorized;
  if (error instanceof UnmappedIdentityError) return EXPENSE_WRITE_UI.generic;
  if (error instanceof IdentityCatalogError) {
    if (error.reason === "unauthenticated") return EXPENSE_WRITE_UI.generic;
    return EXPENSE_WRITE_UI.generic;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes(EXPENSE_WRITE_UNAUTHORIZED_MESSAGE) ||
    /Unauthorized to create expenses/i.test(message) ||
    /new row violates row-level security/i.test(message) ||
    /42501/.test(message)
  ) {
    return EXPENSE_WRITE_UI.unauthorized;
  }
  if (message.includes("請輸入支出名稱") || /expense name required/i.test(message)) {
    return EXPENSE_WRITE_UI.name;
  }
  if (message.includes("支出金額必須大於 0") || /amount must be a positive integer/i.test(message)) {
    return EXPENSE_WRITE_UI.amount;
  }
  if (message.includes("請選擇支出日期") || /Invalid YMD/i.test(message)) {
    return EXPENSE_WRITE_UI.date;
  }
  if (message.includes("請選擇支出分類") || /expense category/i.test(message)) {
    return EXPENSE_WRITE_UI.category;
  }
  if (looksLikeDatabaseText(message)) {
    return /42501|row-level|permission denied/i.test(message)
      ? EXPENSE_WRITE_UI.unauthorized
      : EXPENSE_WRITE_UI.generic;
  }
  return EXPENSE_WRITE_UI.generic;
}
