/**
 * Finance V1 domain.
 * Income is derived from canonical Transaction — never a second ledger.
 * Expense is money-out. Stored Value WRITE stays closed.
 */

export const FINANCE_DISPLAY_TIMEZONE = "Asia/Taipei";
export const FINANCE_STORED_VALUE_WRITE_OPEN = false;
export const EXPENSE_REMOTE_WRITE_OPEN = false;

/** Expense table / SELECT not available yet. Do not present NT$0 as a real total. */
export const EXPENSE_LEDGER_UNAVAILABLE_MESSAGE = "支出記帳尚未啟用";
export const EXPENSE_DELTA_PENDING_MESSAGE = "尚待支出資料";

export type ExpenseRemoteAvailability = "ready" | "unavailable";

export type FinancePeriodKind = "day" | "week" | "month" | "custom";

export type FinanceIncomeKind = "SERVICE" | "PACKAGE_SALE" | "PRODUCT" | "OTHER";

export const FINANCE_INCOME_KIND_LABEL: Record<FinanceIncomeKind, string> = {
  SERVICE: "服務",
  PACKAGE_SALE: "套票銷售",
  PRODUCT: "產品",
  OTHER: "其他",
};

export type ExpenseCategory =
  | "RENT"
  | "UTILITIES"
  | "SUPPLIES"
  | "PRODUCTS"
  | "SALARY"
  | "MARKETING"
  | "EQUIPMENT"
  | "MAINTENANCE"
  | "FEES"
  | "TAX"
  | "OTHER";

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  RENT: "店租",
  UTILITIES: "水電",
  SUPPLIES: "耗材",
  PRODUCTS: "產品進貨",
  SALARY: "薪資",
  MARKETING: "行銷廣告",
  EQUIPMENT: "設備",
  MAINTENANCE: "維修",
  FEES: "手續費",
  TAX: "稅務",
  OTHER: "其他",
};

export const EXPENSE_CATEGORY_ORDER: ExpenseCategory[] = [
  "RENT",
  "UTILITIES",
  "SUPPLIES",
  "PRODUCTS",
  "SALARY",
  "MARKETING",
  "EQUIPMENT",
  "MAINTENANCE",
  "FEES",
  "TAX",
  "OTHER",
];

export type ExpensePaymentMethod = "CASH" | "TRANSFER" | "CARD" | "OTHER";

export const EXPENSE_PAYMENT_METHOD_LABEL: Record<ExpensePaymentMethod, string> = {
  CASH: "現金",
  TRANSFER: "轉帳",
  CARD: "刷卡",
  OTHER: "其他",
};

export const EXPENSE_PAYMENT_METHOD_ORDER: ExpensePaymentMethod[] = [
  "CASH",
  "TRANSFER",
  "CARD",
  "OTHER",
];

export type FinanceDateRange = {
  startYmd: string;
  endYmd: string;
};

export type Expense = {
  id: string;
  appId: string;
  organizationId: string;
  locationId: string;
  expenseDate: string;
  category: ExpenseCategory;
  name: string;
  amountMinor: number;
  paymentMethod: ExpensePaymentMethod | null;
  vendor: string;
  note: string;
  receiptUrl: string | null;
  createdByStaffId: string;
  createdAt: string;
  updatedAt: string;
};

export type FinanceCustomerHint = {
  id: string;
  name: string;
  phone: string;
};

export type FinanceStaffHint = {
  id: string;
  displayName: string;
};

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return value in EXPENSE_CATEGORY_LABEL;
}

export function isExpensePaymentMethod(value: string): value is ExpensePaymentMethod {
  return value in EXPENSE_PAYMENT_METHOD_LABEL;
}
