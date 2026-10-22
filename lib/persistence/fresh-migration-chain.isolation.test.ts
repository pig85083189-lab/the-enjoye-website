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
  LINE_AUTOMATION_RULES_MIGRATION_FILE,
  LINE_AUTOMATION_SCHEDULE_MIGRATION_FILE,
  LINE_CUSTOMER_BINDINGS_MIGRATION_FILE,
  LINE_CUSTOMER_BINDINGS_PREVIEW_UPGRADE_MIGRATION_FILE,
  LINE_DELIVERY_TASKS_MIGRATION_FILE,
  LINE_DELIVERY_WORKER_MIGRATION_FILE,
  LINE_DELIVERY_BROADCAST_QUOTA_UNIFY_MIGRATION_FILE,
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
  "20261010180000_line_webhook_least_privilege.sql",
  "20261010190000_line_test_push_claim_daily_quota.sql",
  "20261010200000_line_test_push_error_diagnostics.sql",
  "20261011010000_line_test_push_runtime_kill_switch.sql",
  "20261011020000_line_broadcast_claim_safety.sql",
  "20261011140000_line_broadcast_oneshot_permit.sql",
  "20261012120000_line_broadcast_channel_lock.sql",
  "20261017120000_line_automation_rules.sql",
  "20261017140000_line_automation_schedule_engine.sql",
  "20261017160000_line_customer_bindings.sql",
  "20261017161000_line_customer_bindings_preview_upgrade.sql",
  "20261021120000_line_delivery_tasks.sql",
  "20261021130000_line_delivery_worker.sql",
  "20261021140000_line_delivery_broadcast_quota_unify.sql",
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

  it("upgrades Preview line_automation_rules instead of replacing the Phase 2B table", () => {
    const rules = read(LINE_AUTOMATION_RULES_MIGRATION_FILE);
    const executable = rules
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(LINE_AUTOMATION_RULES_MIGRATION_FILE).toContain("20261017120000");
    expect(rules).toMatch(/create table if not exists public\.line_automation_rules/);
    expect(rules).toMatch(/add column automation_type text/);
    expect(rules).toMatch(/add column timing_config jsonb/);
    expect(rules).toMatch(/where automation_type is null/);
    expect(rules).toMatch(/unique \(organization_id, automation_type\)/);
    expect(rules).toMatch(/Fail the migration immediately if either unique cannot be created/);
    expect(executable).not.toMatch(/exception when others then null/i);
    expect(executable).not.toMatch(/drop table public\.line_automation_rules/i);
    expect(executable).not.toMatch(/\bdrop column\b/i);
    expect(executable).not.toMatch(/\btruncate\s+table\b/i);
    expect(executable).not.toMatch(/delete from public\.line_automation_rules/i);
    expect(executable).not.toMatch(/create or replace function public\.upsert_line_appointment_reminder_rule/i);
  });

  it("extends line_automation_jobs instead of creating a parallel schedule table", () => {
    const sql = read(LINE_AUTOMATION_SCHEDULE_MIGRATION_FILE);
    const executable = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(LINE_AUTOMATION_SCHEDULE_MIGRATION_FILE).toContain("20261017140000");
    expect(sql).toMatch(/create table if not exists public\.line_automation_jobs/);
    expect(sql).toMatch(/add column automation_type text/);
    expect(sql).toMatch(/add column event_id text/);
    expect(sql).toMatch(/add column message_snapshot text/);
    expect(sql).toMatch(/line_automation_jobs_active_fingerprint_key/);
    expect(sql).toMatch(/apply_line_automation_schedule/);
    expect(sql).toMatch(/line_automation_schedule_validate_item/);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/pending_recipient/);
    expect(sql).toMatch(/Do not apply on Production until Owner confirms/);
    expect(executable).not.toMatch(/drop table public\.line_automation_jobs/i);
    expect(executable).not.toMatch(/\bdrop column\b/i);
    expect(executable).not.toMatch(/\btruncate\s+table\b/i);
    expect(executable).not.toMatch(/delete from public\.line_automation_jobs/i);
    expect(executable).not.toMatch(/api\.line\.me|cron|pg_cron/i);
    expect(executable).not.toMatch(/create or replace function public\.sync_line_appointment_reminder_jobs/i);
  });

  it("adds trusted LINE customer bindings without rewriting jobs or Broadcast", () => {
    const sql = read(LINE_CUSTOMER_BINDINGS_MIGRATION_FILE);
    const executable = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(LINE_CUSTOMER_BINDINGS_MIGRATION_FILE).toContain("20261017160000");
    expect(sql).toMatch(/create table if not exists public\.line_customer_bindings/);
    expect(sql).toMatch(/create table if not exists public\.line_customer_binding_secrets/);
    expect(sql).toMatch(/create table if not exists public\.line_customer_bind_challenges/);
    expect(sql).toMatch(/create table if not exists public\.line_customer_bind_challenge_secrets/);
    expect(sql).toMatch(/create table if not exists public\.line_customer_binding_rebinds/);
    expect(sql).toMatch(/cancel_line_customer_rebind/);
    expect(sql).toMatch(/start_line_customer_bind_challenge/);
    expect(sql).toMatch(/consume_line_customer_bind_challenge_public/);
    expect(sql).toMatch(/confirm_line_customer_binding/);
    expect(sql).toMatch(/unbind_line_customer_binding/);
    expect(sql).toMatch(/read_line_customer_bindings/);
    expect(sql).toMatch(/line_automation_send_recipient_allowed/);
    expect(sql).toMatch(/line_automation_schedule_recipient_ready/);
    expect(sql).toMatch(/Do not apply on Production until Owner confirms/);
    expect(executable).not.toMatch(/drop table public\.line_automation_jobs/i);
    expect(executable).not.toMatch(/delete from public\.line_automation_jobs/i);
    expect(executable).not.toMatch(/alter table public\.line_broadcasts/i);
    expect(executable).not.toMatch(/api\.line\.me|cron|pg_cron/i);
    expect(executable).not.toMatch(/customers\.line_user_id/);
  });

  it("upgrades leftover Preview bind tables without dropping rows or trusting old verified", () => {
    const sql = read(LINE_CUSTOMER_BINDINGS_PREVIEW_UPGRADE_MIGRATION_FILE);
    const executable = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(LINE_CUSTOMER_BINDINGS_PREVIEW_UPGRADE_MIGRATION_FILE).toContain("20261017161000");
    expect(sql).toMatch(/add column id text/);
    expect(sql).toMatch(/add column customer_id text/);
    expect(sql).toMatch(/set customer_id = customer_app_id/);
    expect(sql).toMatch(/id like 'lcbc-%' or id like 'lcc-%'/);
    expect(sql).toMatch(/line_customer_binding_secrets/);
    expect(sql).toMatch(/where verified is true\s+and confirmed_at is null/);
    expect(sql).toMatch(/captured_at is not null/);
    expect(sql).toMatch(/identity_confirmed_at/);
    expect(sql).toMatch(/Do not apply on Production until Owner confirms/);
    expect(sql).toMatch(/line_customer_bindings_id_key unique \(id\)/);
    expect(sql).toMatch(/drop function if exists public\.%I\(%s\)/);
    expect(sql).toMatch(/refusing DROP CASCADE/);
    expect(sql).toMatch(/p_customer_app_id/);
    expect(executable).not.toMatch(/drop function[^;]*cascade/i);
    expect(executable).not.toMatch(/drop constraint(?: if exists)? line_customer_bindings_pkey/i);
    expect(executable).not.toMatch(/drop table public\.line_customer_bindings/i);
    expect(executable).not.toMatch(/drop table public\.line_customer_bind_challenges/i);
    expect(executable).not.toMatch(/drop table public\.line_automation_jobs/i);
    expect(executable).not.toMatch(/\bdrop column\b/i);
    expect(executable).not.toMatch(/\btruncate\s+table\b/i);
    expect(executable).not.toMatch(/delete from public\.line_customer_bindings/i);
    expect(executable).not.toMatch(/delete from public\.line_automation_jobs/i);
    expect(executable).not.toMatch(/create or replace function public\.upsert_line_appointment_reminder_rule/i);
    expect(executable).not.toMatch(/create or replace function public\.apply_line_automation_schedule/i);
    expect(executable).not.toMatch(/api\.line\.me|cron|pg_cron/i);
  });

  it("adds a shared delivery task ledger without rewriting Broadcast or jobs", () => {
    const sql = read(LINE_DELIVERY_TASKS_MIGRATION_FILE);
    const executable = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(LINE_DELIVERY_TASKS_MIGRATION_FILE).toContain("20261021120000");
    expect(sql).toMatch(/create table if not exists public\.line_delivery_tasks/);
    expect(sql).toMatch(/line_delivery_tasks_delivery_key_key/);
    expect(sql).toMatch(/enqueue_line_delivery_task/);
    expect(sql).toMatch(/claim_line_delivery_task/);
    expect(sql).toMatch(/complete_line_delivery_task/);
    expect(sql).toMatch(/line_automation_send_recipient_allowed/);
    expect(sql).toMatch(/line_delivery_broadcast_eligible/);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/for update/i);
    expect(sql).toMatch(/Do not apply on Production until Owner confirms/);
    expect(executable).not.toMatch(/alter table public\.line_broadcasts/i);
    expect(executable).not.toMatch(/create or replace function public\.claim_line_broadcast_send/i);
    expect(executable).not.toMatch(/drop table public\.line_automation_jobs/i);
    expect(executable).not.toMatch(/api\.line\.me|cron|pg_cron/i);
    expect(executable).not.toMatch(/line_user_id text/);
  });

  it("adds a mock delivery worker without rewriting Broadcast or jobs", () => {
    const sql = read(LINE_DELIVERY_WORKER_MIGRATION_FILE);
    const executable = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(LINE_DELIVERY_WORKER_MIGRATION_FILE).toContain("20261021130000");
    expect(sql).toMatch(/line_delivery_broadcast_quota_used/);
    expect(sql).toMatch(/claim_next_line_delivery_task/);
    expect(sql).toMatch(/read_line_delivery_tasks/);
    expect(sql).toMatch(/87210001/);
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(/mock_accepted/);
    expect(sql).toMatch(/Do not apply on Production until Owner confirms/);
    expect(executable).not.toMatch(/alter table public\.line_broadcasts/i);
    expect(executable).not.toMatch(/create or replace function public\.claim_line_broadcast_send/i);
    expect(executable).not.toMatch(/drop table public\.line_automation_jobs/i);
    expect(executable).not.toMatch(/api\.line\.me|cron|pg_cron/i);
    expect(executable).not.toMatch(/line_user_id text/);
  });

  it("unifies official and delivery Broadcast quota without opening send", () => {
    const sql = read(LINE_DELIVERY_BROADCAST_QUOTA_UNIFY_MIGRATION_FILE);
    const executable = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(LINE_DELIVERY_BROADCAST_QUOTA_UNIFY_MIGRATION_FILE).toContain("20261021140000");
    expect(sql).toMatch(/line_broadcast_shared_quota_used/);
    expect(sql).toMatch(/line_delivery_key_segment/);
    expect(sql).toMatch(/line_broadcast_take_shared_quota_locks/);
    expect(sql).toMatch(/87210001/);
    expect(sql).toMatch(/870121/);
    expect(sql).toMatch(/create or replace function public\.claim_line_broadcast_send/);
    expect(sql).toMatch(/line_broadcast_campaign_on_delivery_ledger/);
    expect(sql).toMatch(/Do not apply on Production until Owner confirms/);
    expect(executable).not.toMatch(/broadcast_formal_runtime_open\s*=\s*true/);
    expect(executable).not.toMatch(/alter table public\.line_broadcasts/i);
    expect(executable).not.toMatch(/drop table public\.line_automation_jobs/i);
    expect(executable).not.toMatch(/api\.line\.me|cron|pg_cron/i);
    expect(executable).not.toMatch(/line_user_id text/);
    expect(executable).not.toMatch(/grant execute on function public\.claim_line_broadcast_send[^;]+anon/);
  });
});
