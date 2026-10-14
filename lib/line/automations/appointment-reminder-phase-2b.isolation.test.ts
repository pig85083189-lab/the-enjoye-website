// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appointmentReminderCronMode, authorizeAppointmentReminderCron } from "@/lib/line/automations/appointment-reminder-cron";
import { evaluateAppointmentReminderDryRun } from "@/lib/line/automations/appointment-reminder-dry-run";
import {
  allAppointmentReminderFlagsClosed,
  isAppointmentReminderDryRunOpen,
  isAppointmentReminderPersistOpen,
  LINE_APPOINTMENT_REMINDER_SEND_OPEN,
} from "@/lib/line/automations/appointment-reminder-flag";
import {
  applyAppointmentReminderClaimStep,
  appointmentReminderClaimIsStale,
  finalizeStaleAppointmentReminderClaim,
  reminderChannelHasInflight,
} from "@/lib/line/automations/appointment-reminder-jobs";
import { createAppointmentReminderMemoryStore } from "@/lib/line/automations/appointment-reminder-store";
import {
  applyAppointmentReminderPlan,
} from "@/lib/line/automations/appointment-reminder-jobs";
import { planAppointmentReminderJobs } from "@/lib/line/automations/appointment-reminder-scheduler";
import { createDefaultAppointmentReminderRule } from "@/lib/line/automations/appointment-reminder-rules";
import { dispatchAppointmentReminderJob } from "@/lib/line/automations/appointment-reminder-dispatcher";
import { notifyAppointmentWrittenForReminders } from "@/lib/line/automations/appointment-reminder-write-hook";
import {
  evaluateCustomerBindCode,
  packCustomerBindIdentity,
  selectCustomerUnbindEvent,
  selectCustomerUnfollowEvent,
  selectCustomerUnsubscribeEvent,
} from "@/lib/line/automations/customer-line-bind";
import { processLineWebhookCustomerAutomation } from "@/lib/line/automations/customer-line-webhook";
import { hashLineUserId } from "@/lib/line/line-bind";
import { executeCustomerLinePushHttp } from "@/lib/line/automations/customer-line-push-adapter";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import { applyLineBroadcastChannelClaimStep, sharedChannelFixtureAccounts } from "@/lib/line/line-channel-lock";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";
import { taipeiLocalToUtcIso } from "@/lib/persistence/appointment-time";
import type { AppointmentReminderAppointment, AppointmentReminderJob } from "@/lib/line/automations/appointment-reminder-types";

const ROOT = process.cwd();
const LINE_USER = "U0123456789abcdef0123456789abcdef";
const OTHER_USER = "Uabcdef0123456789abcdef0123456789";
const TEST_LINE_CREDENTIAL_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.BEAUTY_OS_LINE_CREDENTIAL_KEY ??= TEST_LINE_CREDENTIAL_KEY;

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function appointment(overrides: Partial<AppointmentReminderAppointment> = {}): AppointmentReminderAppointment {
  return {
    id: "apt-future",
    organizationId: ORG_ENJOYE_ID,
    customerId: "cust-1",
    customerName: "林小姐",
    serviceId: "svc-1",
    serviceName: "美胸 SPA",
    locationName: "THE ENJOYE 台中店",
    startAt: taipeiLocalToUtcIso("2026-10-14", "16:00"),
    endAt: taipeiLocalToUtcIso("2026-10-14", "17:00"),
    status: "BOOKED",
    ...overrides,
  };
}

function enabledRule() {
  return {
    ...createDefaultAppointmentReminderRule(ORG_ENJOYE_ID),
    enabled: true,
    selectedTimingIds: ["day_before_morning" as const, "hours_before_3" as const],
  };
}

function scheduledJob(nowMs: number): AppointmentReminderJob {
  const store = createAppointmentReminderMemoryStore();
  const plan = planAppointmentReminderJobs({
    organizationId: ORG_ENJOYE_ID,
    appointment: appointment(),
    rule: enabledRule(),
    nowMs: Date.parse("2026-10-12T01:00:00.000Z"),
  });
  applyAppointmentReminderPlan(store, plan, Date.parse("2026-10-12T01:00:00.000Z"));
  const job = store.listJobs(ORG_ENJOYE_ID)[0];
  return { ...job, scheduledFor: new Date(nowMs - 60_000).toISOString() };
}

describe("Phase 2B cron secret and flags", () => {
  it("never trusts x-vercel-cron or short secrets", () => {
    const secret = "cron-secret-16ch";
    expect(
      authorizeAppointmentReminderCron({
        vercelCron: "1",
        env: { CRON_SECRET: secret, VERCEL_ENV: "preview" },
      }).ok,
    ).toBe(false);
    expect(
      authorizeAppointmentReminderCron({
        authorization: "Bearer short",
        env: { CRON_SECRET: "short" },
      }).ok,
    ).toBe(false);
    expect(
      authorizeAppointmentReminderCron({
        authorization: `Bearer ${secret}`,
        env: { CRON_SECRET: secret },
      }).ok,
    ).toBe(true);
    expect(appointmentReminderCronMode({})).toBe("closed");
    expect(LINE_APPOINTMENT_REMINDER_SEND_OPEN).toBe(false);
    expect(allAppointmentReminderFlagsClosed()).toBe(true);
    expect(
      isAppointmentReminderPersistOpen({
        env: { VERCEL_ENV: "production", BEAUTY_OS_LINE_APPOINTMENT_REMINDER_PERSIST_OPEN: "1" },
      }),
    ).toBe(false);
    expect(
      isAppointmentReminderDryRunOpen({
        env: { VERCEL_ENV: "production", BEAUTY_OS_LINE_APPOINTMENT_REMINDER_DRY_RUN_OPEN: "1" },
      }),
    ).toBe(false);
  });
});

describe("Phase 2B customer LINE identity", () => {
  it("uniqueness is org-scoped hash, never the mask hint", () => {
    const enjoye = hashLineUserId(ORG_ENJOYE_ID, LINE_USER);
    const lumiere = hashLineUserId(ORG_LUMIERE_ID, LINE_USER);
    expect(enjoye).toHaveLength(64);
    expect(enjoye).not.toEqual(lumiere);
    expect(enjoye).toEqual(hashLineUserId(ORG_ENJOYE_ID, LINE_USER));
    const packed = packCustomerBindIdentity({
      organizationId: ORG_ENJOYE_ID,
      userId: LINE_USER,
      cipher: "v1.cipher",
      keyId: "k1",
    });
    expect(packed.hash).toBe(enjoye);
    expect(packed.hint.startsWith("••••")).toBe(true);
    expect(packed.hash).not.toContain(packed.hint);
    expect(evaluateCustomerBindCode("ab cd ef 12")).toBe("ABCDEF12");
    expect(evaluateCustomerBindCode("not-a-code")).toBeNull();
  });

  it("binds only after a verified webhook code and honors unbind / unsubscribe / block", async () => {
    const events = {
      events: [
        {
          type: "message",
          source: { type: "user", userId: LINE_USER },
          message: { type: "text", text: "ABCDEF12" },
        },
      ],
    };
    const bound = await processLineWebhookCustomerAutomation({
      organizationId: ORG_ENJOYE_ID,
      rawBody: JSON.stringify(events),
      encryptUserId: (userId) => ({ cipher: `v1.${userId}`, keyId: "k1" }),
      consumeBind: async (input) => {
        expect(input.hash).toBe(hashLineUserId(ORG_ENJOYE_ID, LINE_USER));
        expect(input.hash).not.toBe(input.hint);
        expect(input.code).toBe("ABCDEF12");
        return { bound: true };
      },
      markUnsubscribed: async () => {
        throw new Error("unsubscribe must not run on bind");
      },
      markUnbound: async () => {
        throw new Error("unbind must not run on bind");
      },
      markBlocked: async () => {
        throw new Error("block must not run on bind");
      },
    });
    expect(bound.bound).toBe(true);
    expect(bound.consented).toBe(false);

    expect(
      selectCustomerUnsubscribeEvent([
        { sourceType: "user", userId: LINE_USER, text: "退訂", eventType: "message" },
      ])?.userId,
    ).toBe(LINE_USER);
    expect(
      selectCustomerUnbindEvent([
        { sourceType: "user", userId: LINE_USER, text: "解除綁定", eventType: "message" },
      ])?.userId,
    ).toBe(LINE_USER);
    expect(
      selectCustomerUnfollowEvent([
        { sourceType: "user", userId: LINE_USER, text: null, eventType: "unfollow" },
      ])?.userId,
    ).toBe(LINE_USER);
  });
});

describe("Phase 2B claim recovery and fail-closed network", () => {
  it("stale claimed becomes pending_confirmation and does not hold the Channel", () => {
    const nowMs = Date.parse("2026-10-13T02:05:00.000Z");
    const claimed: AppointmentReminderJob = {
      ...scheduledJob(nowMs),
      status: "claimed",
      claimedAt: new Date(nowMs - 31_000).toISOString(),
      sendClaimedAt: new Date(nowMs - 31_000).toISOString(),
    };
    expect(
      appointmentReminderClaimIsStale({
        status: claimed.status,
        claimedAt: claimed.claimedAt,
        nowMs,
      }).finalize,
    ).toBe(true);
    const finalized = finalizeStaleAppointmentReminderClaim(claimed, nowMs);
    expect(finalized.status).toBe("pending_confirmation");
    expect(
      reminderChannelHasInflight({
        reminderJobs: [finalized],
        broadcastRows: [],
        nowMs,
      }),
    ).toBe(false);
    const claim = applyAppointmentReminderClaimStep(
      { jobs: { [finalized.requestId]: { ...finalized, status: "pending_confirmation" } } },
      finalized.requestId,
      nowMs,
    );
    expect(claim.claimed).toBe(false);
    expect(claim.reason).toBe("duplicate");
  });

  it("non-timeout network errors are unknown delivery and never retry", async () => {
    const store = createAppointmentReminderMemoryStore();
    const nowMs = Date.parse("2026-10-13T02:05:00.000Z");
    const job = scheduledJob(nowMs);
    store.upsertJob(job);
    store.putAppointment(appointment());
    store.putBinding({
      organizationId: ORG_ENJOYE_ID,
      customerId: "cust-1",
      lineUserId: LINE_USER,
      verified: true,
    });
    store.putPreference({
      organizationId: ORG_ENJOYE_ID,
      customerId: "cust-1",
      appointmentReminderOptIn: true,
    });
    let calls = 0;
    const first = await dispatchAppointmentReminderJob({
      store,
      context: {
        organizationId: ORG_ENJOYE_ID,
        appointment: appointment(),
        job,
        textBody: "提醒",
        binding: store.getBinding(ORG_ENJOYE_ID, "cust-1"),
        preference: store.getPreference(ORG_ENJOYE_ID, "cust-1"),
        sendOpen: true,
        lineQuota: {
          known: true,
          type: "none",
          limit: null,
          usage: 0,
          remaining: null,
          label: "unlimited",
        },
        quotaCheckedAt: new Date(nowMs).toISOString(),
        nowMs,
        fetchImpl: async () => {
          calls += 1;
          throw new Error("ECONNRESET");
        },
      },
    });
    const retry = await dispatchAppointmentReminderJob({
      store,
      context: {
        organizationId: ORG_ENJOYE_ID,
        appointment: appointment(),
        job: store.getJobByRequestId(ORG_ENJOYE_ID, job.requestId)!,
        textBody: "提醒",
        binding: store.getBinding(ORG_ENJOYE_ID, "cust-1"),
        preference: store.getPreference(ORG_ENJOYE_ID, "cust-1"),
        sendOpen: true,
        lineQuota: {
          known: true,
          type: "none",
          limit: null,
          usage: 0,
          remaining: null,
          label: "unlimited",
        },
        quotaCheckedAt: new Date(nowMs).toISOString(),
        nowMs,
        fetchImpl: async () => {
          calls += 1;
          throw new Error("retry");
        },
      },
    });
    expect(first.status).toBe("pending_confirmation");
    expect(retry.status).toBe("pending_confirmation");
    expect(calls).toBe(1);
    const network = await executeCustomerLinePushHttp({
      accessToken: "token",
      lineUserId: LINE_USER,
      textBody: "提醒",
      requestId: "larq-network0000001",
      sendOpen: true,
      fetchImpl: async () => {
        throw new Error("socket hang up");
      },
    });
    expect(network.unknownDelivery).toBe(true);
    expect(network.timedOut).toBe(false);
  });
});

describe("Phase 2B persist hook, dry-run, and Broadcast regression", () => {
  it("syncs jobs only when persist is explicitly open and stays org-scoped", async () => {
    const calls: string[] = [];
    const client = {
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        calls.push(fn);
        if (fn === "read_line_appointment_reminder_workspace") {
          return {
            data: {
              ok: true,
              enabled: true,
              timing_ids: ["hours_before_3"],
              template: "提醒",
              saved: true,
            },
            error: null,
          };
        }
        expect(args?.p_organization_id).toBe(ORG_ENJOYE_ID);
        return { data: { ok: true }, error: null };
      },
    };
    const closed = await notifyAppointmentWrittenForReminders({
      organizationId: ORG_ENJOYE_ID,
      appointment: appointment(),
      change: "created",
      client,
    });
    expect(closed.synced).toBe(false);
    expect(calls).toEqual([]);
    const synced = await notifyAppointmentWrittenForReminders({
      organizationId: ORG_ENJOYE_ID,
      appointment: appointment(),
      change: "created",
      persistOpen: true,
      client,
    });
    expect(synced.synced).toBe(true);
    expect(calls).toContain("sync_line_appointment_reminder_jobs");
    expect(calls).toContain("insert_line_appointment_reminder_jobs");
    const foreign = await notifyAppointmentWrittenForReminders({
      organizationId: ORG_ENJOYE_ID,
      appointment: appointment({ organizationId: ORG_LUMIERE_ID }),
      change: "created",
      persistOpen: true,
      client,
    });
    expect(foreign.reason).toBe("cross_org");
  });

  it("dry-run records gates and never treats send_closed as a LINE call", () => {
    const nowMs = Date.parse("2026-10-13T02:05:00.000Z");
    const job = scheduledJob(nowMs);
    const eligible = evaluateAppointmentReminderDryRun({
      organizationId: ORG_ENJOYE_ID,
      appointment: appointment(),
      job,
      rule: enabledRule(),
      binding: {
        organizationId: ORG_ENJOYE_ID,
        customerId: "cust-1",
        lineUserId: LINE_USER,
        verified: true,
      },
      preference: {
        organizationId: ORG_ENJOYE_ID,
        customerId: "cust-1",
        appointmentReminderOptIn: true,
      },
      lineQuota: {
        known: true,
        type: "none",
        limit: null,
        usage: 0,
        remaining: null,
        label: "unlimited",
      },
      quotaCheckedAt: new Date(nowMs).toISOString(),
      nowMs,
    });
    expect(eligible.message).toMatch(/不會連接 LINE Push|正式發送仍關閉/);
    const unbound = evaluateAppointmentReminderDryRun({
      organizationId: ORG_ENJOYE_ID,
      appointment: appointment(),
      job,
      rule: enabledRule(),
      crmLineUserId: LINE_USER,
      nowMs,
    });
    expect(unbound.skipReason).toBe("plaintext_line_id_refused");
    expect(unbound.eligible).toBe(false);
  });

  it("does not change Broadcast claim or open send", () => {
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
    expect(source("app/api/cron/line-appointment-reminders/route.ts")).not.toMatch(
      /executeCustomerLinePushHttp|\/v2\/bot\/message\/push/,
    );
    expect(source("app/api/cron/line-appointment-reminders/route.ts")).toMatch(
      /RUN_LINE_APPOINTMENT_REMINDER_CRON_DRY_RUN_RPC/,
    );
    expect(source("app/api/cron/line-appointment-reminders/route.ts")).toMatch(
      /evaluateAppointmentReminderCronRpcResults/,
    );
    expect(source("features/line/automations/LineAutomationsWorkspace.tsx")).toMatch(
      /LINE_AUTOMATION_DB_NOT_READY/,
    );
    expect(source("lib/line/automations/appointment-reminder-actions.ts")).not.toMatch(
      /customers\.line_user_id/,
    );
    expect(source("scripts/line-appointment-reminder-local-pg.sh")).toMatch(/unix socket/);
    expect(source("scripts/line-appointment-reminder-local-pg.sh")).not.toMatch(
      /bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/,
    );
    void OTHER_USER;
  });
});
