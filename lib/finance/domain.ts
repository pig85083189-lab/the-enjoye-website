/**
 * Finance V1 domain.
 * Income is derived from canonical Transaction — never a second ledger.
 * Expense is money-out. Stored Value WRITE stays closed.
 */

export const FINANCE_DISPLAY_TIMEZONE = "Asia/Taipei";
export const FINANCE_STORED_VALUE_WRITE_OPEN = false;
export const EXPENSE_REMOTE_WRITE_OPEN = false;

export type FinancePeriodKind = "day" | "week" | "month" | "custom";

export type FinanceIncomeKind = "SERVICE" | "PACKAGE_SALE" | "PRODUCT" | "OTHER";

export const FINANCE_INCOME_KIND_LABEL: Record<FinanceIncomeKind, string> = {
  SERVICE: "服務",
  PACKAGE_SALE: "套票銷售",
  PRODUCT: "產品",
  OTHER: "其他",
};

export type ExpenseCategory =
  | "SUPPLIES"
  | "PRODUCT_INVENTORY"
  | "SALARY"
  | "RENT"
  | "UTILITIES"
  | "MARKETING"
  | "EQUIPMENT"
  | "TRAINING"
  | "SOFTWARE"
  | "TAX"
  | "MISC"
  | "OTHER";

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  SUPPLIES: "耗材",
  PRODUCT_INVENTORY: "商品進貨",
  SALARY: "薪資",
  RENT: "房租",
  UTILITIES: "水電",
  MARKETING: "廣告行銷",
  EQUIPMENT: "設備",
  TRAINING: "教育訓練",
  SOFTWARE: "軟體",
  TAX: "稅費",
  MISC: "雜項",
  OTHER: "其他",
};

export const EXPENSE_CATEGORY_ORDER: ExpenseCategory[] = [
  "SALARY",
  "RENT",
  "SUPPLIES",
  "MARKETING",
  "UTILITIES",
  "PRODUCT_INVENTORY",
  "EQUIPMENT",
  "TRAINING",
  "SOFTWARE",
  "TAX",
  "MISC",
  "OTHER",
];

export type ExpensePaymentMethod = "CASH" | "CARD" | "TRANSFER" | "OTHER";

export const EXPENSE_PAYMENT_METHOD_LABEL: Record<ExpensePaymentMethod, string> = {
  CASH: "現金",
  CARD: "信用卡",
  TRANSFER: "轉帳",
  OTHER: "其他",
};

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
  paymentMethod: ExpensePaymentMethod;
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
