// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyLineBroadcastChannelClaimStep,
  emptyLineBroadcastChannelUsage,
  LINE_BROADCAST_CHANNEL_LOCK_NAMESPACE,
  LINE_BROADCAST_QUOTA_SNAPSHOT_MAX_AGE_MS,
  lineBroadcastChannelLockIsNotQuotaConfirmation,
  lineBroadcastClientQuotaSnapshotIsUntrusted,
  lineBroadcastClaimRpcPayload,
  lineBroadcastQuotaSnapshotAllowsClaim,
  parseLineBroadcastChannelUsage,
  sharedChannelFixtureAccounts,
  type LineBroadcastChannelClaimState,
} from "@/lib/line/line-channel-lock";
import { interpretLineBroadcastApiOutcome } from "@/lib/line/line-command";
import {
  LINE_BROADCAST_DAILY_LIMIT,
  LINE_BROADCAST_FORMAL_OPEN,
  LINE_BROADCAST_FORMAL_OPEN_ENV,
  LINE_BROADCAST_FORMAL_ORG_ENV,
  LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
  LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
  LINE_BROADCAST_ONESHOT_CHANNEL_ID,
  LINE_BROADCAST_ONESHOT_TEXT,
  LINE_BROADCAST_SEND_OPEN,
  LINE_CONNECTION_PILOT_ENV,
  isLineBroadcastSendOpen,
} from "@/lib/line/line-flag";
import { evaluateLineBroadcastFormalReadiness } from "@/lib/line/line-formal";
import { describeLineQuota, unknownLineQuota } from "@/lib/line/line-quota";
import { LINE_BROADCAST_CHANNEL_LOCK_MIGRATION_FILE } from "@/lib/persistence/schema-contract";
import { PREVIEW_SUPABASE_HOST } from "@/lib/staff-auth/staff-invite-redirect";
import { ORG_BEAUTY_OS_TEST_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const ROOT = process.cwd();

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const previewEnv = {
  [LINE_CONNECTION_PILOT_ENV]: "1",
  NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  VERCEL_ENV: "preview",
};

const nowMs = Date.parse("2026-10-12T04:00:00.000Z");
const freshCheckedAt = new Date(nowMs).toISOString();

function channelState(
  over: Partial<LineBroadcastChannelClaimState> = {},
): LineBroadcastChannelClaimState {
  return {
    channelId: LINE_BROADCAST_ONESHOT_CHANNEL_ID,
    accounts: sharedChannelFixtureAccounts(),
    rows: [],
    permits: { [ORG_BEAUTY_OS_TEST_ID]: true },
    ...over,
  };
}

function oneshotInput(requestId: string) {
  return {
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    requestId,
    textBody: LINE_BROADCAST_ONESHOT_TEXT,
    sendMode: "oneshot" as const,
    quotaKnown: true,
    quotaRemaining: 488,
    quotaCheckedAt: freshCheckedAt,
    nowMs,
    env: previewEnv,
  };
}

function formalInput(requestId: string) {
  return {
    organizationId: ORG_ENJOYE_ID,
    requestId,
    textBody: "週年活動通知",
    sendMode: "formal" as const,
    quotaKnown: true,
    quotaRemaining: 488,
    quotaCheckedAt: freshCheckedAt,
    nowMs,
    env: previewEnv,
  };
}

describe("LINE Phase 2B.2 Channel lock SQL contract", () => {
  const sql = source(LINE_BROADCAST_CHANNEL_LOCK_MIGRATION_FILE);

  it("is additive, fail-closed, and does not rewrite accepted history", () => {
    expect(sql).toMatch(/broadcast_formal_runtime_open boolean not null default false/);
    expect(sql).toMatch(/line_official_accounts_channel_id_idx/);
    expect(sql).toMatch(/pg_advisory_xact_lock\(870121, hashtext\(v_channel_before\)\)/);
    expect(sql).toMatch(/order by a\.organization_id/);
    expect(sql).toMatch(/for update/);
    expect(sql).toMatch(/line_broadcast_consumed_on_taipei_day_for_channel/);
    expect(sql).toMatch(/line_broadcast_channel_has_inflight/);
    expect(sql).toMatch(/read_line_broadcast_channel_usage/);
    expect(sql).toMatch(/p_send_mode text default 'oneshot'/);
    expect(sql).toMatch(/p_quota_known boolean default false/);
    expect(sql).toMatch(/Asia\/Taipei/);
    expect(sql).toMatch(/status in \('sending', 'pending_confirmation'\)/);
    expect(sql).toMatch(/quota_confirmed', false/);
    expect(sql).toMatch(/Acquiring this lock is not a LINE monthly quota confirmation/);
    expect(sql).toMatch(/never LINE official remaining and never Channel \/ Organization daily usage/);
    expect(sql).not.toMatch(/^\s*begin\s*;/im);
    expect(sql).not.toMatch(/^\s*commit\s*;/im);
    expect(sql).not.toMatch(/broadcast_formal_runtime_open\s*=\s*true/);
    expect(sql).not.toMatch(/update public\.line_broadcasts\s+set status = 'accepted'/i);
    expect(sql).not.toMatch(/insert into public\.line_broadcasts/i);
    expect(sql.replace(/^--.*$/gm, "")).not.toMatch(
      /channel_secret|access_token|line_user_id|response_body/i,
    );
    expect(sql).not.toMatch(/grant execute on function public\.claim_line_broadcast_send[^;]+anon/);
    expect(sql).not.toMatch(
      /grant execute on function public\.read_line_broadcast_channel_usage[^;]+anon/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.set_line_broadcast_formal_runtime_open[^;]+anon/,
    );
  });

  it("keeps 4-arg oneshot callable and isolates TEST from formal", () => {
    expect(sql).toMatch(
      /drop function if exists public\.claim_line_broadcast_send\(text, text, text, text\)/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.claim_line_broadcast_send\(text, text, text, text, text, boolean, integer, timestamptz\)\s+to authenticated/,
    );
    expect(sql).toMatch(/v_send_mode = 'oneshot'/);
    expect(sql).toMatch(/v_send_mode not in \('oneshot', 'formal'\)/);
    expect(sql).toMatch(/Beauty OS TEST 只能使用一次性測試路徑/);
    expect(sql).toMatch(/一次性群發測試只允許 Beauty OS TEST/);
    expect(sql).toMatch(/正式群發執行開關已關閉/);
    expect(sql).toMatch(/org-beauty-os-test may not open/);
    expect(sql).toMatch(/oneshot permit already consumed/);
    const claimSql = sql.slice(sql.lastIndexOf("create or replace function public.claim_line_broadcast_send"));
    expect(claimSql.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      claimSql.indexOf("line_broadcast_channel_has_inflight(v_channel_id)"),
    );
    expect(claimSql.indexOf("line_broadcast_channel_has_inflight(v_channel_id)")).toBeLessThan(
      claimSql.indexOf("line_broadcast_consumed_on_taipei_day_for_channel(v_channel_id)"),
    );
    expect(claimSql.indexOf("line_broadcast_consumed_on_taipei_day_for_channel(v_channel_id)")).toBeLessThan(
      claimSql.indexOf("Client-supplied p_quota_*"),
    );
    expect(claimSql).toMatch(/4-arg oneshot calls omit the snapshot and must fail-closed/);
    expect(claimSql).not.toMatch(/v_quota_confirmed := true/);
    expect(sql).toMatch(/finalize_stale_line_broadcast_sending_for_channel/);
    expect(sql).toMatch(/Never retries/);
  });
});

describe("LINE Phase 2B.2 PostgreSQL Channel claim concurrency", () => {
  it("serializes same-org double clicks onto one Channel claim", () => {
    const state = channelState();
    const first = applyLineBroadcastChannelClaimStep(state, formalInput("lbrq-aaa00000000001"));
    const retry = applyLineBroadcastChannelClaimStep(state, formalInput("lbrq-aaa00000000001"));
    const second = applyLineBroadcastChannelClaimStep(state, formalInput("lbrq-bbb00000000002"));
    expect(first).toMatchObject({ claimed: true, quotaConfirmed: false, status: "sending" });
    expect(retry).toMatchObject({ claimed: false, reason: "pending_confirmation" });
    expect(second).toMatchObject({ claimed: false, reason: "pending_confirmation" });
    expect(state.rows.filter((row) => row.status === "sending")).toHaveLength(1);
  });

  it("blocks a peer Organization while the shared Channel is inflight", () => {
    const state = channelState();
    const oneshot = applyLineBroadcastChannelClaimStep(state, oneshotInput("lbrq-test0000000001"));
    const formal = applyLineBroadcastChannelClaimStep(state, formalInput("lbrq-enjoye00000001"));
    expect(oneshot).toMatchObject({ claimed: true });
    expect(formal).toMatchObject({
      claimed: false,
      reason: "pending_confirmation",
      quotaConfirmed: false,
    });
  });

  it("counts accepted history toward Channel daily and not as inflight", () => {
    const state = channelState({
      rows: [
        {
          organizationId: ORG_BEAUTY_OS_TEST_ID,
          requestId: "lbrq-7a17faeae137440d",
          status: "accepted",
          sendClaimedAt: "2026-10-11T16:10:00.000Z",
        },
      ],
      permits: { [ORG_BEAUTY_OS_TEST_ID]: false },
    });
    const formal = applyLineBroadcastChannelClaimStep(state, formalInput("lbrq-enjoye00000001"));
    expect(formal).toMatchObject({
      claimed: true,
      quotaConfirmed: false,
      consumedToday: 2,
    });
  });

  it("uses Channel daily instead of a single Organization daily limit", () => {
    const state = channelState({
      rows: [
        {
          organizationId: ORG_BEAUTY_OS_TEST_ID,
          requestId: "lbrq-hist00000000001",
          status: "accepted",
          sendClaimedAt: "2026-10-11T16:01:00.000Z",
        },
        {
          organizationId: ORG_ENJOYE_ID,
          requestId: "lbrq-hist00000000002",
          status: "accepted",
          sendClaimedAt: "2026-10-11T16:02:00.000Z",
        },
        {
          organizationId: ORG_BEAUTY_OS_TEST_ID,
          requestId: "lbrq-hist00000000003",
          status: "failed",
          sendClaimedAt: "2026-10-11T16:03:00.000Z",
        },
      ],
    });
    expect(LINE_BROADCAST_DAILY_LIMIT).toBe(3);
    expect(
      applyLineBroadcastChannelClaimStep(state, formalInput("lbrq-enjoye00000001")),
    ).toMatchObject({ claimed: false, reason: "quota_exceeded", quotaConfirmed: false });
  });
});

describe("LINE Phase 2B.2 official monthly quota after Channel lock", () => {
  it("refuses unknown or insufficient LINE monthly quota even with a lock", () => {
    const unknown = applyLineBroadcastChannelClaimStep(channelState(), {
      ...formalInput("lbrq-enjoye00000001"),
      quotaKnown: false,
      quotaRemaining: null,
    });
    const empty = applyLineBroadcastChannelClaimStep(channelState(), {
      ...formalInput("lbrq-enjoye00000002"),
      quotaRemaining: 0,
    });
    const stale = applyLineBroadcastChannelClaimStep(channelState(), {
      ...formalInput("lbrq-enjoye00000003"),
      quotaCheckedAt: new Date(nowMs - LINE_BROADCAST_QUOTA_SNAPSHOT_MAX_AGE_MS - 1).toISOString(),
    });
    expect(unknown).toMatchObject({ claimed: false, reason: "quota_exceeded", quotaConfirmed: false });
    expect(empty).toMatchObject({ claimed: false, reason: "quota_exceeded", quotaConfirmed: false });
    expect(stale).toMatchObject({ claimed: false, reason: "quota_exceeded", quotaConfirmed: false });
    expect(lineBroadcastChannelLockIsNotQuotaConfirmation()).toBe(true);
    expect(lineBroadcastClientQuotaSnapshotIsUntrusted()).toBe(true);
    expect(
      applyLineBroadcastChannelClaimStep(channelState(), {
        ...oneshotInput("lbrq-legacy00000001"),
        quotaKnown: false,
        quotaRemaining: null,
        quotaCheckedAt: null,
      }),
    ).toMatchObject({ claimed: false, reason: "quota_exceeded", quotaConfirmed: false });
    expect(lineBroadcastQuotaSnapshotAllowsClaim({ quotaKnown: false, quotaRemaining: 10 })).toMatchObject({
      ok: false,
      reason: "quota_exceeded",
    });
    expect(
      lineBroadcastQuotaSnapshotAllowsClaim({
        quotaKnown: true,
        quotaRemaining: null,
        quotaCheckedAt: freshCheckedAt,
        nowMs,
      }),
    ).toEqual({ ok: true });
  });

  it("does not treat Organization daily remaining as LINE monthly remaining", () => {
    const payload = lineBroadcastClaimRpcPayload({
      organizationId: ORG_ENJOYE_ID,
      requestId: "lbrq-enjoye00000001",
      textBody: "週年活動通知",
      sendMode: "formal",
      quota: describeLineQuota({ type: "limited", limit: 500, usage: 500 }),
      quotaCheckedAt: freshCheckedAt,
    });
    expect(payload.p_quota_known).toBe(true);
    expect(payload.p_quota_remaining).toBe(0);
    expect(payload.p_quota_remaining).not.toBe(LINE_BROADCAST_DAILY_LIMIT);
    expect(payload.p_send_mode).toBe("formal");
    expect(
      parseLineBroadcastChannelUsage({
        ok: true,
        channel_id: "2009219238",
        consumed_today: 1,
        org_consumed_today: 0,
        peer_consumed_today: 1,
        inflight: false,
        peer_organization_ids: [ORG_BEAUTY_OS_TEST_ID],
        quota_confirmed: true,
      }).quotaConfirmed,
    ).toBe(false);
    expect(emptyLineBroadcastChannelUsage()).toMatchObject({
      readOk: false,
      quotaConfirmed: false,
    });
  });

  it("keeps timeout and 5xx pending_confirmation with no auto-retry", () => {
    expect(interpretLineBroadcastApiOutcome({ timedOut: true, httpOk: false })).toMatchObject({
      apiResult: "pending_confirmation",
      status: "pending_confirmation",
    });
    expect(
      interpretLineBroadcastApiOutcome({ timedOut: false, httpOk: false, httpStatus: 503 }),
    ).toMatchObject({
      apiResult: "pending_confirmation",
    });
    const state = channelState({
      rows: [
        {
          organizationId: ORG_ENJOYE_ID,
          requestId: "lbrq-pending0000001",
          status: "pending_confirmation",
          sendClaimedAt: freshCheckedAt,
        },
      ],
    });
    expect(
      applyLineBroadcastChannelClaimStep(state, formalInput("lbrq-enjoye00000001")),
    ).toMatchObject({ claimed: false, reason: "pending_confirmation" });
  });
});

describe("LINE Phase 2B.2 isolation of TEST, formal, and Production", () => {
  it("keeps send flags closed and never opens the formal runtime setter", () => {
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_BROADCAST_FORMAL_OPEN).toBe(false);
    expect(isLineBroadcastSendOpen(previewEnv)).toBe(false);
    expect(LINE_BROADCAST_CHANNEL_LOCK_NAMESPACE).toBe(870121);
    expect(source("lib/line/line-flag.ts")).toMatch(/LINE_BROADCAST_SEND_OPEN = false/);
    expect(source("lib/line/line-flag.ts")).not.toMatch(/BEAUTY_OS_LINE_BROADCAST_SEND_OPEN/);
    expect(source("lib/line/actions.ts")).not.toMatch(/SET_LINE_BROADCAST_FORMAL_RUNTIME_OPEN_RPC/);
    expect(source("lib/line/actions.ts")).not.toMatch(/set_line_broadcast_formal_runtime_open/);
    expect(source("lib/line/line-channel-lock.ts")).not.toMatch(/\/message\/broadcast/);
    expect(source("lib/line/line-channel-lock.ts")).not.toMatch(/LINE_BROADCAST_SEND_OPEN = true/);
    expect(source("lib/line/line-load.ts")).toMatch(/READ_LINE_BROADCAST_CHANNEL_USAGE_RPC/);
    expect(source("lib/line/line-load.ts")).not.toMatch(
      /LINE_ACCOUNT_PUBLIC_COLUMNS =\s*"[^"]*broadcast_formal_runtime_open/,
    );
    expect(source("lib/line/actions.ts")).toMatch(/lineBroadcastClaimRpcPayload/);
    expect(source("lib/line/actions.ts")).toMatch(
      /FINALIZE_STALE_LINE_BROADCAST_SENDING_FOR_CHANNEL_RPC/,
    );
    const runner = source("scripts/line-broadcast-channel-lock-local-pg.sh");
    expect(runner).toMatch(/beauty_os_line_2b3_local/);
    expect(runner).toMatch(/unix socket/);
    expect(runner).not.toMatch(/bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/);
    expect(source("lib/line/line-oneshot-authorized-send.ts")).toMatch(/sendMode: "oneshot"/);
    expect(source("lib/line/actions.ts")).toMatch(/sendMode: oneshotReady \? "oneshot" : "formal"/);
  });

  it("keeps TEST off formal and ENJOYE off oneshot while sharing Channel 2009219238", () => {
    expect(
      applyLineBroadcastChannelClaimStep(channelState(), {
        ...oneshotInput("lbrq-test0000000001"),
        organizationId: ORG_ENJOYE_ID,
      }),
    ).toMatchObject({ claimed: false, reason: "send_closed" });
    expect(
      applyLineBroadcastChannelClaimStep(channelState(), {
        ...formalInput("lbrq-enjoye00000001"),
        organizationId: ORG_BEAUTY_OS_TEST_ID,
      }),
    ).toMatchObject({ claimed: false, reason: "send_closed" });
    expect(
      evaluateLineBroadcastFormalReadiness({
        env: {
          ...previewEnv,
          [LINE_BROADCAST_FORMAL_OPEN_ENV]: "1",
          [LINE_BROADCAST_FORMAL_ORG_ENV]: ORG_ENJOYE_ID,
        },
        connectionPilotEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        account: {
          organizationId: ORG_ENJOYE_ID,
          channelId: LINE_BROADCAST_ONESHOT_CHANNEL_ID,
          botDisplayName: LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
          botBasicId: LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
          tokenHint: "••••",
          secretConfigured: true,
          tokenConfigured: true,
          broadcastEnabled: true,
          testPushEnabled: false,
          testPushRuntimeOpen: false,
          broadcastTestRuntimeOpen: false,
          lastTestedAt: freshCheckedAt,
          lastTestStatus: "ok",
          lastTestMessage: "ok",
        },
        ownerBroadcastEnabled: true,
        accountConnected: true,
        peerUsageKnown: true,
        formalRuntimeOpen: false,
        lineQuota: describeLineQuota({ type: "none", usage: 1 }),
      }),
    ).toMatchObject({ ok: false, reason: "send_closed" });
    expect(
      evaluateLineBroadcastFormalReadiness({
        env: previewEnv,
        connectionPilotEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        account: null,
        ownerBroadcastEnabled: true,
        accountConnected: false,
        peerUsageKnown: false,
        formalRuntimeOpen: true,
        lineQuota: unknownLineQuota(),
      }),
    ).toMatchObject({ ok: false, reason: "send_closed" });
  });
});
