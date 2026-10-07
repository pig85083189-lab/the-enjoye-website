import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPENSE_REMOTE_WRITE_PILOT_ENV, isExpenseRemoteWritePilotEnabled } from "./expense-remote-write-flag";
import {
  FINANCE_REMOTE_READ_PILOT_ENV,
  isFinanceRemoteReadPilotEnabled,
} from "./finance-remote-read-flag";
import { getPersistenceDriver } from "@/lib/persistence/driver";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("finance RSC flag boundary", () => {
  it("keeps finance pages on flag files, not the adapter graph", () => {
    for (const rel of [
      "app/staff/(app)/finance/page.tsx",
      "app/staff/(app)/finance/income/page.tsx",
      "app/staff/(app)/finance/expenses/page.tsx",
      "app/staff/(app)/finance/reports/page.tsx",
    ]) {
      const source = read(rel);
      expect(source).toMatch(/isFinanceRemoteReadPilotEnabled/);
      expect(source).toMatch(/finance-remote-read-flag/);
      expect(source).toMatch(/isExpenseRemoteWritePilotEnabled/);
      expect(source).toMatch(/expense-remote-write-flag/);
      expect(source).not.toMatch(/finance-remote-read-pilot/);
      expect(source).not.toMatch(/expense-remote-write-pilot/);
      expect(source).not.toMatch(/AuthenticatedExpenseReadStore|AuthenticatedCommerceStore/);
      expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("does not enable finance pilots from persistence globals", () => {
    expect(
      isFinanceRemoteReadPilotEnabled({
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe(false);
    expect(
      isExpenseRemoteWritePilotEnabled({
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_EXPENSE_REMOTE_WRITE_PILOT: "1",
      }),
    ).toBe(false);
    expect(
      isExpenseRemoteWritePilotEnabled({
        [FINANCE_REMOTE_READ_PILOT_ENV]: "1",
        [EXPENSE_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(true);
    expect(getPersistenceDriver({ [FINANCE_REMOTE_READ_PILOT_ENV]: "1" })).toBe("local");
  });

  it("does not enable finance flags in env files", () => {
    for (const file of [".env", ".env.local", ".env.development", "vercel.json"]) {
      if (!existsSync(path.join(ROOT, file))) continue;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(/BEAUTY_OS_FINANCE_REMOTE_READ_PILOT/);
      expect(source).not.toMatch(/BEAUTY_OS_EXPENSE_REMOTE_WRITE_PILOT/);
    }
  });
});
