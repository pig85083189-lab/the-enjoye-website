// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_CUSTOMER_BINDINGS_PREVIEW_UPGRADE_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

const ROOT = process.cwd();

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function executableSql(rel: string): string {
  return source(rel)
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("Preview leftover LINE customer binding upgrade", () => {
  it("upgrades the leftover Preview bind shape without dropping rows or trusting old verified", () => {
    const sql = source(LINE_CUSTOMER_BINDINGS_PREVIEW_UPGRADE_MIGRATION_FILE);
    const executable = executableSql(LINE_CUSTOMER_BINDINGS_PREVIEW_UPGRADE_MIGRATION_FILE);
    const runner = source("scripts/line-customer-bindings-preview-upgrade-local-pg.sh");
    const stub = source("supabase/tests/line-customer-bindings-preview-upgrade.local-stub.sql");
    const cases = source("supabase/tests/line-customer-bindings-preview-upgrade.local-cases.sql");

    expect(LINE_CUSTOMER_BINDINGS_PREVIEW_UPGRADE_MIGRATION_FILE).toContain("20261017161000");
    expect(sql).toMatch(/Does not DROP TABLE, DROP COLUMN, TRUNCATE/);
    expect(sql).toMatch(/add column id text/);
    expect(sql).toMatch(/add column customer_id text/);
    expect(sql).toMatch(/set customer_id = customer_app_id/);
    expect(sql).toMatch(/lcb-' \|\| substr\(md5\(organization_id \|\| ':' \|\| customer_id\)/);
    expect(sql).toMatch(/id like 'lcbc-%' or id like 'lcc-%'/);
    expect(sql).toMatch(/Does not drop the leftover/);
    expect(sql).toMatch(/line_customer_binding_secrets/);
    expect(sql).toMatch(/line_customer_binding_rebinds/);
    expect(sql).toMatch(/identity_confirmed_at/);
    expect(sql).toMatch(/consumed_event_id/);
    expect(sql).toMatch(/consumed_proof_hash/);
    expect(sql).toMatch(/where verified is true\s+and confirmed_at is null/);
    expect(sql).toMatch(/captured_at is not null/);
    expect(sql).toMatch(/confirm_line_customer_binding/);
    expect(sql).toMatch(/unbind_line_customer_binding/);
    expect(sql).toMatch(/p_customer_app_id/);
    expect(sql).toMatch(/drop function if exists public\.%I\(%s\)/);
    expect(sql).toMatch(/refusing DROP CASCADE/);
    expect(sql).toMatch(/text, text, text, text, text, text, text/);
    expect(sql).toMatch(/line_automation_schedule_recipient_ready/);
    expect(sql).toMatch(/Do not apply on Production until Owner confirms/);
    expect(executable).not.toMatch(/drop table public\.line_customer_bindings/i);
    expect(executable).not.toMatch(/drop table public\.line_customer_bind_challenges/i);
    expect(executable).not.toMatch(/drop table public\.line_automation_jobs/i);
    expect(executable).not.toMatch(/drop table public\.line_automation_rules/i);
    expect(executable).not.toMatch(/\bdrop column\b/i);
    expect(executable).not.toMatch(/\btruncate\s+table\b/i);
    expect(executable).not.toMatch(/delete from public\.line_customer_bindings/i);
    expect(executable).not.toMatch(/delete from public\.line_automation_jobs/i);
    expect(executable).not.toMatch(/delete from public\.line_automation_rules/i);
    expect(executable).not.toMatch(/create or replace function public\.upsert_line_appointment_reminder_rule/i);
    expect(executable).not.toMatch(/create or replace function public\.read_line_appointment_reminder_workspace/i);
    expect(executable).not.toMatch(/create or replace function public\.sync_line_appointment_reminder_jobs/i);
    expect(executable).not.toMatch(/create or replace function public\.apply_line_automation_schedule/i);
    expect(executable).not.toMatch(/drop function[^;]*cascade/i);
    expect(executable).not.toMatch(/api\.line\.me|pg_cron|cron\.schedule/);
    expect(executable).not.toMatch(/alter table public\.line_broadcasts/);

    expect(runner).toMatch(/unix socket/);
    expect(runner).toMatch(/beauty_os_line_bindings_preview_upgrade_local/);
    expect(runner).toMatch(/REFUSE/);
    expect(runner).toMatch(/20261017161000_line_customer_bindings_preview_upgrade\.sql/);
    expect(runner).not.toMatch(/20261017160000_line_customer_bindings\.sql/);
    expect(runner).not.toMatch(/bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/);

    expect(stub).toMatch(/primary key \(organization_id, customer_app_id\)/);
    expect(stub).toMatch(/customer_app_id text not null/);
    expect(stub).toMatch(/line_user_id_cipher text not null/);
    expect(stub).toMatch(/id like 'lcc-%'/);
    expect(stub).toMatch(/org-beauty-os-test/);
    expect(stub).toMatch(/cust-2d2-fake-bound/);
    expect(stub).toMatch(/v1\.cipher-preview-legacy/);
    expect(stub).toMatch(/start_line_customer_bind_challenge\(/);
    expect(stub).toMatch(/p_customer_app_id text/);
    expect(stub).toMatch(/unbind_line_customer_binding\(/);
    expect(stub).toMatch(/confirm_line_customer_binding\(/);
    expect(stub).toMatch(/consume_line_customer_bind_challenge_public\(/);
    expect(stub).toMatch(/upsert_line_appointment_reminder_rule/);
    expect(executableSql("supabase/tests/line-customer-bindings-preview-upgrade.local-stub.sql")).not.toMatch(/identity_confirmed_at/);
    expect(executableSql("supabase/tests/line-customer-bindings-preview-upgrade.local-stub.sql")).not.toMatch(/line_customer_binding_secrets/);
    expect(stub).not.toMatch(/api\.line\.me|channel_secret|SUPABASE_SERVICE_ROLE_KEY/);

    expect(cases).toMatch(/upgrade changed binding count/);
    expect(cases).toMatch(/upgrade changed challenge count/);
    expect(cases).toMatch(/upgrade changed job count/);
    expect(cases).toMatch(/upgrade changed rule count/);
    expect(cases).toMatch(/legacy verified row was treated as a new trusted recipient/);
    expect(cases).toMatch(/legacy verified row became recipient_ready without new verification/);
    expect(cases).toMatch(/legacy pending row was confirmed without a new capture/);
    expect(cases).toMatch(/first bind start after upgrade failed/);
    expect(cases).toMatch(/upgraded function kept leftover parameter names/);
    expect(cases).toMatch(/legacy 2-arg start RPC is still present/);
    expect(cases).toMatch(/legacy 7-arg consume RPC is still present/);
    expect(cases).toMatch(/bind RPCs still have view or table catalog dependents/);
    expect(cases).toMatch(/upgraded unbind failed/);
    expect(cases).toMatch(/rebind consume did not stage a replacement/);
    expect(cases).toMatch(/rebind cancel left a staged identity/);
    expect(cases).toMatch(/cross-org customer bind was accepted/);
    expect(cases).toMatch(/Phase 2B reminder read lost the leftover rule/);
    expect(cases).toMatch(/Phase 2A apply_line_automation_schedule is missing after bind upgrade/);
  });
});
