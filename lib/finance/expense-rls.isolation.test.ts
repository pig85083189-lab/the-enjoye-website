import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FINANCE_EXPENSE_FOUNDATION_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

const sql = readFileSync(
  path.join(process.cwd(), FINANCE_EXPENSE_FOUNDATION_MIGRATION_FILE),
  "utf8",
);

describe("expense RLS", () => {
  it("SELECT requires active membership plus organization and location boundary", () => {
    expect(sql).toMatch(/create policy expenses_select_org on public\.expenses\s+for select to authenticated/);
    expect(sql).toMatch(/user_has_org_membership\(expenses\.organization_id\)/);
    expect(sql).toMatch(/user_can_access_location\(expenses\.organization_id, expenses\.location_id\)/);
  });

  it("INSERT is OWNER / MANAGER only with org and location boundary", () => {
    expect(sql).toMatch(/create policy expenses_insert_org on public\.expenses\s+for insert to authenticated/);
    expect(sql).toMatch(
      /staff_role_is_managerial\(public\.user_org_role\(expenses\.organization_id\)\)/,
    );
    expect(sql).toMatch(/created_by_staff_id = public\.user_operational_staff_id\(expenses\.organization_id\)/);
    expect(sql).toMatch(/grant select, insert on public\.expenses to authenticated/);
    expect(sql).not.toMatch(/grant update on public\.expenses/);
    expect(sql).not.toMatch(/grant delete on public\.expenses/);
  });

  it("does not open UPDATE / DELETE", () => {
    expect(sql).toMatch(/drop policy if exists expenses_update_org on public\.expenses;/);
    expect(sql).toMatch(/drop policy if exists expenses_delete_org on public\.expenses;/);
    expect(sql).not.toMatch(/create policy expenses_update_org/);
    expect(sql).not.toMatch(/create policy expenses_delete_org/);
    expect(sql).not.toMatch(/for update to authenticated/);
    expect(sql).not.toMatch(/for delete to authenticated/);
  });
});
