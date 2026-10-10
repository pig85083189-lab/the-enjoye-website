import {
  isExpenseCategory,
  isExpensePaymentMethod,
  type Expense,
} from "./domain";

export const REMOTE_EXPENSE_COLUMNS = [
  "id",
  "app_id",
  "organization_id",
  "location_id",
  "expense_date",
  "category",
  "name",
  "amount_minor",
  "payment_method",
  "vendor",
  "note",
  "receipt_url",
  "created_by_staff_id",
  "created_at",
  "updated_at",
] as const;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asInt(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  return 0;
}

export function expenseFromRemoteRow(
  row: Record<string, unknown>,
  ids: { organizationId: string; locationId: string },
): Expense {
  const id = asString(row.app_id) || asString(row.id);
  const category = asString(row.category);
  const paymentMethod = asString(row.payment_method);
  if (!id || !isExpenseCategory(category)) {
    throw new Error("Remote expense row is missing required columns");
  }
  if (paymentMethod && !isExpensePaymentMethod(paymentMethod)) {
    throw new Error("Remote expense row has an invalid payment method");
  }
  return {
    id,
    appId: asString(row.app_id) || id,
    organizationId: ids.organizationId,
    locationId: ids.locationId,
    expenseDate: asString(row.expense_date).slice(0, 10),
    category,
    name: asString(row.name),
    amountMinor: asInt(row.amount_minor),
    paymentMethod: paymentMethod && isExpensePaymentMethod(paymentMethod) ? paymentMethod : null,
    vendor: asString(row.vendor),
    note: asString(row.note),
    receiptUrl: asNullableString(row.receipt_url),
    createdByStaffId: asString(row.created_by_staff_id),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

export type RemoteExpenseInsert = {
  organization_id: string;
  location_id: string;
  app_id: string;
  expense_date: string;
  category: string;
  name: string;
  amount_minor: number;
  payment_method: string | null;
  vendor: string | null;
  note: string | null;
  created_by_staff_id: string;
};

export function remoteExpensePayload(row: RemoteExpenseInsert): Record<string, unknown> {
  return {
    organization_id: row.organization_id,
    location_id: row.location_id,
    app_id: row.app_id,
    expense_date: row.expense_date,
    category: row.category,
    name: row.name,
    amount_minor: row.amount_minor,
    payment_method: row.payment_method,
    vendor: row.vendor,
    note: row.note,
    created_by_staff_id: row.created_by_staff_id,
  };
}
