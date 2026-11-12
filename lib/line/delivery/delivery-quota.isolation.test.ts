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
  LINE_BROADCAST_CONSUMED_ON_TAIPEI_DAY_RPC,
  LINE_DELIVERY_BROADCAST_QUOTA_USED_RPC,
  LINE_DELIVERY_QUOTA_COUNTS_OFFICIAL_BROADCASTS,
  LINE_OFFICIAL_BROADCAST_CONSUMED_COUNTS_DELIVERY_TASKS,
} from "@/lib/line/delivery/delivery-store";
import { LINE_BROADCAST_DAILY_LIMIT, LINE_BROADCAST_SEND_OPEN, LINE_TEST_PUSH_OPEN } from "@/lib/line/line-flag";
import {
  LINE_BROADCAST_CLAIM_SAFETY_MIGRATION_FILE,
  LINE_BROADCAST_CHANNEL_LOCK_MIGRATION_FILE,
  LINE_DELIVERY_TASKS_MIGRATION_FILE,
  LINE_DELIVERY_WORKER_MIGRATION_FILE,
  LINE_DELIVERY_BROADCAST_QUOTA_UNIFY_MIGRATION_FILE,
} from "@/lib/persistence/schema-contract";

const ROOT = process.cwd();
const RUNNER = "scripts/line-delivery-quota-cross-flow-local-pg.sh";
const OFFICIAL_CLAIM = "supabase/migrations/20261012120000_line_broadcast_channel_lock.sql";

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function executableSql(rel: string): string {
  return source(rel)
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("Phase 3D LINE delivery cross-flow quota", () => {
  it("keeps official Broadcast send closed and does not rewrite its claim", () => {
    expect(LINE_AUTOMATION_SEND_OPEN).toBe(false);
    expect(LINE_OWNER_SELF_PUSH_OPEN).toBe(false);
    expect(LINE_AUTOMATION_KILL_SWITCH).toBe(false);
    expect(LINE_OWNER_SELF_GRANT_PERSIST_OPEN).toBe(false);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_TEST_PUSH_OPEN).toBe(false);
    expect(LINE_BROADCAST_DAILY_LIMIT).toBe(3);
    expect(LINE_DELIVERY_QUOTA_COUNTS_OFFICIAL_BROADCASTS).toBe(true);
    expect(LINE_OFFICIAL_BROADCAST_CONSUMED_COUNTS_DELIVERY_TASKS).toBe(true);
    expect(LINE_DELIVERY_BROADCAST_QUOTA_USED_RPC).toBe("line_delivery_broadcast_quota_used");
    expect(LINE_BROADCAST_CONSUMED_ON_TAIPEI_DAY_RPC).toBe("line_broadcast_consumed_on_taipei_day");

    const officialConsumed = executableSql(LINE_BROADCAST_CLAIM_SAFETY_MIGRATION_FILE);
    const officialClaim = executableSql(LINE_BROADCAST_CHANNEL_LOCK_MIGRATION_FILE);
    const delivery = executableSql(LINE_DELIVERY_WORKER_MIGRATION_FILE);
    const ledger = executableSql(LINE_DELIVERY_TASKS_MIGRATION_FILE);

    expect(officialConsumed).toMatch(/create or replace function public\.line_broadcast_consumed_on_taipei_day/);
    expect(officialConsumed).not.toMatch(/line_delivery_tasks/);
    expect(officialClaim).toMatch(/line_broadcast_consumed_on_taipei_day/);
    expect(officialClaim).not.toMatch(/line_delivery_tasks/);
    expect(delivery).toMatch(/line_broadcast_consumed_on_taipei_day|line_broadcasts/);
    expect(delivery).toMatch(/status in \('claimed', 'accepted', 'pending_confirmation'\)/);
    expect(delivery).not.toMatch(/create or replace function public\.claim_line_broadcast_send/);
    expect(delivery).not.toMatch(/alter table public\.line_broadcasts/);
    expect(ledger).not.toMatch(/create or replace function public\.claim_line_broadcast_send/);
    expect(source(OFFICIAL_CLAIM)).toMatch(/claim_line_broadcast_send/);
    expect(LINE_DELIVERY_BROADCAST_QUOTA_UNIFY_MIGRATION_FILE).toContain("20261021140000");
  });

  it("keeps the cross-flow runner off Preview, Production, and official send", () => {
    const runner = source(RUNNER);
    expect(runner).toMatch(/unix socket/);
    expect(runner).toMatch(/beauty_os_line_delivery_quota_local/);
    expect(runner).toMatch(/20261021130000_line_delivery_worker\.sql/);
    expect(runner).toMatch(/Never calls claim_line_broadcast_send/);
    expect(runner).toMatch(/yesterday official\/delivery still counted today/);
    expect(runner).toMatch(/failed delivery still consumed quota/);
    expect(runner).toMatch(/timeout did not keep pending_confirmation/);
    expect(runner).toMatch(/blocked delivery consumed quota/);
    expect(runner).toMatch(/official consumed counted delivery tasks/);
    expect(runner).toMatch(/cross-flow quota mismatch/);
    expect(runner).toMatch(/official cap of 3 still allowed a delivery claim/);
    expect(runner).not.toMatch(/claim_line_broadcast_send\(/);
    expect(runner).not.toMatch(/bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/);
    expect(runner).not.toMatch(/LINE_BROADCAST_SEND_OPEN = true|pg_cron|cron\.schedule/);
  });
});
