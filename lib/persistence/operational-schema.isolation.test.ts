import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_INTEGRITY_MIGRATION_FILE,
  COMMERCE_REMOTE_SETTLEMENT_MIGRATION_FILE,
  COMMERCE_TABLE_WRITE_HARDENING_MIGRATION_FILE,
  STRATEGY_B_RLS_MIGRATION_FILE,
  ENUM_ADAPT_MIGRATION_FILE,
  FORBIDDEN_STORED_COLUMNS,
  FOUNDATION_MIGRATION_FILE,
  IDENTITY_MIGRATION_FILE,
  LEDGER_EFFECT_KEY_INDEXES,
  OPERATIONAL_MIGRATION_FILE,
  OPERATIONAL_TABLES,
  SOURCE_OF_TRUTH,
  STAFF_ROLE_ADAPT,
} from "./schema-contract";

function readMigration(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function createTableBodies(sql: string): Map<string, string> {
  const map = new Map<string, string>();
  const re =
    /create table if not exists public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi;
  for (const match of sql.matchAll(re)) {
    map.set(match[1], match[2]);
  }
  return map;
}

function addedColumns(sql: string): string[] {
  return [...sql.matchAll(/add column if not exists\s+([a-z_]+)/gi)].map(
    (m) => m[1],
  );
}

describe("Phase 5A-1 operational schema contract", () => {
  const foundation = readMigration(FOUNDATION_MIGRATION_FILE);
  const enumAdapt = readMigration(ENUM_ADAPT_MIGRATION_FILE);
  const identity = readMigration(IDENTITY_MIGRATION_FILE);
  const operational = readMigration(OPERATIONAL_MIGRATION_FILE);
  const sql = `${foundation}\n${enumAdapt}\n${identity}\n${operational}`;
  const tables = createTableBodies(sql);
  const alters = addedColumns(operational);

  it("does not rewrite the Phase 3B foundation migration file", () => {
    expect(foundation).toContain("create table if not exists public.customers");
    expect(foundation).toContain("create table if not exists public.appointments");
    expect(enumAdapt).not.toMatch(/drop table/i);
    expect(operational).not.toMatch(/drop table/i);
    expect(operational).not.toMatch(/\btruncate\s+table\b/i);
    expect(operational).not.toMatch(/\bdelete\s+from\b/i);
    const integrity = readMigration(APPOINTMENT_INTEGRITY_MIGRATION_FILE);
    expect(integrity).not.toMatch(/drop table/i);
    expect(integrity).not.toMatch(/\btruncate\s+table\b/i);
    expect(integrity).toContain("appointments_customer_same_org_fkey");
    const settlement = readMigration(COMMERCE_REMOTE_SETTLEMENT_MIGRATION_FILE);
    expect(settlement).not.toMatch(/drop table/i);
    expect(settlement).not.toMatch(/\btruncate\s+table\b/i);
    expect(settlement).toMatch(/settle_checkout_draft/);
    const strategyB = readMigration(STRATEGY_B_RLS_MIGRATION_FILE);
    expect(strategyB).not.toMatch(/drop table/i);
    expect(strategyB).not.toMatch(/\btruncate\s+table\b/i);
    expect(strategyB).not.toMatch(/\bdelete\s+from\b/i);
    expect(strategyB).toContain("create or replace function public.current_organization_id()");
    const tableWrite = readMigration(COMMERCE_TABLE_WRITE_HARDENING_MIGRATION_FILE);
    expect(tableWrite).not.toMatch(/drop table/i);
    expect(tableWrite).not.toMatch(/\btruncate\s+table\b/i);
    expect(tableWrite).toMatch(/revoke all on public\.checkout_drafts/);
    expect(tableWrite).toMatch(/grant select on public\.transactions/);
  });

  it("creates every operational table named in the contract", () => {
    for (const name of OPERATIONAL_TABLES) {
      const created =
        tables.has(name) ||
        foundation.includes(`create table if not exists public.${name}`);
      expect(created, name).toBe(true);
    }
  });

  it("never stores a second remaining / balance / is_paid column", () => {
    const columnNames = [
      ...tables.values().flatMap((body) =>
        [...body.matchAll(/^\s+([a-z_]+)\s+/gim)].map((m) => m[1]),
      ),
      ...alters,
    ];
    for (const forbidden of FORBIDDEN_STORED_COLUMNS) {
      expect(columnNames, forbidden).not.toContain(forbidden);
    }
    expect(tables.get("customer_packages")).not.toMatch(/\bremaining\b/);
    expect(tables.get("stored_value_accounts")).not.toMatch(/\bbalance\b/);
  });

  it("keeps package and stored-value SoT as ledger SUM views", () => {
    expect(SOURCE_OF_TRUTH.packageBalance).toContain("SUM(package_ledger_entries.session_delta)");
    expect(SOURCE_OF_TRUTH.storedValueBalance).toContain(
      "SUM(stored_value_ledger_entries.amount_delta_minor)",
    );
    expect(operational).toContain("create or replace view public.package_ledger_balances");
    expect(operational).toContain("security_invoker = true");
    expect(operational).toContain("sum(session_delta)");
    expect(operational).toContain("create or replace view public.stored_value_ledger_balances");
    expect(operational).toContain("sum(amount_delta_minor)");
    expect(SOURCE_OF_TRUTH.checkoutIntent).toMatch(/OPEN is not settlement/);
  });

  it("uses integer minor-unit money columns", () => {
    const moneyTables = [
      "checkout_drafts",
      "checkout_items",
      "checkout_payments",
      "transactions",
      "transaction_items",
      "transaction_payments",
      "package_definitions",
      "customer_packages",
      "stored_value_ledger_entries",
      "products",
    ];
    for (const name of moneyTables) {
      const body = tables.get(name) ?? "";
      expect(body, name).toMatch(/_minor bigint/);
      expect(body, name).not.toMatch(/numeric\s*\(/i);
      expect(body, name).not.toMatch(/\bdouble precision\b/i);
      expect(body, name).not.toMatch(/\breal\b/i);
    }
    expect(operational).toContain("add column if not exists price_minor bigint");
  });

  it("scopes operational tables by organization_id", () => {
    const skip = new Set(["staff_auth_membership_locations", "profiles", "organizations"]);
    for (const name of OPERATIONAL_TABLES) {
      if (skip.has(name)) continue;
      const body = tables.get(name);
      if (!body) continue;
      expect(body, name).toContain("organization_id");
    }
    expect(tables.get("locations")).toContain("organization_id");
    expect(tables.get("package_ledger_entries")).toContain("organization_id");
    expect(tables.get("stored_value_ledger_entries")).toContain("organization_id");
  });

  it("does not location-scope package or stored-value balances", () => {
    expect(tables.get("customer_packages")).not.toMatch(/location_id/);
    expect(tables.get("stored_value_accounts")).not.toMatch(/location_id/);
    expect(tables.get("package_ledger_entries")).toMatch(/location_id uuid references/);
    expect(tables.get("stored_value_ledger_entries")).toMatch(/location_id uuid references/);
  });

  it("enforces unique effect_key per organization on ledgers", () => {
    for (const index of LEDGER_EFFECT_KEY_INDEXES) {
      expect(operational).toContain(index);
    }
    expect(operational).toMatch(
      /idx_package_ledger_org_effect_key[\s\S]*organization_id, effect_key/,
    );
    expect(operational).toMatch(
      /idx_stored_value_ledger_org_effect_key[\s\S]*organization_id, effect_key/,
    );
  });

  it("keeps checkout drafts mutable and transaction snapshots append-only", () => {
    expect(tables.has("checkout_drafts")).toBe(true);
    expect(tables.has("transactions")).toBe(true);
    expect(tables.get("checkout_drafts")).toContain("checkout_draft_status");
    expect(tables.get("transactions")).toContain("transaction_status");
    expect(operational).toContain("trg_transaction_items_immutable");
    expect(operational).toContain("trg_transactions_settlement_guard");
    expect(operational).toContain("guard_transaction_settlement_update");
    expect(operational).toContain("trg_package_ledger_immutable");
    expect(operational).toContain("trg_stored_value_ledger_immutable");
    expect(operational).toContain("reject_ledger_mutation");
  });

  it("preserves customer package snapshots without a remaining field", () => {
    const body = tables.get("customer_packages") ?? "";
    for (const col of [
      "name_snapshot",
      "session_count_snapshot",
      "price_snapshot_minor",
      "included_service_ids_snapshot",
      "purchased_at",
      "expires_at",
      "purchase_transaction_id",
    ]) {
      expect(body).toContain(col);
    }
  });

  it("restricts delete of customers/services from settlement history", () => {
    expect(tables.get("transactions")).toMatch(
      /customer_id uuid not null references public\.customers \(id\) on delete restrict/,
    );
    expect(tables.get("package_ledger_entries")).toMatch(
      /customer_id uuid not null references public\.customers \(id\) on delete restrict/,
    );
    expect(tables.get("stored_value_ledger_entries")).toMatch(
      /customer_id uuid not null references public\.customers \(id\) on delete restrict/,
    );
    expect(tables.get("transaction_items")).toMatch(
      /transaction_id uuid not null references public\.transactions \(id\) on delete restrict/,
    );
  });

  it("adapts staff_role instead of creating a second role enum", () => {
    expect(enumAdapt).toContain("alter type public.staff_role add value if not exists 'STAFF'");
    expect(enumAdapt).toContain("alter type public.staff_role add value if not exists 'ACCOUNTANT'");
    expect(operational).not.toMatch(/create type public\.staff_role/);
    expect(STAFF_ROLE_ADAPT.alias.THERAPIST).toBe("STAFF");
    expect(tables.get("staff_auth_memberships")).toContain("user_id text not null");
    expect(tables.get("staff_auth_memberships")).toContain("auth_user_id uuid");
    expect(operational).not.toMatch(/create table if not exists public\.staff_memberships/);
    expect(identity).not.toMatch(/create table if not exists public\.staff_memberships/);
  });

  it("uses membership helpers so RLS does not trust client organization_id", () => {
    expect(operational).toContain("user_has_org_membership");
    expect(operational).toContain("user_org_role");
    expect(operational).toContain("auth.uid()");
    expect(operational).toContain("enable row level security");
    expect(operational).toMatch(/m\.auth_user_id = auth\.uid\(\)/);
    expect(operational).not.toMatch(/m\.user_id = auth\.uid\(\)/);
    expect(operational).toContain("from public.staff_auth_memberships m");
  });

  it("stores operational staff columns as text staff-* rather than profiles uuid", () => {
    expect(operational).toMatch(/alter column staff_id type text/);
    expect(operational).toContain("created_by_staff_id text not null");
    expect(operational).toContain("assigned_staff_id text");
    expect(operational).not.toMatch(/created_by_staff_id uuid not null references public\.profiles/);
    expect(operational).not.toMatch(/staff_id uuid references public\.profiles/);
  });
});
