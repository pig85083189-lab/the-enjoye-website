// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateAppointmentReminderCronRpcResults,
} from "@/lib/line/automations/appointment-reminder-cron";
import {
  interpretStartLineCustomerBindResult,
  packCustomerBindIdentity,
  selectCustomerConsentEvent,
  selectCustomerUnsubscribeEvent,
} from "@/lib/line/automations/customer-line-bind";
import { processLineWebhookCustomerAutomation } from "@/lib/line/automations/customer-line-webhook";
import { hashLineUserId } from "@/lib/line/line-bind";
import { LINE_BROADCAST_SEND_OPEN, LINE_CREDENTIAL_KEY_ENV } from "@/lib/line/line-flag";
import { applyLineBroadcastChannelClaimStep, sharedChannelFixtureAccounts } from "@/lib/line/line-channel-lock";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";

const ROOT = process.cwd();
const LINE_USER = "U0123456789abcdef0123456789abcdef";
const TEST_LINE_CREDENTIAL_KEY = Buffer.alloc(32, 11).toString("base64");
const KEY_ENV = { [LINE_CREDENTIAL_KEY_ENV]: TEST_LINE_CREDENTIAL_KEY };
process.env.BEAUTY_OS_LINE_CREDENTIAL_KEY ??= TEST_LINE_CREDENTIAL_KEY;

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function webhookBody(input: {
  text?: string | null;
  eventType?: string;
  eventId?: string;
  isRedelivery?: boolean;
}): string {
  return JSON.stringify({
    events: [
      {
        type: input.eventType ?? "message",
        webhookEventId: input.eventId,
        deliveryContext: { isRedelivery: input.isRedelivery === true },
        source: { type: "user", userId: LINE_USER },
        message: input.text ? { type: "text", text: input.text } : undefined,
      },
    ],
  });
}

describe("Phase 2C HMAC LINE userId hash", () => {
  it("uses the server credential key and never equals unsalted SHA-256", () => {
    const hmac = hashLineUserId(ORG_ENJOYE_ID, LINE_USER, KEY_ENV);
    const otherOrg = hashLineUserId(ORG_LUMIERE_ID, LINE_USER, KEY_ENV);
    const unsalted = createHash("sha256").update(`${ORG_ENJOYE_ID}:${LINE_USER}`, "utf8").digest("hex");
    expect(hmac).toHaveLength(64);
    expect(hmac).not.toEqual(unsalted);
    expect(hmac).not.toEqual(otherOrg);
    expect(hashLineUserId(ORG_ENJOYE_ID, LINE_USER, KEY_ENV)).toBe(hmac);
    expect(hashLineUserId(ORG_ENJOYE_ID, LINE_USER, {})).toBe("");
    expect(hashLineUserId(ORG_ENJOYE_ID, LINE_USER, { [LINE_CREDENTIAL_KEY_ENV]: "short" })).toBe("");
    const packed = packCustomerBindIdentity({
      organizationId: ORG_ENJOYE_ID,
      userId: LINE_USER,
      cipher: "v1.cipher",
      keyId: "k1",
      env: KEY_ENV,
    });
    expect(packed.hash).toBe(hmac);
    expect(packed.hint).toMatch(/^••••/);
    expect(packed.hash).not.toContain(LINE_USER);
  });
});

describe("Phase 2C bind versus reminder consent", () => {
  it("treats bind, consent, and unsubscribe as separate customer texts", async () => {
    expect(
      selectCustomerConsentEvent([
        { sourceType: "user", userId: LINE_USER, text: "同意預約提醒", eventType: "message" },
      ])?.userId,
    ).toBe(LINE_USER);
    expect(
      selectCustomerUnsubscribeEvent([
        { sourceType: "user", userId: LINE_USER, text: "退訂", eventType: "message" },
      ])?.userId,
    ).toBe(LINE_USER);

    const bind = await processLineWebhookCustomerAutomation({
      organizationId: ORG_ENJOYE_ID,
      rawBody: webhookBody({ text: "ABCDEF12" }),
      encryptUserId: (userId) => ({ cipher: `v1.${userId}`, keyId: "k1" }),
      consumeBind: async (input) => {
        expect(input.hash).toHaveLength(64);
        return { bound: true };
      },
      setConsent: async () => {
        throw new Error("bind must not set consent");
      },
      markUnsubscribed: async () => {
        throw new Error("bind must not unsubscribe");
      },
      markUnbound: async () => {
        throw new Error("bind must not unbind");
      },
      markBlocked: async () => {
        throw new Error("bind must not block");
      },
    });
    expect(bind).toEqual({
      bound: true,
      consented: false,
      unsubscribed: false,
      blocked: false,
      unbound: false,
      duplicate: false,
    });

    let consentedHash = "";
    const consent = await processLineWebhookCustomerAutomation({
      organizationId: ORG_ENJOYE_ID,
      rawBody: webhookBody({ text: "CONSENT", eventId: "evt-consent-1" }),
      encryptUserId: (userId) => ({ cipher: `v1.${userId}`, keyId: "k1" }),
      consumeBind: async () => {
        throw new Error("consent must not consume a bind code");
      },
      setConsent: async (hash, optIn) => {
        consentedHash = hash;
        expect(optIn).toBe(true);
      },
      markUnsubscribed: async () => {
        throw new Error("consent must not unsubscribe");
      },
      markUnbound: async () => {
        throw new Error("consent must not unbind");
      },
      markBlocked: async () => {
        throw new Error("consent must not block");
      },
      claimEvent: async (eventId) => {
        expect(eventId).toBe("evt-consent-1");
        return { duplicate: false };
      },
    });
    expect(consent.consented).toBe(true);
    expect(consent.bound).toBe(false);
    expect(consentedHash).toHaveLength(64);
  });

  it("dedupes consent and unsubscribe webhook events", async () => {
    const replay = await processLineWebhookCustomerAutomation({
      organizationId: ORG_ENJOYE_ID,
      rawBody: webhookBody({ text: "同意預約提醒", eventId: "evt-dup" }),
      encryptUserId: (userId) => ({ cipher: `v1.${userId}`, keyId: "k1" }),
      consumeBind: async () => ({ bound: false }),
      setConsent: async () => {
        throw new Error("duplicate consent must not apply");
      },
      markUnsubscribed: async () => {
        throw new Error("duplicate must not unsubscribe");
      },
      markUnbound: async () => {
        throw new Error("duplicate must not unbind");
      },
      markBlocked: async () => {
        throw new Error("duplicate must not block");
      },
      claimEvent: async () => ({ duplicate: true }),
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.consented).toBe(false);

    const redelivery = await processLineWebhookCustomerAutomation({
      organizationId: ORG_ENJOYE_ID,
      rawBody: webhookBody({ text: "退訂", isRedelivery: true }),
      encryptUserId: (userId) => ({ cipher: `v1.${userId}`, keyId: "k1" }),
      consumeBind: async () => ({ bound: false }),
      setConsent: async () => {
        throw new Error("redelivery must not apply");
      },
      markUnsubscribed: async () => {
        throw new Error("redelivery must not unsubscribe");
      },
      markUnbound: async () => {
        throw new Error("redelivery must not unbind");
      },
      markBlocked: async () => {
        throw new Error("redelivery must not block");
      },
    });
    expect(redelivery.duplicate).toBe(true);
    expect(redelivery.unsubscribed).toBe(false);
  });

  it("maps bind start rate limits without exposing hashes", () => {
    expect(
      interpretStartLineCustomerBindResult({
        error: null,
        data: { ok: false, reason: "rate_limited" },
      }).ok,
    ).toBe(false);
    expect(
      interpretStartLineCustomerBindResult({
        error: null,
        data: { ok: false, reason: "attempt_limited" },
      }),
    ).toMatchObject({ ok: false, reason: "attempt_limited" });
    expect(
      interpretStartLineCustomerBindResult({
        error: null,
        data: { ok: true, code: "ABCDEF12", expires_at: "2026-10-13T12:00:00.000Z" },
      }),
    ).toEqual({
      ok: true,
      code: "ABCDEF12",
      expiresAt: "2026-10-13T12:00:00.000Z",
    });
  });
});

describe("Phase 2C cron RPC fail-closed", () => {
  it("does not report success when finalize or dry-run RPC errors", () => {
    expect(
      evaluateAppointmentReminderCronRpcResults({
        finalizeError: { message: "boom" },
        tickError: null,
        tickData: { checked: 3 },
      }),
    ).toEqual({ ok: false, message: "Dry-run finalize 失敗，沒有發送 LINE" });
    expect(
      evaluateAppointmentReminderCronRpcResults({
        finalizeError: null,
        tickError: { message: "rpc" },
        tickData: { checked: 3 },
      }),
    ).toEqual({ ok: false, message: "Dry-run RPC 失敗，沒有發送 LINE" });
    expect(
      evaluateAppointmentReminderCronRpcResults({
        finalizeError: null,
        tickError: null,
        tickData: { checked: 4 },
      }),
    ).toEqual({ ok: true, checked: 4 });
    expect(source("app/api/cron/line-appointment-reminders/route.ts")).toMatch(/ok: false/);
    expect(source("app/api/cron/line-appointment-reminders/route.ts")).not.toMatch(
      /executeCustomerLinePushHttp|\/v2\/bot\/message\/push/,
    );
  });
});

describe("Phase 2C tenant, permission, race, and Broadcast regression", () => {
  it("keeps reminder hashes, workspace counts, and Broadcast send isolated", () => {
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    const claimed = applyLineBroadcastChannelClaimStep(
      {
        channelId: "2009219238",
        accounts: sharedChannelFixtureAccounts(),
        rows: [],
        permits: { [ORG_ENJOYE_ID]: false },
      },
      {
        organizationId: ORG_ENJOYE_ID,
        requestId: "lbrq-broadcastok0001",
        textBody: "群發",
        sendMode: "formal",
        quotaKnown: true,
        quotaRemaining: null,
        quotaCheckedAt: new Date().toISOString(),
      },
    );
    expect(claimed.claimed).toBe(true);

    const workspace = source("features/line/automations/LineAutomationsWorkspace.tsx");
    const actions = source("lib/line/automations/appointment-reminder-actions.ts");
    const copy = source("lib/line/automations/copy.ts");
    const sql = source("supabase/migrations/20261013140000_line_appointment_reminder_phase_2c.sql");
    expect(workspace).toMatch(/consentCount/);
    expect(workspace).not.toMatch(/line_user_id_hash|hashLineUserId/);
    expect(workspace).not.toMatch(/U[0-9a-f]{32}/i);
    expect(actions).toMatch(/interpretStartLineCustomerBindResult/);
    expect(actions).not.toMatch(/line_user_id_hash/);
    expect(copy).toMatch(/不會自動同意預約提醒/);
    expect(copy).not.toMatch(/傳送即表示同意/);
    expect(sql).toMatch(/user_is_org_owner/);
    expect(sql).toMatch(/session_user not in \('postgres', 'service_role', 'supabase_admin'\)/);
    expect(sql).toMatch(/for update/);
    expect(sql).toMatch(/consent_count/);
    expect(sql).not.toMatch(/api\.line\.me|customers\.line_user_id/);
    expect(source("lib/line/line-flag.ts")).toMatch(/bfzquejrtgqzzarhkiya\.supabase\.co/);
    expect(source("lib/line/line-flag.ts")).toMatch(/knccefcxncglgpmvgqlp\.supabase\.co/);
    expect(source("scripts/line-appointment-reminder-local-pg.sh")).toMatch(
      /20261013140000_line_appointment_reminder_phase_2c\.sql/,
    );
    expect(source("scripts/line-appointment-reminder-local-pg.sh")).toMatch(
      /20261014120000_line_appointment_reminder_postgrest_service_role\.sql/,
    );
    expect(source("scripts/line-appointment-reminder-local-pg.sh")).not.toMatch(
      /bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/,
    );
  });
});
