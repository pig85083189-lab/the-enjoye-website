import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AuthenticatedExpenseReadStore } from "@/lib/finance/authenticated-expense-store";
import { assertExpenseAmountMinor, buildFinanceExpenseRows } from "@/lib/finance/expense";
import { EXPENSE_REMOTE_WRITE_PILOT_ENV } from "@/lib/finance/expense-remote-write-flag";
import {
  createAuthenticatedExpenseWrite,
  EXPENSE_REMOTE_WRITE_PILOT_OFF_MESSAGE,
} from "@/lib/finance/expense-remote-write-pilot";
import { FINANCE_EXPENSE_FOUNDATION_MIGRATION_FILE } from "@/lib/persistence/schema-contract";
import { LOC_ENJOYE_PRIMARY_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import type { Expense } from "@/lib/finance/domain";
import { monthRangeContaining } from "@/lib/finance/period";

const sql = readFileSync(
  path.join(process.cwd(), FINANCE_EXPENSE_FOUNDATION_MIGRATION_FILE),
  "utf8",
);

describe("finance expense domain + schema", () => {
  it("creates expenses table with org/location RLS and SELECT+INSERT grants", () => {
    expect(sql).toMatch(/create table if not exists public\.expenses/);
    expect(sql).toMatch(/organization_id uuid not null/);
    expect(sql).toMatch(/location_id uuid not null/);
    expect(sql).toMatch(/amount_minor integer not null/);
    expect(sql).toMatch(/user_has_org_membership\(expenses\.organization_id\)/);
    expect(sql).toMatch(/user_can_access_location\(expenses\.organization_id, expenses\.location_id\)/);
    expect(sql).toMatch(/grant select, insert on public\.expenses to authenticated/);
    expect(sql).not.toMatch(/grant update on public\.expenses/);
    expect(sql).not.toMatch(/\binsert into public\.expenses\b/i);
    expect(sql).not.toMatch(/create table[\s\S]*transaction_payments/);
    expect(sql).not.toMatch(/references public\.transaction_payments/);
  });

  it("filters expense rows by org, location, range, and search", () => {
    const rows: Expense[] = [
      {
        id: "e1",
        appId: "e1",
        organizationId: ORG_ENJOYE_ID,
        locationId: LOC_ENJOYE_PRIMARY_ID,
        expenseDate: "2026-10-06",
        category: "SUPPLIES",
        name: "美胸按摩霜",
        amountMinor: 3000,
        paymentMethod: "CASH",
        vendor: "XX美容材料",
        note: "",
        receiptUrl: null,
        createdByStaffId: "staff-001",
        createdAt: "2026-10-06T01:00:00.000Z",
        updatedAt: "2026-10-06T01:00:00.000Z",
      },
      {
        id: "e2",
        appId: "e2",
        organizationId: "org-other",
        locationId: LOC_ENJOYE_PRIMARY_ID,
        expenseDate: "2026-10-06",
        category: "RENT",
        name: "店租",
        amountMinor: 23000,
        paymentMethod: "TRANSFER",
        vendor: "房東",
        note: "",
        receiptUrl: null,
        createdByStaffId: "staff-001",
        createdAt: "2026-10-06T01:00:00.000Z",
        updatedAt: "2026-10-06T01:00:00.000Z",
      },
    ];
    const found = buildFinanceExpenseRows({
      expenses: rows,
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      range: monthRangeContaining("2026-10-06"),
      query: "美胸",
    });
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("美胸按摩霜");
    expect(found[0].categoryLabel).toBe("耗材");
  });

  it("refuses expense writes when the WRITE pilot is off", () => {
    expect(() => assertExpenseAmountMinor(0)).toThrow(/positive integer/);
    expect(() => createAuthenticatedExpenseWrite()).toThrow(EXPENSE_REMOTE_WRITE_PILOT_OFF_MESSAGE);
    const store = new AuthenticatedExpenseReadStore({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from() {
        throw new Error("unused");
      },
    });
    expect(() => store.insertExpense()).toThrow(/read-only/);
    expect(EXPENSE_REMOTE_WRITE_PILOT_ENV).toBe("BEAUTY_OS_EXPENSE_REMOTE_WRITE_PILOT");
  });
});
