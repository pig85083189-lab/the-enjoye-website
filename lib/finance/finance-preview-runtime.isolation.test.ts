import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatTwd } from "@/lib/commerce/money";
import { STORED_VALUE_WRITE_OPEN } from "@/lib/commerce/transaction-tender-presentation";
import {
  EXPENSE_REMOTE_WRITE_OPEN,
  FINANCE_STORED_VALUE_WRITE_OPEN,
} from "@/lib/finance/domain";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("finance preview runtime boundary", () => {
  it("marks StaffShell finance as remote-pilot and does not fake expense zero", () => {
    const workspace = read("features/finance/FinanceWorkspace.tsx");
    expect(workspace).toMatch(/data-finance-source=\{financeRemoteReadPilot \? "remote-pilot" : "off"\}/);
    expect(workspace).toMatch(/data-expense-ledger/);
    expect(workspace).toMatch(/data-finance-location/);
    expect(workspace).toMatch(/data-finance-range-start/);
    expect(workspace).toMatch(/data-finance-tx-count/);
    expect(workspace).toMatch(/EXPENSE_LEDGER_UNAVAILABLE_MESSAGE/);
    expect(workspace).toMatch(/EXPENSE_DELTA_PENDING_MESSAGE/);
    expect(workspace).not.toMatch(/visual-fixture/);
    expect(read("features/finance/FinanceReportsPageClient.tsx")).toMatch(
      /EXPENSE_LEDGER_UNAVAILABLE_MESSAGE/,
    );
    expect(read("features/finance/FinanceExpensesPageClient.tsx")).toMatch(
      /EXPENSE_LEDGER_UNAVAILABLE_MESSAGE/,
    );
    expect(read("features/finance/FinanceExpensesPageClient.tsx")).toMatch(
      /EXPENSE_WRITE_CLOSED_MESSAGE/,
    );
    expect(read("features/finance/FinanceExpensesPageClient.tsx")).toMatch(/disabled=\{formDisabled\}/);
    expect(read("features/finance/FinanceExpensesPageClient.tsx")).toMatch(/aria-disabled=\{formDisabled\}/);
    expect(read("features/finance/FinanceExpensesPageClient.tsx")).toMatch(/ExpenseFormDialog/);
    expect(read("features/finance/FinanceExpensesPageClient.tsx")).toMatch(/sheetOpen && writeOpen/);
    expect(read("features/finance/FinanceExpensesPageClient.tsx")).not.toMatch(/localStorage/);
  });

  it("formats negative TWD as -NT$ not NT$-", () => {
    expect(formatTwd(-60200)).toBe("-NT$60,200");
    expect(formatTwd(-60200)).not.toMatch(/^NT\$-/);
    expect(FINANCE_STORED_VALUE_WRITE_OPEN).toBe(false);
    expect(STORED_VALUE_WRITE_OPEN).toBe(false);
    expect(EXPENSE_REMOTE_WRITE_OPEN).toBe(false);
  });

  it("does not enable finance flags from committed env", () => {
    for (const file of [".env", ".env.local", ".env.development", "vercel.json"]) {
      if (!existsSync(path.join(ROOT, file))) continue;
      expect(readFileSync(path.join(ROOT, file), "utf8")).not.toMatch(
        /BEAUTY_OS_FINANCE_REMOTE_READ_PILOT|BEAUTY_OS_EXPENSE_REMOTE_WRITE_PILOT/,
      );
    }
  });
});
