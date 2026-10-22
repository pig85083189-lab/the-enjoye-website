// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_GRANT_PERSIST_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import {
  CLAIM_LINE_DELIVERY_TASK_RPC,
  COMPLETE_LINE_DELIVERY_TASK_RPC,
  ENQUEUE_LINE_DELIVERY_TASK_RPC,
  LINE_DELIVERY_BROADCAST_ELIGIBLE_RPC,
  LINE_DELIVERY_DB_NEVER_RESEND_STATUSES,
  LINE_DELIVERY_DB_STATUSES,
} from "@/lib/line/delivery/delivery-store";
import { LINE_BROADCAST_SEND_OPEN, LINE_TEST_PUSH_OPEN } from "@/lib/line/line-flag";
import { LINE_DELIVERY_TASKS_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

const ROOT = process.cwd();
const RUNNER = "scripts/line-delivery-tasks-local-pg.sh";

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function executableSql(rel: string): string {
  return source(rel)
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("Phase 3B LINE delivery task ledger", () => {
  it("keeps send gates closed and stores tasks without LINE credentials", () => {
    expect(LINE_AUTOMATION_SEND_OPEN).toBe(false);
    expect(LINE_OWNER_SELF_PUSH_OPEN).toBe(false);
    expect(LINE_AUTOMATION_KILL_SWITCH).toBe(false);
    expect(LINE_OWNER_SELF_GRANT_PERSIST_OPEN).toBe(false);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_TEST_PUSH_OPEN).toBe(false);
    expect(ENQUEUE_LINE_DELIVERY_TASK_RPC).toBe("enqueue_line_delivery_task");
    expect(CLAIM_LINE_DELIVERY_TASK_RPC).toBe("claim_line_delivery_task");
    expect(COMPLETE_LINE_DELIVERY_TASK_RPC).toBe("complete_line_delivery_task");
    expect(LINE_DELIVERY_BROADCAST_ELIGIBLE_RPC).toBe("line_delivery_broadcast_eligible");
    expect(LINE_DELIVERY_DB_STATUSES).toEqual([
      "planned",
      "claimed",
      "blocked",
      "accepted",
      "failed",
      "pending_confirmation",
    ]);
    expect(LINE_DELIVERY_DB_NEVER_RESEND_STATUSES).toEqual([
      "claimed",
      "accepted",
      "pending_confirmation",
    ]);

    const sql = executableSql(LINE_DELIVERY_TASKS_MIGRATION_FILE);
    expect(sql).toMatch(/unique index if not exists line_delivery_tasks_delivery_key_key/);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/for update/i);
    expect(sql).toMatch(/line_automation_send_recipient_allowed/);
    expect(sql).toMatch(/line_delivery_broadcast_eligible/);
    expect(sql).toMatch(/pending_confirmation/);
    expect(sql).toMatch(/line_delivery_tasks_no_line_user_id/);
    expect(sql).not.toMatch(/create or replace function public\.claim_line_broadcast_send/);
    expect(sql).not.toMatch(/alter table public\.line_broadcasts/);
    expect(sql).not.toMatch(/https:\/\/api\.line\.me|pg_cron|cron\.schedule/);
    expect(sql).not.toMatch(/line_user_id text|channel_access_token|channel_secret/);
    expect(sql).not.toMatch(/LINE_AUTOMATION_SEND_OPEN = true|LINE_BROADCAST_SEND_OPEN = true/);

    const eligible = sql.slice(
      sql.indexOf("create or replace function public.line_delivery_broadcast_eligible"),
      sql.indexOf("create or replace function public.enqueue_line_delivery_task"),
    );
    expect(eligible).not.toMatch(/line_automation_send_recipient_allowed/);
    expect(eligible).toMatch(/broadcast_enabled/);
    expect(eligible).toMatch(/line_broadcast_consumed_on_taipei_day|line_broadcasts/);
  });

  it("keeps the local Postgres delivery fixtures off Preview and Production", () => {
    const runner = source(RUNNER);
    expect(runner).toMatch(/unix socket/);
    expect(runner).toMatch(/beauty_os_line_delivery_tasks_local/);
    expect(runner).toMatch(/20261021120000_line_delivery_tasks\.sql/);
    expect(runner).toMatch(/20261021130000_line_delivery_worker\.sql/);
    expect(runner).toMatch(/20261021140000_line_delivery_broadcast_quota_unify\.sql/);
    expect(runner).toMatch(/REFUSE/);
    expect(runner).toMatch(/duplicate delivery_key was accepted/);
    expect(runner).toMatch(/concurrent claim left claimed=/);
    expect(runner).toMatch(/accepted task was claimed again/);
    expect(runner).toMatch(/claimed task was resent after restart/);
    expect(runner).toMatch(/timeout did not become pending_confirmation/);
    expect(runner).toMatch(/unknown 5xx did not become pending_confirmation/);
    expect(runner).toMatch(/unbound customer was still claimed/);
    expect(runner).toMatch(/cross-org claim/);
    expect(runner).not.toMatch(/bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/);
    expect(source("supabase/tests/line-delivery-tasks.local-stub.sql")).not.toMatch(
      /api\.line\.me|channel_secret|SUPABASE_SERVICE_ROLE_KEY/,
    );
  });
});
