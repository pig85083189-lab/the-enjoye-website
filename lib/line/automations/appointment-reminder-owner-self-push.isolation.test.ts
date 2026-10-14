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
  OWNER_SELF_REMINDER_KILL_SWITCH_OPEN,
  OWNER_SELF_REMINDER_ONESHOT_PREFIX,
  buildOwnerSelfReminderView,
  evaluateOwnerSelfIdentity,
  evaluateOwnerSelfReminderPush,
  isOwnerSelfReminderPanelVisible,
  newOwnerSelfReminderOneshotId,
  ownerSelfReminderRefusesRetry,
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
import { unknownLineQuota } from "@/lib/line/line-quota";
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
    testPushEnabled: false,
    ...overrides,
  };
}

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateOwnerSelfReminderPush({
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    actorStaffUserId: "staff-001",
    channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
    evidence: evidence(),
    independentConsent: true,
    confirmPhrase: OWNER_SELF_REMINDER_CONFIRM_PHRASE,
    oneshotId: `${OWNER_SELF_REMINDER_ONESHOT_PREFIX}test0001`,
    killSwitchOpen: true,
    sentToday: 0,
    recipientCount: 1,
    lineQuota: { known: true, type: "none", limit: null, usage: 0, remaining: null, label: "unlimited" },
    quotaCheckedAt: new Date(NOW).toISOString(),
    env: PREVIEW_ENV,
    nowMs: NOW,
    ...overrides,
  });
}

describe("Phase 2E-6 Owner-self reminder Push", () => {
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
    const passed = evaluate();
    expect(passed.authorized).toBe(true);
    expect(passed.wouldSend).toBe(false);
    expect(passed.sent).toBe(false);
    expect(JSON.stringify(passed)).not.toContain(LINE_USER);
    expect(passed.audit.recipientHint).toBe("••••fc8c");
  });

  it("refuses test-push reuse, fake customer, plaintext id, and role-only consent", () => {
    expect(
      evaluateOwnerSelfIdentity({
        organizationId: ORG_BEAUTY_OS_TEST_ID,
        actorStaffUserId: "staff-001",
        evidence: evidence({ testPushEnabled: true }),
        independentConsent: true,
      }),
    ).toMatchObject({ ok: false, reason: "invalid_recipient" });
    expect(
      evaluate({
        evidence: evidence({ testPushEnabled: true }),
        testPushRecipientReused: true,
      }).reason,
    ).toBe("invalid_recipient");
    expect(evaluate({ fakeCustomerId: OWNER_SELF_REMINDER_FAKE_CUSTOMER_ID }).reason).toBe(
      "invalid_recipient",
    );
    expect(evaluate({ fakeCustomerId: CONTROLLED_REMINDER_PUSH_DESIGNATED_CUSTOMER_ID }).reason).toBe(
      "invalid_recipient",
    );
    expect(evaluate({ plaintextLineUserId: LINE_USER }).reason).toBe("invalid_recipient");
    expect(evaluate({ independentConsent: false }).reason).toBe("not_consented");
    expect(evaluate({ actorStaffUserId: "staff-other" }).reason).toBe("unauthorized");
    expect(evaluate({ evidence: evidence({ keyId: "k-fake-2d2" }) }).reason).toBe("unbound");
    expect(evaluate({ evidence: null }).reason).toBe("unbound");
  });

  it("hides the panel on other orgs and never lets the view submit", () => {
    expect(isOwnerSelfReminderPanelVisible(ORG_BEAUTY_OS_TEST_ID)).toBe(true);
    expect(isOwnerSelfReminderPanelVisible(ORG_ENJOYE_ID)).toBe(false);
    const view = buildOwnerSelfReminderView({
      organizationId: ORG_BEAUTY_OS_TEST_ID,
      evidence: evidence({ testPushEnabled: true }),
    });
    expect(view.trustworthyRecipient).toBe(false);
    expect(view.ownerBindReusableAsReminder).toBe(false);
    expect(view.independentConsent).toBe(false);
    expect(view.canSubmit).toBe(false);
    expect(view.sendOpen).toBe(false);
    expect(JSON.stringify(view)).not.toContain(LINE_USER);
  });

  it("refuses Production, foreign orgs, lists, reused oneshots, and closed kill switch", () => {
    expect(evaluate({ env: { ...PREVIEW_ENV, VERCEL_ENV: "production" } }).reason).toBe("send_closed");
    expect(evaluate({ organizationId: ORG_ENJOYE_ID }).reason).toBe("unauthorized");
    expect(evaluate({ channelId: "2000000000" }).reason).toBe("unauthorized");
    expect(evaluate({ recipientCount: 2 }).reason).toBe("invalid_input");
    expect(evaluate({ confirmPhrase: "發送" }).reason).toBe("invalid_input");
    expect(evaluate({ oneshotConsumed: true }).reason).toBe("duplicate");
    expect(evaluate({ sentToday: 1 }).reason).toBe("quota_exceeded");
    expect(evaluate({ killSwitchOpen: false }).reason).toBe("send_closed");
    expect(evaluate({ channelInflight: true }).reason).toBe("inflight");
    expect(evaluate({ lineQuota: unknownLineQuota("本階段不查詢 LINE 額度") }).reason).toBe(
      "quota_exceeded",
    );
    expect(newOwnerSelfReminderOneshotId(() => "aaaaaaaa-bbbb-cccc-dddd")).toMatch(/^laros-/);
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
  });

  it("keeps owner-self design off LINE APIs and off Production webhook changes", () => {
    expect(source("lib/line/automations/appointment-reminder-owner-self-push.ts")).not.toMatch(
      /executeCustomerLinePushHttp|api\.line\.me|multicast|broadcast/,
    );
    expect(source("lib/line/automations/appointment-reminder-actions.ts")).not.toMatch(
      /executeCustomerLinePushHttp|api\.line\.me|multicast/,
    );
    expect(source("lib/line/automations/appointment-reminder-actions.ts")).toMatch(
      /independentConsent: false/,
    );
    expect(source("lib/line/automations/appointment-reminder-actions.ts")).toMatch(
      /killSwitchOpen: OWNER_SELF_REMINDER_KILL_SWITCH_OPEN/,
    );
    const ui = source("features/line/automations/LineOwnerSelfReminderCard.tsx");
    expect(ui).toMatch(/data-line-owner-self-reminder/);
    expect(ui).toMatch(/OWNER_SELF_REMINDER_CONFIRM_PHRASE/);
    expect(ui).not.toMatch(/U[0-9a-f]{32}|line_user_id_cipher|lineUserId/);
    expect(source("features/line/automations/LineAutomationsWorkspace.tsx")).toMatch(
      /LineOwnerSelfReminderCard/,
    );
    expect(source("app/api/line/webhook/[organizationId]/[publicToken]/route.ts")).toMatch(
      /processLineWebhookCustomerAutomation/,
    );
  });
});
