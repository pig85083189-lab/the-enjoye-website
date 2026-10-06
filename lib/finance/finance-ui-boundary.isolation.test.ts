import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STORED_VALUE_WRITE_OPEN } from "@/lib/commerce/transaction-tender-presentation";
import { FINANCE_STORED_VALUE_WRITE_OPEN } from "@/lib/finance/domain";
import { STAFF_REMOTE_CREATE_PILOT_ENV } from "@/lib/staff/staff-remote-create-flag";
import { APPOINTMENT_REMOTE_MUTATE_PILOT_ENV } from "@/lib/appointments/appointment-remote-mutate-flag";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const FINANCE_UI = [
  "features/finance/FinanceWorkspace.tsx",
  "features/finance/FinanceDashboardPageClient.tsx",
  "features/finance/FinanceIncomePageClient.tsx",
  "features/finance/FinanceExpensesPageClient.tsx",
  "features/finance/FinanceReportsPageClient.tsx",
  "features/finance/use-finance-remote.ts",
];

describe("finance UI boundary", () => {
  it("does not use local transaction-store fallback on the finance UI", () => {
    for (const rel of FINANCE_UI) {
      const source = read(rel);
      expect(source).not.toMatch(/transaction-store/);
      expect(source).not.toMatch(/listTransactions\(/);
      expect(source).not.toMatch(/localStorage/);
      expect(source).not.toMatch(/BEAUTY_OS_PERSISTENCE/);
    }
  });

  it("income page reuses Transaction detail instead of a second model", () => {
    const income = read("features/finance/FinanceIncomePageClient.tsx");
    expect(income).toMatch(/\/staff\/transactions\?id=/);
    expect(income).not.toMatch(/TransactionQuickView/);
  });

  it("does not open Stored Value WRITE, Appointment MUTATE, or Staff CREATE", () => {
    expect(FINANCE_STORED_VALUE_WRITE_OPEN).toBe(false);
    expect(STORED_VALUE_WRITE_OPEN).toBe(false);
    for (const rel of [...FINANCE_UI, "lib/finance/finance-remote-read-pilot.ts"]) {
      const source = read(rel);
      expect(source).not.toMatch(/STORED_VALUE_WRITE_OPEN\s*=\s*true/);
      expect(source).not.toMatch(STAFF_REMOTE_CREATE_PILOT_ENV);
      expect(source).not.toMatch(APPOINTMENT_REMOTE_MUTATE_PILOT_ENV);
      expect(source).not.toMatch(/completeCheckout|settleCheckoutDraft/);
    }
  });

  it("does not enable finance flags in env files", () => {
    for (const file of [".env", ".env.local", "vercel.json"]) {
      if (!existsSync(path.join(ROOT, file))) continue;
      expect(readFileSync(path.join(ROOT, file), "utf8")).not.toMatch(
        /BEAUTY_OS_FINANCE_REMOTE_READ_PILOT|BEAUTY_OS_EXPENSE_REMOTE_WRITE_PILOT/,
      );
    }
  });
});
