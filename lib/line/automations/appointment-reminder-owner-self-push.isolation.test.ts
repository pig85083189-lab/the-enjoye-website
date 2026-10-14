// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LINE_APPOINTMENT_REMINDER_OWNER_SELF_PUSH_OPEN,
  OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
  OWNER_SELF_REMINDER_ALLOWED_ORG_ID,
  OWNER_SELF_REMINDER_CONFIRM_PHRASE,
  OWNER_SELF_REMINDER_DAILY_LIMIT,
  OWNER_SELF_REMINDER_FAKE_CUSTOMER_ID,
  OWNER_SELF_REMINDER_GRANT_PREFIX,
  OWNER_SELF_REMINDER_GRANT_TTL_MS,
  OWNER_SELF_REMINDER_KILL_SWITCH_OPEN,
  OWNER_SELF_REMINDER_ONESHOT_PREFIX,
  OWNER_SELF_REMINDER_PURPOSE,
  OWNER_SELF_REMINDER_SQL_DRAFT,
  OWNER_SELF_REMINDER_TEST_APPOINTMENT_ID,
  buildOwnerSelfReminderView,
  createOwnerSelfReminderGrantDraft,
  createOwnerSelfReminderOneshotDraft,
  evaluateOwnerSelfGrant,
  evaluateOwnerSelfIdentity,
  evaluateOwnerSelfOneshotClaim,
  evaluateOwnerSelfReminderPush,
  evaluateOwnerSelfRevoke,
  evaluateOwnerSelfTrustedQuota,
  isOwnerSelfReminderPanelVisible,
  newOwnerSelfReminderGrantId,
  newOwnerSelfReminderOneshotId,
  ownerSelfReminderChannelLockSpec,
  ownerSelfReminderRefusesRetry,
  type OwnerSelfReminderGrant,
  type OwnerSelfReminderOneshot,
  type OwnerSelfTrustedQuotaSnapshot,
} from "@/lib/line/automations/appointment-reminder-owner-self-push";
import {
  LINE_APPOINTMENT_REMINDER_CONTROLLED_PUSH_OPEN,
  CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID,
} from "@/lib/line/automations/appointment-reminder-controlled-push";
import {
  LINE_APPOINTMENT_REMINDER_SEND_OPEN,
  allAppointmentReminderFlagsClosed,
} from "@/lib/line/automations/appointment-reminder-flag";
import { LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST, LINE_BROADCAST_SEND_OPEN, LINE_CREDENTIAL_KEY_ID, LINE_TEST_PUSH_OPEN } from "@/lib/line/line-flag";
import { ORG_BEAUTY_OS_TEST_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const ROOT = process.cwd();
const LINE_USER = "U0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-10-14T09:00:00.000Z");
const PREVIEW_ENV = {
  VERCEL_ENV: "preview",
  NEXT_PUBLIC_SUPABASE_URL: `https://${LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST}`,
};

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    staffUserId: "staff-001",
    hint: "••••fc8c",
    bindMethod: "webhook_code" as const,
    keyId: LINE_CREDENTIAL_KEY_ID,
    secretPresent: true,
    boundAt: "2026-10-10T07:44:49.960272+00:00",
    testPushEnabled: true,
    ...overrides,
  };
}

function grant(overrides: Partial<OwnerSelfReminderGrant> = {}): OwnerSelfReminderGrant {
  return {
    id: `${OWNER_SELF_REMINDER_GRANT_PREFIX}test0001`,
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    staffUserId: "staff-001",
    channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
    purpose: OWNER_SELF_REMINDER_PURPOSE,
    appointmentId: OWNER_SELF_REMINDER_TEST_APPOINTMENT_ID,
    bindBoundAt: "2026-10-10T07:44:49.960272+00:00",
    bindHint: "••••fc8c",
    bindKeyId: LINE_CREDENTIAL_KEY_ID,
    acknowledgedOnceOnly: true,
    createdAt: "2026-10-14T08:00:00.000Z",
    expiresAt: "2026-10-15T09:00:00.000Z",
    revokedAt: null,
    authorizedViaTestPush: false,
    ...overrides,
  };
}

function oneshot(overrides: Partial<OwnerSelfReminderOneshot> = {}): OwnerSelfReminderOneshot {
  return {
    id: `${OWNER_SELF_REMINDER_ONESHOT_PREFIX}test0001`,
    grantId: `${OWNER_SELF_REMINDER_GRANT_PREFIX}test0001`,
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    staffUserId: "staff-001",
    channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
    appointmentId: OWNER_SELF_REMINDER_TEST_APPOINTMENT_ID,
    bindBoundAt: "2026-10-10T07:44:49.960272+00:00",
    bindHint: "••••fc8c",
    bindKeyId: LINE_CREDENTIAL_KEY_ID,
    status: "issued",
    expiresAt: "2026-10-14T11:00:00.000Z",
    ...overrides,
  };
}

function trustedSnapshot(
  overrides: Partial<OwnerSelfTrustedQuotaSnapshot> = {},
): OwnerSelfTrustedQuotaSnapshot {
  return {
    source: "service_role_snapshot",
    channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
    known: true,
    remaining: null,
    checkedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateOwnerSelfReminderPush({
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    actorStaffUserId: "staff-001",
    channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
    evidence: evidence(),
    grant: grant(),
    oneshot: oneshot(),
    clientAcknowledged: false,
    authorizeWithTestPushEnabled: false,
    trustClientGrant: false,
    trustedQuotaSnapshot: trustedSnapshot(),
    authorizeWithClientQuota: false,
    confirmPhrase: OWNER_SELF_REMINDER_CONFIRM_PHRASE,
    oneshotId: `${OWNER_SELF_REMINDER_ONESHOT_PREFIX}test0001`,
    killSwitchOpen: true,
    sentToday: 0,
    recipientCount: 1,
    appointmentId: OWNER_SELF_REMINDER_TEST_APPOINTMENT_ID,
    env: PREVIEW_ENV,
    nowMs: NOW,
    ...overrides,
  });
}

describe("Phase 2E-8 Owner-self reminder consent + oneshot", () => {
  it("stays closed and never designates a LINE userId", () => {
    expect(LINE_APPOINTMENT_REMINDER_OWNER_SELF_PUSH_OPEN).toBe(false);
    expect(LINE_APPOINTMENT_REMINDER_SEND_OPEN).toBe(false);
    expect(LINE_APPOINTMENT_REMINDER_CONTROLLED_PUSH_OPEN).toBe(false);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_TEST_PUSH_OPEN).toBe(false);
    expect(OWNER_SELF_REMINDER_KILL_SWITCH_OPEN).toBe(false);
    expect(allAppointmentReminderFlagsClosed()).toBe(true);
    expect(OWNER_SELF_REMINDER_ALLOWED_ORG_ID).toBe(ORG_BEAUTY_OS_TEST_ID);
    expect(OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID).toBe("2009219238");
    expect(OWNER_SELF_REMINDER_DAILY_LIMIT).toBe(1);
    expect(OWNER_SELF_REMINDER_GRANT_TTL_MS).toBe(24 * 60 * 60_000);
    const passed = evaluate();
    expect(passed.authorized).toBe(true);
    expect(passed.wouldSend).toBe(false);
    expect(passed.sent).toBe(false);
    expect(passed.reason).toBe("send_closed");
    expect(JSON.stringify(passed)).not.toContain(LINE_USER);
    expect(passed.audit.recipientHint).toBe("••••fc8c");
  });

  it("treats verified test-push bind as identity only, never as reminder consent", () => {
    expect(
      evaluateOwnerSelfIdentity({
        organizationId: ORG_BEAUTY_OS_TEST_ID,
        actorStaffUserId: "staff-001",
        evidence: evidence({ testPushEnabled: true }),
      }),
    ).toEqual({ ok: true });
    expect(
      evaluateOwnerSelfGrant({
        organizationId: ORG_BEAUTY_OS_TEST_ID,
        actorStaffUserId: "staff-001",
        channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
        evidence: evidence({ testPushEnabled: true }),
        grant: null,
      }),
    ).toMatchObject({ ok: false, reason: "not_consented" });
    expect(evaluate({ grant: null, oneshot: null }).reason).toBe("not_consented");
    expect(evaluate({ grant: null, oneshot: null, clientAcknowledged: true }).message).toMatch(
      /前端勾選不能代替伺服器授權列/,
    );
    expect(evaluate({ authorizeWithTestPushEnabled: true }).reason).toBe("not_consented");
    expect(evaluate({ grant: grant({ authorizedViaTestPush: true }) }).reason).toBe("not_consented");
  });

  it("authorizes identity plus a valid independent grant, but still does not send", () => {
    const decision = evaluate({
      evidence: evidence({ testPushEnabled: true }),
      grant: grant(),
      oneshot: oneshot(),
    });
    expect(decision.authorized).toBe(true);
    expect(decision.wouldSend).toBe(false);
    expect(decision.sent).toBe(false);
    expect(decision.audit.wouldSend).toBe(false);
    expect(decision.audit.sent).toBe(false);
    const view = buildOwnerSelfReminderView({
      organizationId: ORG_BEAUTY_OS_TEST_ID,
      evidence: evidence({ testPushEnabled: true }),
      grant: grant(),
      nowMs: NOW,
    });
    expect(view.independentConsent).toBe(true);
    expect(view.canSubmit).toBe(false);
    expect(view.sendOpen).toBe(false);
    expect(view.trustworthyRecipient).toBe(false);
    expect(view.ownerBindReusableAsReminder).toBe(false);
  });

  it("refuses revoked, expired, rebound, foreign, and fake-customer grants", () => {
    expect(evaluate({ grant: grant({ revokedAt: "2026-10-14T08:30:00.000Z" }) }).reason).toBe(
      "not_consented",
    );
    expect(evaluate({ grant: grant({ expiresAt: "2026-10-14T08:00:00.000Z" }) }).reason).toBe(
      "not_consented",
    );
    expect(
      evaluate({
        grant: grant({ bindBoundAt: "2026-10-13T00:00:00.000Z" }),
      }).message,
    ).toMatch(/重新綁定後舊的測試同意已失效/);
    expect(evaluate({ actorStaffUserId: "staff-other" }).reason).toBe("unauthorized");
    expect(
      evaluate({
        grant: grant({ organizationId: ORG_ENJOYE_ID, staffUserId: "staff-001" }),
      }).reason,
    ).toBe("unauthorized");
    expect(evaluate({ organizationId: ORG_ENJOYE_ID }).reason).toBe("unauthorized");
    expect(evaluate({ fakeCustomerId: OWNER_SELF_REMINDER_FAKE_CUSTOMER_ID }).reason).toBe(
      "invalid_recipient",
    );
    expect(evaluate({ fakeCustomerId: CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID }).reason).toBe(
      "invalid_recipient",
    );
    expect(evaluate({ plaintextLineUserId: LINE_USER }).reason).toBe("invalid_recipient");
    expect(evaluate({ evidence: evidence({ keyId: "k-fake-2d2" }) }).reason).toBe("unbound");
    expect(evaluate({ evidence: evidence({ boundAt: null }) }).reason).toBe("unbound");
    expect(evaluate({ evidence: null }).reason).toBe("unbound");
  });

  it("hides the panel on other orgs and never lets the live view submit", () => {
    expect(isOwnerSelfReminderPanelVisible(ORG_BEAUTY_OS_TEST_ID)).toBe(true);
    expect(isOwnerSelfReminderPanelVisible(ORG_ENJOYE_ID)).toBe(false);
    const view = buildOwnerSelfReminderView({
      organizationId: ORG_BEAUTY_OS_TEST_ID,
      evidence: evidence({ testPushEnabled: true }),
      grant: null,
    });
    expect(view.trustworthyRecipient).toBe(false);
    expect(view.ownerBindReusableAsReminder).toBe(false);
    expect(view.independentConsent).toBe(false);
    expect(view.canSubmit).toBe(false);
    expect(view.sendOpen).toBe(false);
    expect(JSON.stringify(view)).not.toContain(LINE_USER);
  });

  it("refuses reused oneshots, recipient changes, unknown quota, and Production", () => {
    expect(evaluate({ env: { ...PREVIEW_ENV, VERCEL_ENV: "production" } }).reason).toBe("send_closed");
    expect(evaluate({ channelId: "2000000000" }).reason).toBe("unauthorized");
    expect(evaluate({ recipientCount: 2 }).reason).toBe("invalid_input");
    expect(evaluate({ confirmPhrase: "發送" }).reason).toBe("invalid_input");
    expect(evaluate({ oneshotConsumed: true }).reason).toBe("duplicate");
    expect(evaluate({ oneshot: oneshot({ status: "claimed", claimedAt: "2026-10-14T09:01:00.000Z" }) }).reason).toBe(
      "duplicate",
    );
    expect(
      evaluate({
        oneshot: oneshot({ bindBoundAt: "2026-10-11T00:00:00.000Z" }),
      }).message,
    ).toMatch(/不能在更改收件者後重用/);
    expect(evaluate({ sentToday: 1 }).reason).toBe("quota_exceeded");
    expect(evaluate({ killSwitchOpen: false }).reason).toBe("send_closed");
    expect(evaluate({ channelInflight: true }).reason).toBe("inflight");
    expect(evaluate({ trustedQuotaSnapshot: null }).reason).toBe("quota_exceeded");
    expect(newOwnerSelfReminderOneshotId(() => "aaaaaaaa-bbbb-cccc-dddd")).toMatch(/^laros-/);
    expect(newOwnerSelfReminderGrantId(() => "aaaaaaaa-bbbb-cccc-dddd")).toMatch(/^lorg-/);
    const drafted = createOwnerSelfReminderGrantDraft({
      organizationId: ORG_BEAUTY_OS_TEST_ID,
      staffUserId: "staff-001",
      evidence: evidence(),
      nowMs: NOW,
      random: () => "aaaaaaaa-bbbb-cccc-dddd",
    });
    expect(drafted.authorizedViaTestPush).toBe(false);
    expect(createOwnerSelfReminderOneshotDraft({ grant: drafted, nowMs: NOW }).id).toMatch(/^laros-/);
  });

  it("does not retry timeout, 5xx, or pending confirmation", () => {
    expect(
      ownerSelfReminderRefusesRetry({
        previousStatus: "pending_confirmation",
        previousErrorClass: "timeout",
      }),
    ).toBe(true);
    expect(ownerSelfReminderRefusesRetry({ previousHttpStatus: 503 })).toBe(true);
    expect(evaluate({ previousErrorClass: "timeout" }).reason).toBe("duplicate");
    expect(evaluate({ previousHttpStatus: 500 }).reason).toBe("duplicate");
    expect(
      evaluateOwnerSelfOneshotClaim({
        oneshot: oneshot({ status: "pending_confirmation" }),
        grant: grant(),
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "duplicate" });
  });

  it("keeps owner-self design off LINE APIs, off published SQL, and off Broadcast", () => {
    expect(source("lib/line/automations/appointment-reminder-owner-self-push.ts")).not.toMatch(
      /executeCustomerLinePushHttp|api\.line\.me|multicast|executeLineBroadcastHttp/,
    );
    expect(source("lib/line/automations/appointment-reminder-actions.ts")).not.toMatch(
      /executeCustomerLinePushHttp|api\.line\.me|multicast/,
    );
    expect(source("lib/line/automations/appointment-reminder-actions.ts")).toMatch(/grant: null/);
    expect(source("lib/line/automations/appointment-reminder-actions.ts")).toMatch(
      /trustedQuotaSnapshot: null/,
    );
    expect(source("lib/line/automations/appointment-reminder-actions.ts")).toMatch(
      /authorizeWithTestPushEnabled: false/,
    );
    expect(source("lib/line/automations/appointment-reminder-actions.ts")).toMatch(
      /killSwitchOpen: OWNER_SELF_REMINDER_KILL_SWITCH_OPEN/,
    );
    expect(source("lib/line/automations/appointment-reminder-actions.ts")).not.toMatch(
      /grant_line_owner_self_reminder_test|claim_line_owner_self_reminder_oneshot/,
    );
    const ui = source("features/line/automations/LineOwnerSelfReminderCard.tsx");
    expect(ui).toMatch(/data-line-owner-self-reminder/);
    expect(ui).toMatch(/OWNER_SELF_REMINDER_CONFIRM_PHRASE/);
    expect(ui).toMatch(/LINE_OWNER_SELF_ONCE_ONLY_LABEL/);
    expect(ui).toMatch(/data-line-owner-self-ack/);
    expect(ui).not.toMatch(/localStorage|indexedDB/);
    expect(ui).not.toMatch(/U[0-9a-f]{32}|line_user_id_cipher|lineUserId/);
    expect(source("features/line/automations/LineAutomationsWorkspace.tsx")).toMatch(
      /LineOwnerSelfReminderCard/,
    );
    expect(source("app/api/line/webhook/[organizationId]/[publicToken]/route.ts")).toMatch(
      /processLineWebhookCustomerAutomation/,
    );
    expect(source("features/line/LineBroadcastCenter.tsx")).not.toMatch(
      /OwnerSelfReminder|laros-|lorg-/,
    );
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
  });

  it("keeps the grant SQL as an unpublished draft", () => {
    expect(OWNER_SELF_REMINDER_SQL_DRAFT).toBe(
      "supabase/drafts/20261014180000_line_owner_self_reminder_grant.sql",
    );
    const sql = source(OWNER_SELF_REMINDER_SQL_DRAFT);
    expect(sql).toMatch(/DRAFT ONLY\. DO NOT APPLY/);
    expect(sql).toMatch(/Migration never inserts a grant, oneshot, or quota snapshot row/);
    expect(sql).toMatch(/lorg-%/);
    expect(sql).toMatch(/laros-%/);
    expect(sql).toMatch(/org-beauty-os-test/);
    expect(sql).toMatch(/2009219238/);
    expect(sql).toMatch(/owner_self_reminder_test_once/);
    expect(sql).toMatch(/apt-2e7-owner-self/);
    expect(sql).toMatch(/authorized_via_test_push boolean not null default false/);
    expect(sql).toMatch(/pg_advisory_xact_lock\(870121/);
    expect(sql).toMatch(/for update/i);
    expect(sql).toMatch(/LINE 額度未知時拒絕發送/);
    expect(sql).toMatch(/不會重送/);
    expect(sql).not.toMatch(/api\.line\.me|multicast|broadcast\(/i);
    expect(sql).not.toMatch(/values\s*\(\s*'lorg-/i);
    expect(sql).not.toMatch(/values\s*\(\s*'laros-/i);
    expect(source("lib/persistence/fresh-migration-chain.isolation.test.ts")).not.toMatch(
      /20261014180000_line_owner_self_reminder_grant/,
    );
    expect(source("supabase/drafts/README.md")).toMatch(/Do not apply these drafts to Preview or Production/);
  });
});

describe("Phase 2E-8 Owner-self authorization hardening", () => {
  it("refuses forged client quota and requires a service-role snapshot", () => {
    expect(
      evaluateOwnerSelfTrustedQuota({
        authorizeWithClientQuota: true,
        snapshot: trustedSnapshot(),
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "quota_exceeded" });
    expect(
      evaluate({
        trustedQuotaSnapshot: null,
        authorizeWithClientQuota: true,
        lineQuota: { known: true, type: "none", limit: null, usage: 0, remaining: null, label: "forged" },
      }).message,
    ).toMatch(/不能信任呼叫端自填的 LINE 額度/);
    expect(evaluate({ trustedQuotaSnapshot: null }).reason).toBe("quota_exceeded");
    expect(
      evaluate({
        trustedQuotaSnapshot: trustedSnapshot({ channelId: "2000000000" }),
      }).reason,
    ).toBe("quota_exceeded");
    expect(evaluate().authorized).toBe(true);
    expect(evaluate().wouldSend).toBe(false);
  });

  it("refuses non-self revoke, cross-org rows, client grants, and post-revoke claims", () => {
    expect(
      evaluateOwnerSelfRevoke({
        organizationId: ORG_BEAUTY_OS_TEST_ID,
        actorStaffUserId: "staff-other",
        grant: grant(),
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      evaluateOwnerSelfRevoke({
        organizationId: ORG_ENJOYE_ID,
        actorStaffUserId: "staff-001",
        grant: grant(),
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(evaluate({ trustClientGrant: true }).reason).toBe("not_consented");
    expect(
      evaluate({
        oneshot: oneshot({
          organizationId: ORG_ENJOYE_ID,
          staffUserId: "staff-001",
        }),
      }).reason,
    ).toBe("duplicate");
    expect(
      evaluate({
        grant: grant({ revokedAt: "2026-10-14T08:30:00.000Z" }),
        oneshot: oneshot(),
      }).reason,
    ).toBe("not_consented");
    expect(
      evaluateOwnerSelfOneshotClaim({
        grant: grant({ revokedAt: "2026-10-14T08:30:00.000Z" }),
        oneshot: oneshot(),
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "not_consented" });
  });

  it("keeps claim RPC privilege-locked and aligned with Broadcast Channel lock", () => {
    const sql = source(OWNER_SELF_REMINDER_SQL_DRAFT);
    const lock = ownerSelfReminderChannelLockSpec();
    expect(lock.namespace).toBe(870121);
    expect(lock.channelId).toBe("2009219238");
    expect(lock.lockAllOrgsOnChannel).toBe(true);
    expect(lock.usesBroadcastInflight).toBe(true);
    expect(sql).toMatch(/pg_advisory_xact_lock\(870121, hashtext\(v_channel_before\)\)/);
    expect(sql).toMatch(/order by a\.organization_id/);
    expect(sql).toMatch(/line_broadcast_channel_has_inflight\(v_channel_id\)/);
    expect(sql).toMatch(/line_owner_self_reminder_service_role_call_allowed/);
    expect(sql).toMatch(
      /revoke all on function public\.claim_line_owner_self_reminder_oneshot\(text, text, text, text, text, text\)[\s\S]*authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.claim_line_owner_self_reminder_oneshot\(text, text, text, text, text, text\)[\s\S]*service_role/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.record_line_owner_self_reminder_quota_snapshot\(text, boolean, text, integer, timestamptz\)[\s\S]*authenticated/,
    );
    expect(sql).not.toMatch(
      /create or replace function public\.claim_line_owner_self_reminder_oneshot\([\s\S]*p_quota_known/,
    );
    expect(sql).toMatch(/source = 'service_role'/);
    expect(sql).toMatch(/非本人不能撤回這次店長本人測試同意/);
    expect(sql).toMatch(/app\.beauty_os_runtime/);
    expect(sql).toMatch(/店長本人測試授權不可在 Production 執行/);
    expect(source("lib/line/automations/appointment-reminder-actions.ts")).not.toMatch(
      /createServiceRoleClient|record_line_owner_self_reminder_quota_snapshot/,
    );
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_APPOINTMENT_REMINDER_OWNER_SELF_PUSH_OPEN).toBe(false);
    expect(OWNER_SELF_REMINDER_KILL_SWITCH_OPEN).toBe(false);
    expect(LINE_APPOINTMENT_REMINDER_SEND_OPEN).toBe(false);
  });
});
