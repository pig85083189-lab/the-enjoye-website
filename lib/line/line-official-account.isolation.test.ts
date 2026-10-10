// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MEMBERSHIP_ENJOYE_OWNER_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import {
  PREVIEW_SUPABASE_HOST,
  PRODUCTION_SUPABASE_HOST,
} from "@/lib/staff-auth/staff-invite-redirect";
import { LINE_OFFICIAL_ACCOUNT_MIGRATION_FILE } from "@/lib/persistence/schema-contract";
import { STAFF_LINE_ROLES, resolveStaffRolePageAccess } from "@/lib/staff/staff-role-page-access";
import {
  evaluateLineBroadcastDraft,
  evaluateLineBroadcastEnable,
  evaluateLineBroadcastSend,
  evaluateLineConnectionSave,
  evaluateLineConnectionTest,
  interpretLineBroadcastApiOutcome,
  LINE_BOT_INFO_PATH,
  LINE_BROADCAST_PATH,
  MARK_LINE_BROADCAST_SEND_CLOSED_RPC,
  newLineRequestId,
  READ_LINE_SECRETS_RPC,
  type LineActor,
} from "@/lib/line/line-command";
import {
  canEncryptLineCredentials,
  decryptLineCredential,
  encryptLineCredential,
  tokenHintFromAccessToken,
} from "@/lib/line/line-crypto";
import {
  hasLineCredentialKey,
  isLineBroadcastSendOpen,
  isLineConnectionPilotEnabled,
  LINE_BROADCAST_DAILY_LIMIT,
  LINE_BROADCAST_SEND_OPEN,
  LINE_CONNECTION_PILOT_ENV,
  LINE_CREDENTIAL_KEY_ENV,
} from "@/lib/line/line-flag";
import { canManageLineOfficialAccount } from "@/lib/line/line-roles";
import { executeLineBroadcastHttp } from "@/lib/line/line-send-adapter";
import { fetchLineBotInfo } from "@/lib/line/line-connection-adapter";
import { countAcceptedBroadcastsOnDay } from "@/lib/line/line-load";
import {
  canShowLineSettings,
  lineBroadcastApiResultLabel,
} from "@/lib/line/line-visibility";
import type { LineBroadcastPublic } from "@/lib/line/line-types";

const ROOT = process.cwd();
const AUTH_OWNER = "496f2538-8759-4038-b033-bc367e930cab";

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function ownerActor(over: Partial<LineActor> = {}): LineActor {
  return {
    authUserId: AUTH_OWNER,
    role: "OWNER",
    isActive: true,
    organizationId: ORG_ENJOYE_ID,
    userId: "staff-001",
    ...over,
  };
}

function draftBroadcast(over: Partial<LineBroadcastPublic> = {}): LineBroadcastPublic {
  return {
    id: "lbr-draft000000001",
    organizationId: ORG_ENJOYE_ID,
    status: "draft",
    textBody: "週年活動通知",
    requestId: "lbrq-req00000000001",
    lineRequestId: null,
    apiResult: null,
    errorMessage: null,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    confirmedAt: null,
    ...over,
  };
}

const previewEnv = {
  [LINE_CONNECTION_PILOT_ENV]: "1",
  NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

describe("LINE Phase 1 flags", () => {
  it("keeps connection pilot and send path fail-closed", () => {
    expect(LINE_CONNECTION_PILOT_ENV).toBe("BEAUTY_OS_LINE_CONNECTION_PILOT");
    expect(LINE_CREDENTIAL_KEY_ENV).toBe("BEAUTY_OS_LINE_CREDENTIAL_KEY");
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_BROADCAST_DAILY_LIMIT).toBe(3);
    expect(isLineConnectionPilotEnabled({})).toBe(false);
    expect(isLineConnectionPilotEnabled({ [LINE_CONNECTION_PILOT_ENV]: "1" })).toBe(false);
    expect(isLineConnectionPilotEnabled(previewEnv)).toBe(true);
    expect(isLineBroadcastSendOpen(previewEnv)).toBe(false);
    expect(hasLineCredentialKey({})).toBe(false);
  });
});

describe("LINE Phase 1 RBAC reuses existing membership", () => {
  it("is Owner-only and hides from other roles", () => {
    expect(STAFF_LINE_ROLES).toEqual(["OWNER"]);
    expect(canManageLineOfficialAccount({ role: "OWNER", isActive: true })).toBe(true);
    expect(canShowLineSettings({ role: "OWNER", isActive: true })).toBe(true);
    for (const role of ["MANAGER", "STAFF", "RECEPTIONIST", "ACCOUNTANT"] as const) {
      expect(canManageLineOfficialAccount({ role, isActive: true })).toBe(false);
      expect(canShowLineSettings({ role, isActive: true })).toBe(false);
    }
    expect(
      resolveStaffRolePageAccess({
        authenticated: true,
        role: "MANAGER",
        isActive: true,
        allowedRoles: STAFF_LINE_ROLES,
      }),
    ).toBe("forbidden");
    expect(MEMBERSHIP_ENJOYE_OWNER_ID).toMatch(/enjoye/);
  });

  it("refuses another organization and inactive memberships", () => {
    const save = evaluateLineConnectionSave({
      connectionPilotEnabled: true,
      encryptionReady: true,
      organizationId: ORG_LUMIERE_ID,
      actor: ownerActor(),
      channelId: "1234567890",
      channelSecret: "secret-value",
      channelAccessToken: "token-value-123456",
    });
    expect(save).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      evaluateLineBroadcastDraft({
        connectionPilotEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        actor: ownerActor({ isActive: false }),
        textBody: "hello",
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
  });
});

describe("LINE credential vault", () => {
  const env = {
    [LINE_CREDENTIAL_KEY_ENV]: Buffer.alloc(32, 7).toString("base64"),
  };

  it("encrypts with AES-256-GCM and never stores plaintext", () => {
    expect(canEncryptLineCredentials(env)).toBe(true);
    const secret = "channel-secret-plain";
    const packed = encryptLineCredential(secret, env);
    expect(packed.ok).toBe(true);
    if (!packed.ok) return;
    expect(packed.cipher.startsWith("v1.")).toBe(true);
    expect(packed.cipher).not.toContain(secret);
    const opened = decryptLineCredential(packed.cipher, env);
    expect(opened).toEqual({ ok: true, plaintext: secret });
    expect(tokenHintFromAccessToken("abcdefghijklmnop1234")).toBe("••••1234");
    expect(tokenHintFromAccessToken("abcdefghijklmnop1234")).not.toContain("abcdefghijklmnop");
  });
});

describe("LINE connection and broadcast decisions", () => {
  it("requires valid channel credentials before save", () => {
    expect(
      evaluateLineConnectionSave({
        connectionPilotEnabled: true,
        encryptionReady: true,
        organizationId: ORG_ENJOYE_ID,
        actor: ownerActor(),
        channelId: "abc",
        channelSecret: "secret-value",
        channelAccessToken: "token-value-123456",
      }),
    ).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(
      evaluateLineConnectionSave({
        connectionPilotEnabled: true,
        encryptionReady: true,
        organizationId: ORG_ENJOYE_ID,
        actor: ownerActor(),
        channelId: "1234567890",
        channelSecret: "secret-value",
        channelAccessToken: "token-value-123456",
      }),
    ).toEqual({ ok: true });
  });

  it("tests connection only after credentials exist", () => {
    expect(
      evaluateLineConnectionTest({
        connectionPilotEnabled: true,
        encryptionReady: true,
        organizationId: ORG_ENJOYE_ID,
        actor: ownerActor(),
        secretConfigured: false,
        tokenConfigured: false,
      }),
    ).toMatchObject({ ok: false, reason: "not_configured" });
  });

  it("keeps send closed even after Owner enable", () => {
    expect(
      evaluateLineBroadcastEnable({
        connectionPilotEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        actor: ownerActor(),
        enabled: true,
        tokenConfigured: true,
      }),
    ).toEqual({ ok: true });
    const closed = evaluateLineBroadcastSend({
      connectionPilotEnabled: true,
      sendOpen: false,
      ownerBroadcastEnabled: true,
      organizationId: ORG_ENJOYE_ID,
      actor: ownerActor(),
      textBody: "週年活動通知",
      existing: draftBroadcast(),
      requestId: "lbrq-req00000000001",
      acceptedToday: 0,
    });
    expect(closed).toMatchObject({ ok: false, reason: "send_closed" });
  });

  it("does not invent friend segments and enforces quota plus idempotency", () => {
    expect(
      evaluateLineBroadcastDraft({
        connectionPilotEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        actor: ownerActor(),
        textBody: "",
      }),
    ).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(
      evaluateLineBroadcastSend({
        connectionPilotEnabled: true,
        sendOpen: true,
        ownerBroadcastEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        actor: ownerActor(),
        textBody: "週年活動通知",
        existing: draftBroadcast({ status: "accepted" }),
        requestId: "lbrq-req00000000001",
        acceptedToday: 0,
      }),
    ).toMatchObject({ ok: false, reason: "duplicate" });
    expect(
      evaluateLineBroadcastSend({
        connectionPilotEnabled: true,
        sendOpen: true,
        ownerBroadcastEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        actor: ownerActor(),
        textBody: "週年活動通知",
        existing: draftBroadcast({ status: "pending_confirmation" }),
        requestId: "lbrq-req00000000001",
        acceptedToday: 0,
      }),
    ).toMatchObject({ ok: false, reason: "pending_confirmation" });
    expect(
      evaluateLineBroadcastSend({
        connectionPilotEnabled: true,
        sendOpen: true,
        ownerBroadcastEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        actor: ownerActor(),
        textBody: "週年活動通知",
        existing: draftBroadcast(),
        requestId: "lbrq-req00000000001",
        acceptedToday: LINE_BROADCAST_DAILY_LIMIT,
      }),
    ).toMatchObject({ ok: false, reason: "quota_exceeded" });
    expect(
      evaluateLineBroadcastSend({
        connectionPilotEnabled: true,
        sendOpen: true,
        ownerBroadcastEnabled: true,
        organizationId: ORG_LUMIERE_ID,
        actor: ownerActor({ organizationId: ORG_LUMIERE_ID }),
        textBody: "週年活動通知",
        existing: draftBroadcast(),
        requestId: "lbrq-req00000000001",
        acceptedToday: 0,
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
  });

  it("records LINE timeout as pending confirmation and accepted as API accepted only", () => {
    expect(interpretLineBroadcastApiOutcome({ timedOut: true, httpOk: false })).toMatchObject({
      apiResult: "pending_confirmation",
      status: "pending_confirmation",
    });
    expect(interpretLineBroadcastApiOutcome({ timedOut: false, httpOk: true })).toMatchObject({
      apiResult: "accepted",
      status: "accepted",
    });
    expect(lineBroadcastApiResultLabel("accepted")).toMatch(/不代表每位好友已收到/);
    expect(newLineRequestId(() => "aaaaaaaa-bbbb-cccc-dddd-eeeeffffffffffff")).toMatch(/^lbrq-/);
    expect(
      countAcceptedBroadcastsOnDay(
        [
          draftBroadcast({ status: "accepted", createdAt: "2026-10-10T01:00:00.000Z" }),
          draftBroadcast({
            id: "lbr-other",
            status: "draft",
            createdAt: "2026-10-10T02:00:00.000Z",
          }),
        ],
        "2026-10-10",
      ),
    ).toBe(1);
  });
});

describe("LINE HTTP adapters", () => {
  it("connection test uses bot info and never broadcasts", async () => {
    expect(LINE_BOT_INFO_PATH).toBe("/v2/bot/info");
    expect(LINE_BROADCAST_PATH).toBe("/v2/bot/message/broadcast");
    const called: string[] = [];
    const result = await fetchLineBotInfo("token", async (input) => {
      called.push(String(input));
      return new Response(JSON.stringify({ displayName: "Demo OA", basicId: "@demo" }), {
        status: 200,
      });
    });
    expect(result).toEqual({ ok: true, displayName: "Demo OA", basicId: "@demo" });
    expect(called[0]).toContain("/v2/bot/info");
    expect(called.join("")).not.toContain("/message/broadcast");
  });

  it("broadcast adapter does not call LINE when send is closed", async () => {
    let fetched = 0;
    const result = await executeLineBroadcastHttp({
      accessToken: "token",
      textBody: "hello",
      requestId: "lbrq-req00000000001",
      sendOpen: false,
      fetchImpl: async () => {
        fetched += 1;
        return new Response("{}", { status: 200 });
      },
    });
    expect(result).toEqual({ timedOut: false, httpOk: false, lineRequestId: null });
    expect(fetched).toBe(0);
  });
});

describe("LINE source contracts", () => {
  const migration = source(LINE_OFFICIAL_ACCOUNT_MIGRATION_FILE);
  const actions = source("lib/line/actions.ts");
  const settingsUi = source("features/line/LineOfficialAccountSettings.tsx");
  const broadcastUi = source("features/line/LineBroadcastCenter.tsx");
  const settingsHub = source("features/settings/SettingsWorkspacePage.tsx");
  const crypto = source("lib/line/line-crypto.ts");
  const send = source("lib/line/line-send-adapter.ts");

  it("keeps secrets off authenticated SELECT and reuses membership Owner checks", () => {
    expect(migration).toMatch(/create table if not exists public\.line_official_accounts/);
    expect(migration).toMatch(/create table if not exists public\.line_official_account_secrets/);
    expect(migration).toMatch(/create table if not exists public\.line_broadcasts/);
    expect(migration).toMatch(/create table if not exists public\.line_broadcast_events/);
    expect(migration).toMatch(/user_is_org_owner/);
    expect(migration).toMatch(/staff_auth_memberships/);
    expect(migration).toMatch(/user_has_org_membership/);
    expect(migration).toMatch(/revoke all on public\.line_official_account_secrets/);
    expect(migration).not.toMatch(/grant select on public\.line_official_account_secrets/);
    expect(migration).toMatch(
      new RegExp(`revoke all on function public\\.${READ_LINE_SECRETS_RPC}`),
    );
    expect(migration).not.toMatch(
      new RegExp(`grant execute on function public\\.${READ_LINE_SECRETS_RPC}`),
    );
    expect(migration).not.toMatch(/friend_count|follower_count|segment_id|audience_id/);
    expect(migration).not.toMatch(/create table if not exists public\.organizations/);
    expect(migration).toMatch(/line_broadcasts_one_request_per_org/);
    expect(migration).toMatch(MARK_LINE_BROADCAST_SEND_CLOSED_RPC);
  });

  it("never ships secrets or send adapters to the client UI", () => {
    expect(settingsUi).not.toMatch(/line-crypto|line-send-adapter|createServiceRoleClient/);
    expect(broadcastUi).not.toMatch(/line-crypto|line-send-adapter|createServiceRoleClient/);
    expect(settingsHub).toMatch(/data-line-settings-entry/);
    expect(settingsHub).not.toMatch(/channelAccessToken|channel_secret_cipher/);
    expect(crypto).toMatch(/aes-256-gcm/);
    expect(crypto).toMatch(/LINE credential crypto cannot run in the browser/);
    expect(send).toMatch(/X-Line-Retry-Key/);
    expect(actions).not.toMatch(/executeLineBroadcastHttp/);
    expect(actions).toMatch(/LINE_BROADCAST_SEND_CLOSED_RPC|mark_line_broadcast_send_closed/);
    expect(actions).toMatch(/from\("line_official_account_secrets"\)/);
    expect(actions).toMatch(/channel_access_token_cipher/);
    expect(actions).not.toMatch(/console\.(log|info|debug|error|warn)\(/);
    expect(source("lib/line/line-connection-adapter.ts")).not.toMatch(/console\.(log|info|debug)/);
    expect(existsSync(path.join(ROOT, "lib/line.ts"))).toBe(true);
    expect(existsSync(path.join(ROOT, "lib/line/index.ts"))).toBe(false);
  });

  it("does not change Production hosts or invent a second RBAC", () => {
    expect(source("lib/line/line-roles.ts")).toMatch(/staff_auth_memberships|OWNER/);
    expect(source("lib/line/line-flag.ts")).toMatch(/LINE_BROADCAST_SEND_OPEN = false/);
    expect(source("app/staff/(app)/settings/line/page.tsx")).toMatch(/STAFF_LINE_ROLES/);
    expect(source("app/staff/(app)/line/layout.tsx")).toMatch(/STAFF_LINE_ROLES/);
    expect(PRODUCTION_SUPABASE_HOST).toBe("knccefcxncglgpmvgqlp.supabase.co");
    expect(PREVIEW_SUPABASE_HOST).toBe("bfzquejrtgqzzarhkiya.supabase.co");
    expect(source("lib/line/actions.ts")).not.toMatch(PRODUCTION_SUPABASE_HOST);
    expect(source("docs/saas/line-official-account.md")).toMatch(/Phase 1/);
  });
});
