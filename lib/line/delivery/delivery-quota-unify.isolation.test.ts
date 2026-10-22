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
import { LINE_DELIVERY_BROADCAST_QUOTA_UNIFY_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

const ROOT = process.cwd();
const RUNNER = "scripts/line-delivery-quota-unify-local-pg.sh";
const STUB = "supabase/tests/line-delivery-broadcast-quota-unify.local-stub.sql";

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function executableSql(rel: string): string {
  return source(rel)
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("Phase 3E LINE delivery Broadcast quota unify", () => {
  it("shares official and delivery campaign quota without opening send", () => {
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

    const sql = executableSql(LINE_DELIVERY_BROADCAST_QUOTA_UNIFY_MIGRATION_FILE);
    expect(sql).toMatch(/create or replace function public\.line_broadcast_shared_quota_used/);
    expect(sql).toMatch(/create or replace function public\.line_delivery_key_segment/);
    expect(sql).toMatch(/create or replace function public\.line_broadcast_take_shared_quota_locks/);
    expect(sql).toMatch(/create or replace function public\.claim_line_broadcast_send/);
    expect(sql).toMatch(/line_broadcast_campaign_on_delivery_ledger/);
    expect(sql).toMatch(/line_broadcast_campaign_on_official_ledger/);
    expect(sql).toMatch(/line_delivery_broadcast_claim_allowed/);
    expect(sql).toMatch(/pg_advisory_xact_lock\(870121/);
    expect(sql).toMatch(/pg_advisory_xact_lock\(87210001/);
    expect(sql).toMatch(/revoke all on function public\.line_broadcast_shared_quota_used\(text, timestamptz\)\s+from public, anon, authenticated/);
    expect(sql).not.toMatch(/broadcast_formal_runtime_open\s*=\s*true/);
    expect(sql).not.toMatch(/grant execute on function public\.claim_line_broadcast_send[^;]+anon/);
    expect(sql).not.toMatch(/https:\/\/api\.line\.me|pg_cron|cron\.schedule/);
    expect(sql).not.toMatch(/LINE_BROADCAST_SEND_OPEN = true|LINE_AUTOMATION_SEND_OPEN = true/);

    const claimSql = sql.slice(sql.lastIndexOf("create or replace function public.claim_line_broadcast_send"));
    expect(claimSql.indexOf("pg_advisory_xact_lock(870121")).toBeLessThan(
      claimSql.indexOf("line_broadcast_take_shared_quota_locks"),
    );
    expect(claimSql.indexOf("line_broadcast_campaign_on_delivery_ledger")).toBeLessThan(
      claimSql.indexOf("line_broadcast_channel_has_inflight(v_channel_id)"),
    );
    expect(claimSql).toMatch(/v_quota_confirmed boolean := false/);
    expect(claimSql).not.toMatch(/v_quota_confirmed := true/);
    expect(claimSql).toMatch(/Beauty OS TEST 只能使用一次性測試路徑/);
    expect(claimSql).toMatch(/正式群發執行開關已關閉/);
  });

  it("keeps the unify runner on the local unix socket and actually calls both claims", () => {
    const runner = source(RUNNER);
    const stub = source(STUB);
    expect(runner).toMatch(/unix socket/);
    expect(runner).toMatch(/beauty_os_line_delivery_quota_unify_local/);
    expect(runner).toMatch(/20261021140000_line_delivery_broadcast_quota_unify\.sql/);
    expect(runner).toMatch(/claim_line_broadcast_send\(/);
    expect(runner).toMatch(/claim_line_delivery_task\(/);
    expect(runner).toMatch(/yesterday official\/delivery still counted today/);
    expect(runner).toMatch(/same campaign recipients over-counted/);
    expect(runner).toMatch(/failed delivery still consumed quota/);
    expect(runner).toMatch(/timeout did not keep shared pending_confirmation/);
    expect(runner).toMatch(/official claim consumed a campaign already on the delivery ledger/);
    expect(runner).toMatch(/delivery claimed a campaign already on the official ledger/);
    expect(runner).toMatch(/unparseable key did not fail-close/);
    expect(runner).toMatch(/remaining-1 dual claim exceeded or missed the shared cap/);
    expect(runner).toMatch(/lumiere delivery was blocked by enjoye quota/);
    expect(runner).not.toMatch(/bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/);
    expect(runner).not.toMatch(/LINE_BROADCAST_SEND_OPEN = true|pg_cron|cron\.schedule/);
    expect(stub).toMatch(/LOCAL TEST ONLY/);
    expect(stub).toMatch(/broadcast_formal_runtime_open = true/);
    expect(stub).not.toMatch(/api\.line\.me|channel_secret|SUPABASE_SERVICE_ROLE_KEY/);
  });
});
