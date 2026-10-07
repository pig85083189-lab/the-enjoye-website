import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FINANCE_EXPENSE_FOUNDATION_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

const sql = readFileSync(
  path.join(process.cwd(), FINANCE_EXPENSE_FOUNDATION_MIGRATION_FILE),
  "utf8",
);

describe("expense migration foundation", () => {
  it("creates public.expenses with required columns and exp-* identity", () => {
    expect(sql).toMatch(/create table if not exists public\.expenses/);
    expect(sql).toMatch(/id uuid primary key/);
    expect(sql).toMatch(/app_id text not null/);
    expect(sql).toMatch(/organization_id uuid not null/);
    expect(sql).toMatch(/location_id uuid not null/);
    expect(sql).toMatch(/expense_date date not null/);
    expect(sql).toMatch(/category public\.expense_category not null/);
    expect(sql).toMatch(/name text not null/);
    expect(sql).toMatch(/amount_minor integer not null/);
    expect(sql).toMatch(/payment_method public\.expense_payment_method,/);
    expect(sql).toMatch(/vendor text,/);
    expect(sql).toMatch(/note text,/);
    expect(sql).toMatch(/receipt_url text,/);
    expect(sql).toMatch(/created_by_staff_id text not null/);
    expect(sql).toMatch(/created_at timestamptz not null/);
    expect(sql).toMatch(/updated_at timestamptz not null/);
    expect(sql).toMatch(/constraint expenses_amount_minor_positive check \(amount_minor > 0\)/);
    expect(sql).toMatch(/constraint expenses_app_id_unique unique \(app_id\)/);
    expect(sql).toMatch(/expenses_app_id_format check \(app_id ~ '\^exp-\[a-z0-9\]\+-\[a-z0-9\]\+\$'/);
    expect(sql).toMatch(/is_operational_staff_id\(created_by_staff_id\)/);
    expect(sql).not.toMatch(/\binsert into public\.expenses\b/i);
    expect(sql).not.toMatch(/TX-20261005-0001/);
  });

  it("uses canonical expense categories and payment methods, not Chinese labels", () => {
    for (const category of [
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
    ]) {
      expect(sql).toContain(`'${category}'`);
    }
    expect(sql).not.toMatch(/PRODUCT_INVENTORY|TRAINING|SOFTWARE|'MISC'/);
    expect(sql).toMatch(/'CASH'/);
    expect(sql).toMatch(/'TRANSFER'/);
    expect(sql).toMatch(/'CARD'/);
    expect(sql).not.toMatch(/店租|水電|耗材|產品進貨/);
    expect(sql).not.toMatch(/references public\.transaction_payments/);
  });
});
