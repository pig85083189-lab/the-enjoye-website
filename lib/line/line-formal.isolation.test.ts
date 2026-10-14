// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { interpretLineBroadcastApiOutcome, type LineActor } from "@/lib/line/line-command";
import {
  LINE_BROADCAST_FORMAL_OPEN,
  LINE_BROADCAST_FORMAL_OPEN_ENV,
  LINE_BROADCAST_FORMAL_ORG_ENV,
  LINE_BROADCAST_SEND_OPEN,
  LINE_CONNECTION_PILOT_ENV,
  isLineBroadcastFormalOpen,
  isLineBroadcastSendOpen,
} from "@/lib/line/line-flag";
import {
  evaluateLineBroadcastFormalIdentity,
  evaluateLineBroadcastFormalReadiness,
  evaluateLineBroadcastSharedChannel,
  lineBroadcastChannelRequiresCrossOrgLock,
  lineBroadcastFormalDoesNotUseOneshotPermit,
  lineBroadcastSharedChannelOwner,
} from "@/lib/line/line-formal";
import { evaluateLineBroadcastOneshotPermit } from "@/lib/line/line-oneshot";
import { describeLineQuota, unknownLineQuota } from "@/lib/line/line-quota";
import { isLineBroadcastConfirmSubmitEnabled } from "@/lib/line/line-visibility";
import type { LineOfficialAccountPublic } from "@/lib/line/line-types";
import {
  ORG_BEAUTY_OS_TEST_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import {
  PREVIEW_SUPABASE_HOST,
  PRODUCTION_SUPABASE_HOST,
} from "@/lib/staff-auth/staff-invite-redirect";

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

const formalEnv = {
  ...previewEnv,
  [LINE_BROADCAST_FORMAL_OPEN_ENV]: "1",
  [LINE_BROADCAST_FORMAL_ORG_ENV]: ORG_ENJOYE_ID,
};

function owner(organizationId: string): LineActor {
  return {
    authUserId: "496f2538-8759-4038-b033-bc367e930cab",
    role: "OWNER",
    isActive: true,
    organizationId,
    userId: "staff-001",
  };
}

function account(over: Partial<LineOfficialAccountPublic> = {}): LineOfficialAccountPublic {
  return {
    organizationId: ORG_ENJOYE_ID,
    channelId: "2009219238",
    botDisplayName: "ai",
    botBasicId: "@357gospk",
    tokenHint: "••••lFU=",
    secretConfigured: true,
    tokenConfigured: true,
    broadcastEnabled: true,
    testPushEnabled: false,
    testPushRuntimeOpen: false,
    broadcastTestRuntimeOpen: false,
    lastTestedAt: "2026-10-12T04:00:00.000Z",
    lastTestStatus: "ok",
    lastTestMessage: "ok",
    ...over,
  };
}

const readyBase = {
  env: formalEnv,
  connectionPilotEnabled: true,
  organizationId: ORG_ENJOYE_ID,
  actor: owner(ORG_ENJOYE_ID),
  account: account(),
  ownerBroadcastEnabled: true,
  accountConnected: true,
  peerUsageKnown: true,
  peerAcceptedToday: 0,
  acceptedToday: 0,
  formalRuntimeOpen: true,
  requireIdentity: true,
  identity: {
    clientId: "2009219238",
    displayName: "ai",
    basicId: "@357gospk",
  },
  lineQuota: describeLineQuota({ type: "limited", limit: 500, usage: 12 }),
};

describe("LINE Phase 2B.1 formal send readiness", () => {
  it("keeps the global send flag closed and does not add a SEND_OPEN env bypass", () => {
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_BROADCAST_FORMAL_OPEN).toBe(false);
    expect(isLineBroadcastSendOpen(formalEnv)).toBe(false);
    expect(isLineBroadcastFormalOpen({ organizationId: ORG_ENJOYE_ID, env: previewEnv })).toBe(
      false,
    );
    expect(isLineBroadcastFormalOpen({ organizationId: ORG_ENJOYE_ID, env: formalEnv })).toBe(true);
    expect(
      isLineBroadcastFormalOpen({ organizationId: ORG_BEAUTY_OS_TEST_ID, env: formalEnv }),
    ).toBe(false);
    expect(
      isLineBroadcastFormalOpen({
        organizationId: ORG_ENJOYE_ID,
        env: { ...formalEnv, VERCEL_ENV: "production" },
      }),
    ).toBe(false);
    const productionFormalEnv = {
      ...formalEnv,
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST}`,
    };
    expect(
      isLineBroadcastFormalOpen({
        organizationId: ORG_ENJOYE_ID,
        env: productionFormalEnv,
      }),
    ).toBe(true);
    expect(
      isLineBroadcastFormalOpen({
        organizationId: ORG_BEAUTY_OS_TEST_ID,
        env: productionFormalEnv,
      }),
    ).toBe(false);
    expect(
      isLineBroadcastFormalOpen({
        organizationId: ORG_LUMIERE_ID,
        env: productionFormalEnv,
      }),
    ).toBe(false);
    expect(
      isLineBroadcastFormalOpen({
        organizationId: ORG_ENJOYE_ID,
        env: { ...productionFormalEnv, [LINE_BROADCAST_FORMAL_OPEN_ENV]: undefined },
      }),
    ).toBe(false);
    expect(source("lib/line/line-flag.ts")).toMatch(/LINE_BROADCAST_SEND_OPEN = false/);
    expect(source("lib/line/line-flag.ts")).toMatch(/LINE_BROADCAST_FORMAL_OPEN = false/);
    expect(source("lib/line/line-flag.ts")).not.toMatch(/BEAUTY_OS_LINE_BROADCAST_SEND_OPEN/);
    expect(source("lib/line/line-formal.ts")).not.toMatch(/executeLineBroadcastHttp|LINE_BROADCAST_SEND_OPEN = true/);
    expect(lineBroadcastFormalDoesNotUseOneshotPermit()).toBe(true);
  });

  it("blocks THE ENJOYE today for the same reasons Owner sees in Preview", () => {
    const closed = evaluateLineBroadcastFormalReadiness({
      ...readyBase,
      env: previewEnv,
      peerUsageKnown: false,
      requireIdentity: false,
      lineQuota: undefined,
    });
    expect(closed).toMatchObject({ ok: false, reason: "send_closed" });
    expect(
      isLineBroadcastConfirmSubmitEnabled({
        sendOpen: false,
        acknowledged: true,
        pending: false,
      }),
    ).toBe(false);
  });

  it("isolates TEST oneshot from formal send and shared Channel 2009219238", () => {
    expect(lineBroadcastSharedChannelOwner("2009219238")).toBe(ORG_ENJOYE_ID);
    expect(lineBroadcastChannelRequiresCrossOrgLock("2009219238")).toBe(true);
    expect(
      evaluateLineBroadcastSharedChannel({
        organizationId: ORG_BEAUTY_OS_TEST_ID,
        channelId: "2009219238",
        peerUsageKnown: true,
      }),
    ).toMatchObject({ ok: false, reason: "send_closed" });
    expect(
      evaluateLineBroadcastSharedChannel({
        organizationId: ORG_ENJOYE_ID,
        channelId: "2009219238",
        peerUsageKnown: false,
      }),
    ).toMatchObject({ ok: false, reason: "send_closed" });
    expect(
      evaluateLineBroadcastSharedChannel({
        organizationId: ORG_ENJOYE_ID,
        channelId: "2009219238",
        peers: [{ organizationId: ORG_BEAUTY_OS_TEST_ID, channelId: "2009219238" }],
        peerUsageKnown: true,
        acceptedToday: 1,
        peerAcceptedToday: 2,
        dailyLimit: 3,
      }),
    ).toMatchObject({ ok: false, reason: "quota_exceeded" });
    expect(
      evaluateLineBroadcastFormalReadiness({
        ...readyBase,
        organizationId: ORG_BEAUTY_OS_TEST_ID,
        actor: owner(ORG_BEAUTY_OS_TEST_ID),
        account: account({ organizationId: ORG_BEAUTY_OS_TEST_ID }),
      }),
    ).toMatchObject({ ok: false, reason: "send_closed" });
    expect(
      evaluateLineBroadcastOneshotPermit({
        env: previewEnv,
        connectionPilotEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        channelId: "2009219238",
        botDisplayName: "ai",
        botBasicId: "@357gospk",
        textBody: "店長日常群發",
        runtimeOpen: true,
        permitAvailable: true,
      }),
    ).toMatchObject({ ok: false, reason: "send_closed" });
  });

  it("allows a mocked formal Owner send only after identity, quota, and ack gates", () => {
    expect(evaluateLineBroadcastFormalReadiness(readyBase)).toEqual({ ok: true });
    expect(
      evaluateLineBroadcastFormalReadiness({
        ...readyBase,
        actor: { ...owner(ORG_ENJOYE_ID), role: "STAFF" },
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      evaluateLineBroadcastFormalReadiness({
        ...readyBase,
        actor: owner(ORG_LUMIERE_ID),
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      evaluateLineBroadcastFormalReadiness({
        ...readyBase,
        ownerBroadcastEnabled: false,
      }),
    ).toMatchObject({ ok: false, reason: "send_closed" });
    expect(
      evaluateLineBroadcastFormalReadiness({
        ...readyBase,
        lineQuota: unknownLineQuota("實際發送尚未開放，未查詢 LINE 額度"),
      }),
    ).toMatchObject({ ok: false, reason: "quota_exceeded" });
    expect(
      evaluateLineBroadcastFormalIdentity({
        account: account(),
        identity: { clientId: "999", displayName: "ai", basicId: "@357gospk" },
      }),
    ).toMatchObject({ ok: false, reason: "not_configured" });
    expect(
      isLineBroadcastConfirmSubmitEnabled({
        sendOpen: true,
        acknowledged: false,
        pending: false,
        quotaBlocked: false,
      }),
    ).toBe(false);
    expect(
      isLineBroadcastConfirmSubmitEnabled({
        sendOpen: true,
        acknowledged: true,
        pending: false,
        quotaBlocked: false,
      }),
    ).toBe(true);
  });

  it("does not auto-retry timeout or unknown 5xx and reuses the existing send action", () => {
    expect(interpretLineBroadcastApiOutcome({ timedOut: true, httpOk: false })).toMatchObject({
      apiResult: "pending_confirmation",
      status: "pending_confirmation",
    });
    expect(
      interpretLineBroadcastApiOutcome({ timedOut: false, httpOk: false, httpStatus: 500 }),
    ).toMatchObject({
      apiResult: "pending_confirmation",
    });
    const sendFn = source("lib/line/actions.ts").slice(
      source("lib/line/actions.ts").indexOf("export async function sendLineBroadcastAction"),
    );
    expect(sendFn).toMatch(/evaluateLineBroadcastFormalReadiness/);
    expect(sendFn).toMatch(/peerUsageKnown: channelUsage.readOk/);
    expect(sendFn).toMatch(/readLineBroadcastChannelUsage/);
    expect(sendFn.indexOf("verifyStoredLineOneshotIdentity")).toBeLessThan(
      sendFn.indexOf("CLAIM_LINE_BROADCAST_SEND_RPC"),
    );
    expect(sendFn.indexOf("CLAIM_LINE_BROADCAST_SEND_RPC")).toBeLessThan(
      sendFn.indexOf("executeLineBroadcastHttp"),
    );
    expect(sendFn).toMatch(/isLineBroadcastSendOpen\(\) \|\| oneshotReady \|\| formalReady/);
    expect(source("features/line/LineBroadcastCenter.tsx")).toMatch(
      /oneshotActive \|\| textBody === LINE_BROADCAST_ONESHOT_TEXT/,
    );
    expect(source("features/line/LineBroadcastCenter.tsx")).toMatch(/data-line-formal-status/);
    expect(source("features/line/LineBroadcastCenter.tsx")).toMatch(
      /sendLineBroadcastAction\(\{[\s\S]*textBody,/,
    );
  });
});
