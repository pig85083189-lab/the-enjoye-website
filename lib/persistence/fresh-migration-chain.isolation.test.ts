import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIT_LOGS_ACTOR_BRIDGE_MIGRATION_FILE,
  COMMERCE_REMOTE_SETTLEMENT_MIGRATION_FILE,
  COMMERCE_TABLE_WRITE_HARDENING_MIGRATION_FILE,
  ENUM_ADAPT_MIGRATION_FILE,
  FOUNDATION_MIGRATION_FILE,
  IDENTITY_MIGRATION_FILE,
  OPERATIONAL_MIGRATION_FILE,
  STRATEGY_B_RLS_MIGRATION_FILE,
} from "./schema-contract";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

const PUBLISHED_UNCHANGED = [
  FOUNDATION_MIGRATION_FILE,
  ENUM_ADAPT_MIGRATION_FILE,
  IDENTITY_MIGRATION_FILE,
] as const;

const EXPECTED_CHAIN = [
  "20260918120000_beauty_os_foundation.sql",
  "20260928112900_beauty_os_enum_adapt.sql",
  "20260928112950_staff_auth_memberships.sql",
  "20260928112975_audit_logs_actor_operational_bridge.sql",
  "20260928113000_beauty_os_operational_foundation.sql",
  "20261002120000_appointment_tenant_integrity.sql",
  "20261003120000_appointment_staff_overlap_exclusion.sql",
  "20261004120000_treatment_remote_foundation.sql",
  "20261005120000_commerce_remote_settlement.sql",
  "20261006120000_strategy_b_rls_qualification.sql",
  "20261006130000_commerce_table_write_hardening.sql",
  "20261007120000_finance_expense_foundation.sql",
  "20261007130000_finance_expense_write_hardening.sql",
  "20261007140000_staff_operational_create.sql",
  "20261007150000_staff_operational_create_fix.sql",
  "20261008120000_staff_login_invite_foundation.sql",
  "20261008130000_staff_login_invite_create.sql",
  "20261010120000_line_official_account_foundation.sql",
  "20261010140000_line_broadcast_real_send.sql",
  "20261010160000_line_owner_test_push.sql",
] as const;

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("Phase 1C-6H.2P2A fresh migration chain", () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const bridge = read(AUDIT_LOGS_ACTOR_BRIDGE_MIGRATION_FILE);
  const foundation = read(FOUNDATION_MIGRATION_FILE);
  const operational = read(OPERATIONAL_MIGRATION_FILE);

  it("keeps the full timestamp order including the pre-113000 bridge", () => {
    expect(files).toEqual([...EXPECTED_CHAIN]);
    expect(files).not.toContain("20261009140000_staff_invite_canary_send_claim.sql");
    expect(AUDIT_LOGS_ACTOR_BRIDGE_MIGRATION_FILE).toContain("20260928112975");
    expect(AUDIT_LOGS_ACTOR_BRIDGE_MIGRATION_FILE > IDENTITY_MIGRATION_FILE).toBe(
      true,
    );
    expect(AUDIT_LOGS_ACTOR_BRIDGE_MIGRATION_FILE < OPERATIONAL_MIGRATION_FILE).toBe(
      true,
    );
  });

  it("does not rewrite published migrations", () => {
    for (const rel of PUBLISHED_UNCHANGED) {
      const main = execSync(`git show origin/main:${rel}`, { encoding: "utf8" });
      expect(read(rel), rel).toBe(main);
    }
  });

  it("only drops the blocking foundation insert policy while actor_id is uuid", () => {
    expect(foundation).toMatch(/actor_id uuid references public\.profiles/);
    expect(foundation).toMatch(
      /actor_id is null or actor_id = auth\.uid\(\)/,
    );
    expect(operational).toMatch(/alter column actor_id type text/);
    expect(operational).toMatch(
      /drop policy if exists audit_logs_insert_org on public\.audit_logs/,
    );
    const executable = bridge.slice(bridge.indexOf("do $$"));
    expect(executable).toMatch(/data_type = 'uuid'/);
    expect(executable).toMatch(/drop policy if exists audit_logs_insert_org/);
    expect(executable).toMatch(/create aggregate public\.min\(uuid\)/);
    expect(executable).not.toMatch(/alter column actor_id type/i);
    expect(executable).not.toMatch(/alter table public\.audit_logs/i);
    expect(executable).not.toMatch(/create policy/i);
    expect(executable).not.toMatch(/create table/i);
    expect(executable).not.toMatch(/create or replace function public\.current_organization_id/);
    expect(executable).not.toMatch(/drop policy if exists audit_logs_select_managers/);
    expect(executable).not.toMatch(/drop table/i);
    expect(executable).not.toMatch(/\btruncate\s+table\b/i);
    expect(executable).not.toMatch(/\binsert into\b/i);
    expect(bridge).not.toMatch(/TX-20261005-0001/);
  });

  it("leaves Strategy B qualification and commerce hardening after 113000", () => {
    expect(STRATEGY_B_RLS_MIGRATION_FILE > OPERATIONAL_MIGRATION_FILE).toBe(true);
    expect(
      COMMERCE_TABLE_WRITE_HARDENING_MIGRATION_FILE >
        COMMERCE_REMOTE_SETTLEMENT_MIGRATION_FILE,
    ).toBe(true);
    const strategyB = read(STRATEGY_B_RLS_MIGRATION_FILE);
    expect(strategyB).toMatch(/m\.user_id = audit_logs\.actor_id/);
    expect(strategyB).not.toMatch(/actor_id = auth\.uid\(\)/);
  });
});
