import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPENSE_WRITE_CLOSED_MESSAGE } from "@/lib/finance/domain";
import {
  FINANCE_EXPENSE_FOUNDATION_MIGRATION_FILE,
  FINANCE_EXPENSE_WRITE_HARDENING_MIGRATION_FILE,
} from "@/lib/persistence/schema-contract";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

const foundation = read(FINANCE_EXPENSE_FOUNDATION_MIGRATION_FILE);
const hardening = read(FINANCE_EXPENSE_WRITE_HARDENING_MIGRATION_FILE);

describe("expense write hardening", () => {
  it("does not rewrite the already-applied Preview foundation migration", () => {
    const headFoundation = execSync(
      `git show e3051ddadabf043826b399591dc2128f8a2e6939:${FINANCE_EXPENSE_FOUNDATION_MIGRATION_FILE}`,
      { encoding: "utf8" },
    );
    expect(foundation).toBe(headFoundation);
    expect(FINANCE_EXPENSE_WRITE_HARDENING_MIGRATION_FILE).toContain("20261007130000");
    expect(FINANCE_EXPENSE_WRITE_HARDENING_MIGRATION_FILE > FINANCE_EXPENSE_FOUNDATION_MIGRATION_FILE).toBe(
      true,
    );
  });

  it("revokes INSERT and drops the insert policy while keeping SELECT", () => {
    expect(hardening).toMatch(/revoke insert on public\.expenses from authenticated;/);
    expect(hardening).toMatch(/drop policy if exists expenses_insert_org on public\.expenses;/);
    expect(hardening).toMatch(/drop policy if exists expenses_update_org on public\.expenses;/);
    expect(hardening).toMatch(/drop policy if exists expenses_delete_org on public\.expenses;/);
    expect(hardening).toMatch(/revoke update, delete on public\.expenses from public, anon, authenticated;/);
    expect(hardening).toMatch(/grant select on public\.expenses to authenticated;/);
    expect(hardening).toMatch(/grant usage on type public\.expense_category to authenticated;/);
    expect(hardening).toMatch(/grant usage on type public\.expense_payment_method to authenticated;/);
    expect(hardening).not.toMatch(/create policy expenses_insert_org/);
    expect(hardening).not.toMatch(/create policy expenses_update_org/);
    expect(hardening).not.toMatch(/create policy expenses_delete_org/);
    expect(hardening).not.toMatch(/grant insert on public\.expenses/);
    expect(hardening).not.toMatch(/grant update on public\.expenses/);
    expect(hardening).not.toMatch(/grant delete on public\.expenses/);
    expect(hardening).not.toMatch(/drop table/i);
    expect(hardening).not.toMatch(/drop policy if exists expenses_select_org/);
    expect(hardening).not.toMatch(/\btruncate\s+table\b/i);
    expect(hardening).not.toMatch(/\binsert into\b/i);
    expect(hardening).not.toMatch(/\bdelete from public\.expenses\b/i);
    expect(hardening).not.toMatch(/exp-muxedi3i-sszax4|TX-20261005-0001/);
    expect(foundation).toMatch(/create policy expenses_select_org on public\.expenses\s+for select to authenticated/);
    expect(foundation).toMatch(/grant select, insert on public\.expenses to authenticated/);
  });

  it("closes the expenses create form when WRITE is off", () => {
    const page = read("features/finance/FinanceExpensesPageClient.tsx");
    expect(page).toMatch(/EXPENSE_WRITE_CLOSED_MESSAGE/);
    expect(page).toContain(EXPENSE_WRITE_CLOSED_MESSAGE);
    expect(page).toMatch(/data-expense-write-closed/);
    expect(page).toMatch(/writeOpen \? \(/);
    expect(page).toMatch(/sheetOpen && writeOpen/);
    expect(page).toMatch(/if \(formDisabled\) return;/);
    expect(page).toMatch(/支出記帳尚未開放/);
    expect(page).not.toMatch(/localStorage/);
    expect(page).not.toMatch(/optimistic/);
  });
});
