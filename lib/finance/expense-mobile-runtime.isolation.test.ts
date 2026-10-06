import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatTwd } from "@/lib/commerce/money";

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("expense mobile runtime", () => {
  it("keeps expense form and list operable without horizontal overflow", () => {
    const dialog = source("features/finance/ExpenseFormDialog.tsx");
    expect(dialog).toMatch(/max-h-\[92vh\] overflow-y-auto overflow-x-hidden/);
    expect(dialog).toMatch(/data-expense-form-dialog/);
    expect(dialog).toMatch(/role="dialog"/);
    expect(dialog).toMatch(/min-h-11/);
    const page = source("features/finance/FinanceExpensesPageClient.tsx");
    expect(page).toMatch(/min-\[1024px\]:hidden/);
    expect(page).toMatch(/overflow-x-auto/);
    expect(page).toMatch(/建立人/);
    expect(source("features/finance/FinanceWorkspace.tsx")).toMatch(/overflow-x-hidden/);
    expect(formatTwd(-19800)).toBe("-NT$19,800");
  });
});
