import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatTwd } from "@/lib/commerce/money";
import { STORED_VALUE_WRITE_OPEN } from "@/lib/commerce/transaction-tender-presentation";
import {
  ExpenseSchemaUnavailableError,
  isExpenseSchemaUnavailableError,
} from "@/lib/finance/authenticated-expense-store";
import {
  EXPENSE_DELTA_PENDING_MESSAGE,
  EXPENSE_LEDGER_UNAVAILABLE_MESSAGE,
  FINANCE_STORED_VALUE_WRITE_OPEN,
} from "@/lib/finance/domain";
import { createAuthenticatedExpenseWrite } from "@/lib/finance/expense-remote-write-pilot";
import { isExpenseRemoteWritePilotEnabled } from "@/lib/finance/expense-remote-write-flag";
import { isFinanceRemoteReadPilotEnabled } from "@/lib/finance/finance-remote-read-flag";
import { readExpenseLedger } from "@/lib/finance/finance-remote-read-pilot";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("finance remote READ canary", () => {
  it("does not use local fallback when remote READ is on", () => {
    for (const rel of [
      "lib/finance/finance-remote-read-pilot.ts",
      "features/finance/use-finance-remote.ts",
      "features/finance/FinanceWorkspace.tsx",
    ]) {
      const source = read(rel);
      expect(source).not.toMatch(/transaction-store/);
      expect(source).not.toMatch(/\blocalStorage\./);
      expect(source).not.toMatch(/visual-fixture/);
      expect(source).not.toMatch(/BEAUTY_OS_PERSISTENCE/);
    }
  });

  it("treats a missing expenses table as unavailable, not fake zero income failure", async () => {
    expect(isExpenseSchemaUnavailableError({ code: "PGRST205", message: "Could not find the table 'public.expenses' in the schema cache" })).toBe(true);
    expect(isExpenseSchemaUnavailableError(new ExpenseSchemaUnavailableError())).toBe(true);
    expect(isExpenseSchemaUnavailableError(new Error("permission denied"))).toBe(false);

    const ledger = await readExpenseLedger({
      store: {
        listExpenses: async () => {
          throw new ExpenseSchemaUnavailableError("Could not find the table 'public.expenses'");
        },
      },
      organizationDbId: "org-db",
      locationDbId: "loc-db",
      organizationAppId: "org-the-enjoye",
      locationAppId: "loc-enjoye-main",
    });
    expect(ledger.availability).toBe("unavailable");
    expect(ledger.expenses).toEqual([]);
  });

  it("keeps Expense CREATE and Stored Value WRITE closed", () => {
    expect(isFinanceRemoteReadPilotEnabled({ BEAUTY_OS_FINANCE_REMOTE_READ_PILOT: "1" })).toBe(true);
    expect(isExpenseRemoteWritePilotEnabled({ BEAUTY_OS_FINANCE_REMOTE_READ_PILOT: "1" })).toBe(false);
    expect(() => createAuthenticatedExpenseWrite()).toThrow();
    expect(FINANCE_STORED_VALUE_WRITE_OPEN).toBe(false);
    expect(STORED_VALUE_WRITE_OPEN).toBe(false);
  });

  it("does not put finance flags in repo env files", () => {
    for (const file of [".env", ".env.local", ".env.development", "vercel.json"]) {
      if (!existsSync(path.join(ROOT, file))) continue;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(/BEAUTY_OS_FINANCE_REMOTE_READ_PILOT/);
      expect(source).not.toMatch(/BEAUTY_OS_EXPENSE_REMOTE_WRITE_PILOT/);
    }
    expect(EXPENSE_LEDGER_UNAVAILABLE_MESSAGE).toBe("支出記帳尚未啟用");
    expect(EXPENSE_DELTA_PENDING_MESSAGE).toBe("尚待支出資料");
    expect(formatTwd(-60200)).toBe("-NT$60,200");
    expect(formatTwd(23800)).toBe("NT$23,800");
  });
});
