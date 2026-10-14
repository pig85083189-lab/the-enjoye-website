// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateAppointmentReminderAudience } from "@/lib/line/automations/appointment-reminder-bindings";
import {
  CONTROLLED_REMINDER_PUSH_ALLOWED_ORG_ID,
  CONTROLLED_REMINDER_PUSH_CONFIRM_PHRASE,
  CONTROLLED_REMINDER_PUSH_DAILY_LIMIT,
  CONTROLLED_REMINDER_PUSH_ONESHOT_PREFIX,
  LINE_APPOINTMENT_REMINDER_CONTROLLED_PUSH_OPEN,
  dueWindowHoursBefore3StartAt,
  evaluateControlledAppointmentReminderPush,
  upcomingHoursBefore3StartAt,
} from "@/lib/line/automations/appointment-reminder-controlled-push";
import {
  LINE_APPOINTMENT_REMINDER_SEND_OPEN,
  allAppointmentReminderFlagsClosed,
} from "@/lib/line/automations/appointment-reminder-flag";
import { appointmentReminderJobIsDue } from "@/lib/line/automations/appointment-reminder-jobs";
import {
  CUSTOMER_CONSENT_PATTERN,
  CUSTOMER_UNBIND_PATTERN,
  CUSTOMER_UNSUBSCRIBE_PATTERN,
} from "@/lib/line/automations/customer-line-bind";
import { LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST, LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import { ORG_BEAUTY_OS_TEST_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const ROOT = process.cwd();
const LINE_USER = "U0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-10-14T07:30:00.000Z");
const PREVIEW_ENV = {
  VERCEL_ENV: "preview",
  NEXT_PUBLIC_SUPABASE_URL: `https://${LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST}`,
};

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function appointment() {
  return {
    id: "apt-2e3-due-0001",
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    customerId: "cust-2e3-test-1",
    customerName: "【假資料】2E3",
    serviceId: "svc-2d2-fake-facial",
    serviceName: "假課程",
    startAt: "2026-10-14T10:28:00.000Z",
    endAt: "2026-10-14T11:28:00.000Z",
    status: "BOOKED" as const,
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "laj-2e3due00000001",
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    appointmentId: "apt-2e3-due-0001",
    customerId: "cust-2e3-test-1",
    timingId: "hours_before_3" as const,
    fingerprint: "fp",
    scheduledFor: "2026-10-14T07:28:00.000Z",
    status: "scheduled" as const,
    requestId: "larq-2e3due00000001",
    createdAt: "2026-10-14T04:00:00.000Z",
    updatedAt: "2026-10-14T04:00:00.000Z",
    ...overrides,
  };
}

function binding(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    customerId: "cust-2e3-test-1",
    lineUserId: LINE_USER,
    lineUserIdHash: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
    verified: true,
    ...overrides,
  };
}

function preference(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    customerId: "cust-2e3-test-1",
    appointmentReminderOptIn: true,
    ...overrides,
  };
}

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateControlledAppointmentReminderPush({
    organizationId: ORG_BEAUTY_OS_TEST_ID,
    designatedCustomerId: "cust-2e3-test-1",
    appointment: appointment(),
    job: job(),
    binding: binding(),
    preference: preference(),
    confirmPhrase: CONTROLLED_REMINDER_PUSH_CONFIRM_PHRASE,
    oneshotId: `${CONTROLLED_REMINDER_PUSH_ONESHOT_PREFIX}test0001`,
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

describe("Phase 2E-3 controlled reminder Push design", () => {
  it("stays closed and never would-send even when every other gate passes", () => {
    expect(LINE_APPOINTMENT_REMINDER_CONTROLLED_PUSH_OPEN).toBe(false);
    expect(LINE_APPOINTMENT_REMINDER_SEND_OPEN).toBe(false);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(allAppointmentReminderFlagsClosed()).toBe(true);
    expect(CONTROLLED_REMINDER_PUSH_ALLOWED_ORG_ID).toBe(ORG_BEAUTY_OS_TEST_ID);
    expect(CONTROLLED_REMINDER_PUSH_DAILY_LIMIT).toBe(1);
    const passed = evaluate();
    expect(passed.authorized).toBe(true);
    expect(passed.wouldSend).toBe(false);
    expect(passed.sent).toBe(false);
    expect(passed.reason).toBe("send_closed");
    expect(JSON.stringify(passed)).not.toContain(LINE_USER);
    expect(passed.audit.recipientHint.startsWith("••••")).toBe(true);
  });

  it("refuses Production, foreign orgs, lists, reused oneshots, and closed kill switch", () => {
    expect(evaluate({ env: { ...PREVIEW_ENV, VERCEL_ENV: "production" } }).reason).toBe(
      "send_closed",
    );
    expect(evaluate({ organizationId: ORG_ENJOYE_ID }).reason).toBe("unauthorized");
    expect(evaluate({ recipientCount: 2 }).reason).toBe("invalid_input");
    expect(evaluate({ designatedCustomerId: "cust-other" }).reason).toBe("unauthorized");
    expect(evaluate({ confirmPhrase: "發送" }).reason).toBe("invalid_input");
    expect(evaluate({ oneshotConsumed: true }).reason).toBe("duplicate");
    expect(evaluate({ sentToday: 1 }).reason).toBe("quota_exceeded");
    expect(evaluate({ killSwitchOpen: false }).reason).toBe("send_closed");
    expect(evaluate({ channelInflight: true }).reason).toBe("inflight");
  });

  it("reuses audience gates so unbound / no-consent / blocked never authorize", () => {
    expect(evaluate({ binding: null }).reason).toBe("unbound");
    expect(evaluate({ binding: binding({ verified: false }) }).reason).toBe("unbound");
    expect(evaluate({ binding: binding({ unboundAt: "2026-10-14T00:00:00.000Z" }) }).reason).toBe(
      "unbound",
    );
    expect(evaluate({ binding: binding({ blockedAt: "2026-10-14T00:00:00.000Z" }) }).reason).toBe(
      "blocked",
    );
    expect(evaluate({ preference: preference({ appointmentReminderOptIn: false }) }).reason).toBe(
      "not_consented",
    );
    expect(
      evaluate({ preference: preference({ unsubscribedAt: "2026-10-14T00:00:00.000Z" }) }).reason,
    ).toBe("unsubscribed");
    expect(
      evaluateAppointmentReminderAudience({
        organizationId: ORG_BEAUTY_OS_TEST_ID,
        customerId: "cust-2e3-test-1",
        crmLineUserId: LINE_USER,
      }).skipReason,
    ).toBe("plaintext_line_id_refused");
  });

  it("computes a TEST hours_before_3 start that lands inside the due window", () => {
    const { startAt, fireAt } = dueWindowHoursBefore3StartAt(NOW, 120_000);
    expect(startAt.getTime() - fireAt.getTime()).toBe(3 * 60 * 60_000);
    expect(
      appointmentReminderJobIsDue({
        job: job({ scheduledFor: fireAt.toISOString() }),
        nowMs: NOW,
      }),
    ).toEqual({ due: true, expired: false });
  });

  it("schedules a persistable future hours_before_3 slot instead of a past_due fire", () => {
    const upcoming = upcomingHoursBefore3StartAt(NOW);
    expect(upcoming.fireAt.getTime()).toBeGreaterThan(NOW);
    expect(upcoming.startAt.getTime() - upcoming.fireAt.getTime()).toBe(3 * 60 * 60_000);
    expect(upcoming.waitMs).toBeGreaterThan(0);
    expect(
      appointmentReminderJobIsDue({
        job: job({ scheduledFor: upcoming.fireAt.toISOString() }),
        nowMs: NOW,
      }),
    ).toEqual({ due: false, expired: false });
  });

  it("keeps webhook bind, consent, unbind, and unsubscribe as separate official texts", () => {
    expect(CUSTOMER_CONSENT_PATTERN.test("同意預約提醒")).toBe(true);
    expect(CUSTOMER_UNSUBSCRIBE_PATTERN.test("退訂")).toBe(true);
    expect(CUSTOMER_UNBIND_PATTERN.test("解除綁定")).toBe(true);
    const webhook = source("lib/line/automations/customer-line-webhook.ts");
    expect(webhook).toMatch(/Bind never implies reminder consent/);
    expect(webhook).toMatch(/cannot run in the browser/);
    expect(webhook).toMatch(/Never accepts a client-supplied userId/);
    const sql2c = source("supabase/migrations/20261013140000_line_appointment_reminder_phase_2c.sql");
    expect(sql2c).toMatch(/bind_does_not_opt_in/);
    expect(sql2c).toMatch(/appointment_reminder_opt_in/);
    expect(sql2c).toMatch(/'consented', false/);
    expect(source("lib/line/automations/appointment-reminder-controlled-push.ts")).not.toMatch(
      /executeCustomerLinePushHttp|api\.line\.me|multicast|broadcast/,
    );
    expect(source("features/line/automations/LineAutomationsWorkspace.tsx")).not.toMatch(
      /U[0-9a-f]{32}|line_user_id_cipher/,
    );
  });
});
