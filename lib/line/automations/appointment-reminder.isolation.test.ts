// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateAppointmentReminderAudience } from "@/lib/line/automations/appointment-reminder-bindings";
import { evaluateAppointmentReminderDispatch } from "@/lib/line/automations/appointment-reminder-command";
import { appointmentReminderCronMode, authorizeAppointmentReminderCron } from "@/lib/line/automations/appointment-reminder-cron";
import { dispatchAppointmentReminderJob } from "@/lib/line/automations/appointment-reminder-dispatcher";
import {
  allAppointmentReminderFlagsClosed,
  LINE_APPOINTMENT_REMINDER_CRON_DISPATCH_OPEN,
  LINE_APPOINTMENT_REMINDER_PERSIST_OPEN,
  LINE_APPOINTMENT_REMINDER_SEND_OPEN,
} from "@/lib/line/automations/appointment-reminder-flag";
import {
  applyAppointmentReminderClaimStep,
  applyAppointmentReminderPlan,
  expireOverdueAppointmentReminderJobs,
} from "@/lib/line/automations/appointment-reminder-jobs";
import {
  createDefaultAppointmentReminderRule,
  evaluateAppointmentReminderOwnerAccess,
  evaluateAppointmentReminderRuleSave,
  ruleFromAppointmentReminderDraft,
} from "@/lib/line/automations/appointment-reminder-rules";
import {
  computeAppointmentReminderFireAt,
  planAppointmentReminderJobs,
} from "@/lib/line/automations/appointment-reminder-scheduler";
import {
  createAppointmentReminderMemoryStore,
} from "@/lib/line/automations/appointment-reminder-store";
import { previewAppointmentReminderTemplate } from "@/lib/line/automations/appointment-reminder-templates";
import type {
  AppointmentReminderAppointment,
  AppointmentReminderJob,
  AppointmentReminderRule,
} from "@/lib/line/automations/appointment-reminder-types";
import { notifyAppointmentWrittenForReminders } from "@/lib/line/automations/appointment-reminder-write-hook";
import {
  executeCustomerLinePushHttp,
  inspectCustomerLinePushHttpRequest,
} from "@/lib/line/automations/customer-line-push-adapter";
import {
  applyLineBroadcastChannelClaimStep,
  sharedChannelFixtureAccounts,
} from "@/lib/line/line-channel-lock";
import { LINE_BROADCAST_SEND_OPEN, LINE_TEST_PUSH_OPEN } from "@/lib/line/line-flag";
import { LINE_BROADCAST_PATH, LINE_PUSH_PATH } from "@/lib/line/line-command";
import { executeLineBroadcastHttp } from "@/lib/line/line-send-adapter";
import { unknownLineQuota } from "@/lib/line/line-quota";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";
import { taipeiLocalToUtcIso } from "@/lib/persistence/appointment-time";

const ROOT = process.cwd();
const LINE_USER = "U0123456789abcdef0123456789abcdef";

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const owner = {
  authUserId: "auth-owner",
  role: "OWNER" as const,
  isActive: true,
  organizationId: ORG_ENJOYE_ID,
  userId: "staff-owner",
};

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

function enabledRule(overrides: Partial<AppointmentReminderRule> = {}): AppointmentReminderRule {
  return {
    ...createDefaultAppointmentReminderRule(ORG_ENJOYE_ID),
    enabled: true,
    selectedTimingIds: ["day_before_morning", "hours_before_3"],
    ...overrides,
  };
}

function sync(
  store: ReturnType<typeof createAppointmentReminderMemoryStore>,
  row: AppointmentReminderAppointment,
  rule = enabledRule(),
  nowMs = Date.parse("2026-10-12T01:00:00.000Z"),
) {
  const plan = planAppointmentReminderJobs({
    organizationId: row.organizationId,
    appointment: row,
    rule,
    nowMs,
  });
  applyAppointmentReminderPlan(store, plan, nowMs);
  store.putAppointment(row);
  store.putRule(rule);
  return plan;
}

function bindAndConsent(
  store: ReturnType<typeof createAppointmentReminderMemoryStore>,
  org = ORG_ENJOYE_ID,
  customerId = "cust-1",
) {
  store.putBinding({
    organizationId: org,
    customerId,
    lineUserId: LINE_USER,
    verified: true,
  });
  store.putPreference({
    organizationId: org,
    customerId,
    appointmentReminderOptIn: true,
  });
}

const knownQuota = {
  known: true,
  type: "none" as const,
  limit: null,
  usage: 0,
  remaining: null,
  label: "unlimited",
};

function dueJob(
  store: ReturnType<typeof createAppointmentReminderMemoryStore>,
  nowMs: number,
): AppointmentReminderJob {
  const job = store.state.jobs.find((row) => row.status === "scheduled");
  if (!job) throw new Error("expected scheduled job");
  const due = { ...job, scheduledFor: new Date(nowMs - 60_000).toISOString() };
  store.upsertJob(due);
  return due;
}

describe("appointment reminder schedule times", () => {
  it("creates Taipei day-before 10:00 and 3-hour jobs on appointment create", () => {
    const row = appointment();
    expect(computeAppointmentReminderFireAt("day_before_morning", row.startAt)).toBe(
      taipeiLocalToUtcIso("2026-10-13", "10:00"),
    );
    expect(computeAppointmentReminderFireAt("hours_before_3", row.startAt)).toBe(
      taipeiLocalToUtcIso("2026-10-14", "13:00"),
    );
    const store = createAppointmentReminderMemoryStore();
    const plan = sync(store, row);
    expect(plan.toCreate.map((job) => job.timingId)).toEqual([
      "day_before_morning",
      "hours_before_3",
    ]);
    expect(store.listJobs(ORG_ENJOYE_ID)).toHaveLength(2);
    expect(store.listJobs(ORG_LUMIERE_ID)).toHaveLength(0);
  });

  it("does not backfill reminders whose fire time is already past", () => {
    const store = createAppointmentReminderMemoryStore();
    const plan = sync(
      store,
      appointment(),
      enabledRule(),
      Date.parse(taipeiLocalToUtcIso("2026-10-13", "11:00")),
    );
    expect(plan.skipped.map((row) => row.timingId)).toEqual(["day_before_morning"]);
    expect(plan.toCreate.map((job) => job.timingId)).toEqual(["hours_before_3"]);
    expect(store.listJobs(ORG_ENJOYE_ID)).toHaveLength(1);
  });
});

describe("appointment reminder lifecycle", () => {
  it("voids old jobs when the appointment is rescheduled", () => {
    const store = createAppointmentReminderMemoryStore();
    const original = appointment();
    sync(store, original);
    const moved = appointment({
      startAt: taipeiLocalToUtcIso("2026-10-15", "16:00"),
      endAt: taipeiLocalToUtcIso("2026-10-15", "17:00"),
    });
    sync(store, moved);
    const jobs = store.listJobs(ORG_ENJOYE_ID);
    expect(jobs.filter((job) => job.status === "canceled")).toHaveLength(2);
    expect(jobs.filter((job) => job.status === "scheduled")).toHaveLength(2);
    expect(
      jobs
        .filter((job) => job.status === "scheduled")
        .every((job) => job.scheduledFor.startsWith("2026-10-1")),
    ).toBe(true);
    expect(
      jobs.find((job) => job.timingId === "day_before_morning" && job.status === "scheduled")
        ?.scheduledFor,
    ).toBe(taipeiLocalToUtcIso("2026-10-14", "10:00"));
  });

  it("cancels jobs and refuses send after cancel, complete, or past status", async () => {
    const store = createAppointmentReminderMemoryStore();
    bindAndConsent(store);
    sync(store, appointment());
    sync(store, appointment({ status: "CANCELLED" }));
    expect(store.listJobs(ORG_ENJOYE_ID).every((job) => job.status === "canceled")).toBe(true);

    const completedStore = createAppointmentReminderMemoryStore();
    bindAndConsent(completedStore);
    sync(completedStore, appointment());
    const nowMs = Date.parse("2026-10-13T02:05:00.000Z");
    const leftover = dueJob(completedStore, nowMs);
    const result = await dispatchAppointmentReminderJob({
      store: completedStore,
      context: {
        organizationId: ORG_ENJOYE_ID,
        appointment: appointment({ status: "COMPLETED" }),
        job: leftover,
        textBody: "提醒",
        binding: completedStore.getBinding(ORG_ENJOYE_ID, "cust-1"),
        preference: completedStore.getPreference(ORG_ENJOYE_ID, "cust-1"),
        sendOpen: true,
        lineQuota: knownQuota,
        quotaCheckedAt: new Date(nowMs).toISOString(),
        nowMs,
        fetchImpl: async () => {
          throw new Error("LINE must not be called");
        },
      },
    });
    expect(result.skipped).toBe(true);
    expect(result.status).toBe("skipped");
  });
});

describe("appointment reminder send gates", () => {
  it("does not send when LINE is unbound or only CRM plaintext exists", async () => {
    const store = createAppointmentReminderMemoryStore();
    sync(store, appointment());
    store.state.crmLineUserIds[`${ORG_ENJOYE_ID}:cust-1`] = LINE_USER;
    const nowMs = Date.parse("2026-10-13T02:05:00.000Z");
    const job = dueJob(store, nowMs);
    const audience = evaluateAppointmentReminderAudience({
      organizationId: ORG_ENJOYE_ID,
      customerId: "cust-1",
      crmLineUserId: LINE_USER,
    });
    expect(audience.ok).toBe(false);
    if (!audience.ok) expect(audience.skipReason).toBe("plaintext_line_id_refused");
    const result = await dispatchAppointmentReminderJob({
      store,
      context: {
        organizationId: ORG_ENJOYE_ID,
        appointment: appointment(),
        job,
        textBody: "提醒",
        crmLineUserId: LINE_USER,
        sendOpen: true,
        lineQuota: knownQuota,
        quotaCheckedAt: new Date(nowMs).toISOString(),
        nowMs,
        fetchImpl: async () => {
          throw new Error("LINE must not be called");
        },
      },
    });
    expect(result.skipped).toBe(true);
  });

  it("does not send without notification consent", async () => {
    const store = createAppointmentReminderMemoryStore();
    sync(store, appointment());
    store.putBinding({
      organizationId: ORG_ENJOYE_ID,
      customerId: "cust-1",
      lineUserId: LINE_USER,
      verified: true,
    });
    const nowMs = Date.parse("2026-10-13T02:05:00.000Z");
    const job = dueJob(store, nowMs);
    const result = await dispatchAppointmentReminderJob({
      store,
      context: {
        organizationId: ORG_ENJOYE_ID,
        appointment: appointment(),
        job,
        textBody: "提醒",
        binding: store.getBinding(ORG_ENJOYE_ID, "cust-1"),
        sendOpen: true,
        lineQuota: knownQuota,
        quotaCheckedAt: new Date(nowMs).toISOString(),
        nowMs,
        fetchImpl: async () => {
          throw new Error("LINE must not be called");
        },
      },
    });
    expect(result.skipped).toBe(true);
    expect(evaluateAppointmentReminderAudience({
      organizationId: ORG_ENJOYE_ID,
      customerId: "cust-1",
      binding: store.getBinding(ORG_ENJOYE_ID, "cust-1"),
      preference: { organizationId: ORG_ENJOYE_ID, customerId: "cust-1", appointmentReminderOptIn: false },
    }).ok).toBe(false);
  });

  it("rejects cross-organization read, write, and send", () => {
    const foreign = evaluateAppointmentReminderOwnerAccess({
      organizationId: ORG_LUMIERE_ID,
      actor: owner,
    });
    expect(foreign.ok).toBe(false);
    const save = evaluateAppointmentReminderRuleSave({
      organizationId: ORG_ENJOYE_ID,
      actor: owner,
      persistOpen: true,
      rule: enabledRule({ organizationId: ORG_LUMIERE_ID }),
    });
    expect(save.ok).toBe(false);
    const store = createAppointmentReminderMemoryStore();
    sync(store, appointment());
    expect(store.listJobs(ORG_LUMIERE_ID)).toHaveLength(0);
    const job = store.listJobs(ORG_ENJOYE_ID)[0];
    const gate = evaluateAppointmentReminderDispatch({
      organizationId: ORG_LUMIERE_ID,
      appointment: appointment({ organizationId: ORG_LUMIERE_ID }),
      job,
      textBody: "提醒",
      sendOpen: true,
    });
    expect(gate.ok).toBe(false);
  });
});

describe("appointment reminder claim, quota, and timeout", () => {
  it("does not send twice when cron is repeated", async () => {
    const store = createAppointmentReminderMemoryStore();
    bindAndConsent(store);
    sync(store, appointment());
    const nowMs = Date.parse("2026-10-13T02:05:00.000Z");
    const job = dueJob(store, nowMs);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{}", {
        status: 200,
        headers: { "x-line-request-id": "line-ok" },
      });
    };
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
        lineQuota: knownQuota,
        quotaCheckedAt: new Date(nowMs).toISOString(),
        nowMs,
        fetchImpl,
      },
    });
    const second = await dispatchAppointmentReminderJob({
      store,
      context: {
        organizationId: ORG_ENJOYE_ID,
        appointment: appointment(),
        job: store.getJobByRequestId(ORG_ENJOYE_ID, job.requestId)!,
        textBody: "提醒",
        binding: store.getBinding(ORG_ENJOYE_ID, "cust-1"),
        preference: store.getPreference(ORG_ENJOYE_ID, "cust-1"),
        sendOpen: true,
        lineQuota: knownQuota,
        quotaCheckedAt: new Date(nowMs).toISOString(),
        nowMs,
        fetchImpl,
      },
    });
    expect(first.status).toBe("accepted");
    expect(second.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it("marks LINE timeout as pending_confirmation and does not retry", async () => {
    const store = createAppointmentReminderMemoryStore();
    bindAndConsent(store);
    sync(store, appointment());
    const nowMs = Date.parse("2026-10-13T02:05:00.000Z");
    const job = dueJob(store, nowMs);
    let calls = 0;
    const timedOut = await dispatchAppointmentReminderJob({
      store,
      context: {
        organizationId: ORG_ENJOYE_ID,
        appointment: appointment(),
        job,
        textBody: "提醒",
        binding: store.getBinding(ORG_ENJOYE_ID, "cust-1"),
        preference: store.getPreference(ORG_ENJOYE_ID, "cust-1"),
        sendOpen: true,
        lineQuota: knownQuota,
        quotaCheckedAt: new Date(nowMs).toISOString(),
        nowMs,
        fetchImpl: async () => {
          calls += 1;
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
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
        lineQuota: knownQuota,
        quotaCheckedAt: new Date(nowMs).toISOString(),
        nowMs,
        fetchImpl: async () => {
          calls += 1;
          throw new Error("retry");
        },
      },
    });
    expect(timedOut.status).toBe("pending_confirmation");
    expect(retry.status).toBe("pending_confirmation");
    expect(calls).toBe(1);
  });

  it("stops when official quota is unknown or remaining is zero", async () => {
    const store = createAppointmentReminderMemoryStore();
    bindAndConsent(store);
    sync(store, appointment());
    const nowMs = Date.parse("2026-10-13T02:05:00.000Z");
    const job = dueJob(store, nowMs);
    const unknown = evaluateAppointmentReminderDispatch({
      organizationId: ORG_ENJOYE_ID,
      appointment: appointment(),
      job,
      textBody: "提醒",
      binding: store.getBinding(ORG_ENJOYE_ID, "cust-1"),
      preference: store.getPreference(ORG_ENJOYE_ID, "cust-1"),
      sendOpen: true,
      lineQuota: unknownLineQuota(),
      nowMs,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe("quota_exceeded");
    const empty = evaluateAppointmentReminderDispatch({
      organizationId: ORG_ENJOYE_ID,
      appointment: appointment(),
      job,
      textBody: "提醒",
      binding: store.getBinding(ORG_ENJOYE_ID, "cust-1"),
      preference: store.getPreference(ORG_ENJOYE_ID, "cust-1"),
      sendOpen: true,
      lineQuota: {
        known: true,
        type: "limited",
        limit: 200,
        usage: 200,
        remaining: 0,
        label: "none",
      },
      nowMs,
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.message).toMatch(/額度不足/);
  });

  it("expires jobs that missed the 15-minute cron grace window instead of backfilling", () => {
    const store = createAppointmentReminderMemoryStore();
    sync(store, appointment());
    const nowMs = Date.parse("2026-10-13T03:00:00.000Z");
    const expired = expireOverdueAppointmentReminderJobs(store, ORG_ENJOYE_ID, nowMs);
    expect(expired.some((job) => job.timingId === "day_before_morning")).toBe(true);
    expect(expired.every((job) => job.status === "expired")).toBe(true);
  });
});

describe("appointment reminder flags, cron, and customer push adapter", () => {
  it("keeps every reminder and broadcast send flag closed by default", async () => {
    expect(allAppointmentReminderFlagsClosed()).toBe(true);
    expect(LINE_APPOINTMENT_REMINDER_SEND_OPEN).toBe(false);
    expect(LINE_APPOINTMENT_REMINDER_PERSIST_OPEN).toBe(false);
    expect(LINE_APPOINTMENT_REMINDER_CRON_DISPATCH_OPEN).toBe(false);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_TEST_PUSH_OPEN).toBe(false);
    const save = evaluateAppointmentReminderRuleSave({
      organizationId: ORG_ENJOYE_ID,
      actor: owner,
      rule: enabledRule(),
    });
    expect(save.ok).toBe(false);
    const hook = await notifyAppointmentWrittenForReminders({
      organizationId: ORG_ENJOYE_ID,
      appointment: appointment(),
      change: "created",
    });
    expect(hook.synced).toBe(false);
    let called = false;
    await executeCustomerLinePushHttp({
      accessToken: "token",
      lineUserId: LINE_USER,
      textBody: "提醒",
      requestId: "larq-testclosed0001",
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
    expect(called).toBe(false);
    expect(appointmentReminderCronMode({})).toBe("closed");
  });

  it("uses personal Push only and never Broadcast or Multicast", async () => {
    let inspection = null as ReturnType<typeof inspectCustomerLinePushHttpRequest> | null;
    await executeCustomerLinePushHttp({
      accessToken: "token",
      lineUserId: LINE_USER,
      textBody: "提醒",
      requestId: "larq-testpush0000001",
      sendOpen: true,
      fetchImpl: async (url, init) => {
        inspection = inspectCustomerLinePushHttpRequest(String(url), init);
        return new Response("{}", { status: 200, headers: { "x-line-request-id": "x" } });
      },
    });
    expect(inspection?.path).toContain(LINE_PUSH_PATH);
    expect(inspection?.usesBroadcastPath).toBe(false);
    expect(inspection?.usesMulticastPath).toBe(false);
    expect(inspection?.toIsLineUserId).toBe(true);
    expect(inspection?.retryKeyUsesInternalPrefix).toBe(false);
    expect(LINE_BROADCAST_PATH).not.toEqual(LINE_PUSH_PATH);
  });

  it("requires cron authorization and refuses dispatch while flags are closed", () => {
    const secret = "cron-secret-16ch";
    expect(
      authorizeAppointmentReminderCron({
        authorization: "Bearer wrong-secret-16",
        vercelCron: "1",
        env: { CRON_SECRET: secret, VERCEL_ENV: "preview" },
      }).ok,
    ).toBe(false);
    expect(
      authorizeAppointmentReminderCron({
        vercelCron: "1",
        env: { CRON_SECRET: secret, VERCEL_ENV: "production" },
      }).ok,
    ).toBe(false);
    expect(
      authorizeAppointmentReminderCron({
        authorization: "Bearer secret",
        env: { CRON_SECRET: "secret" },
      }).ok,
    ).toBe(false);
    expect(
      authorizeAppointmentReminderCron({
        authorization: `Bearer ${secret}`,
        env: { CRON_SECRET: secret },
      }).ok,
    ).toBe(true);
    expect(source("app/api/cron/line-appointment-reminders/route.ts")).toMatch(/send_closed/);
    expect(source("vercel.json")).toMatch(/\*\/15 \* \* \* \*/);
    expect(source("vercel.json")).not.toMatch(/BEAUTY_OS_/);
  });
});

describe("Broadcast remains independent", () => {
  it("does not change Broadcast claim, quota, or send-closed behavior", async () => {
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
    let broadcastCalled = false;
    await executeLineBroadcastHttp({
      accessToken: "token",
      textBody: "群發",
      requestId: "lbrq-broadcastok0001",
      fetchImpl: async () => {
        broadcastCalled = true;
        return new Response("{}", { status: 200 });
      },
    });
    expect(broadcastCalled).toBe(false);
    expect(source("lib/line/line-send-adapter.ts")).not.toMatch(/appointment-reminder/);
    expect(source("lib/line/line-flag.ts")).not.toMatch(/appointment-reminder/);
    expect(source("lib/line/automations/customer-line-push-adapter.ts")).toMatch(/LINE_PUSH_PATH/);
    expect(source("lib/line/automations/customer-line-push-adapter.ts")).not.toMatch(/LINE_BROADCAST_PATH/);
    const reminderClaim = applyAppointmentReminderClaimStep(
      {
        jobs: {
          "larq-dup": {
            id: "laj-1",
            organizationId: ORG_ENJOYE_ID,
            appointmentId: "apt-1",
            customerId: "cust-1",
            serviceId: "svc-1",
            timingId: "hours_before_3",
            fingerprint: "x",
            scheduledFor: new Date(Date.now() - 60_000).toISOString(),
            status: "accepted",
            requestId: "larq-dup",
            sendClaimedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      },
      "larq-dup",
    );
    expect(reminderClaim.claimed).toBe(false);
    expect(reminderClaim.reason).toBe("duplicate");
  });
});

describe("appointment reminder UI and draft migration safety", () => {
  it("keeps other automations display-only and refuses production persist", () => {
    const workspace = source("features/line/automations/LineAutomationsWorkspace.tsx");
    expect(workspace).toMatch(/saveAppointmentReminderRuleAction/);
    expect(workspace).not.toMatch(/birthday_greeting.*saveAppointmentReminderRuleAction/);
    expect(workspace).toMatch(/LINE_AUTOMATION_NOT_LIVE_HINT/);
    expect(previewAppointmentReminderTemplate({ template: "日期 {{appointmentDate}}" })).toContain(
      "2026/10/13",
    );
    const draft = ruleFromAppointmentReminderDraft(ORG_ENJOYE_ID, {
      enabled: true,
      selectedTimingIds: ["day_before_morning", "custom_1"],
      template: "預覽",
    });
    expect(draft.selectedTimingIds).toEqual(["day_before_morning"]);
    expect(evaluateAppointmentReminderRuleSave({
      organizationId: ORG_ENJOYE_ID,
      actor: owner,
      rule: draft,
    }).ok).toBe(false);
  });

  it("publishes Preview-ready SQL without applying it remotely", () => {
    const published = readdirSync(path.join(ROOT, "supabase/migrations")).filter((name) =>
      name.endsWith(".sql"),
    );
    expect(published).toContain("20261013120000_line_appointment_reminder_automation.sql");
    expect(published).toContain("20261013140000_line_appointment_reminder_phase_2c.sql");
    const sql = source("supabase/migrations/20261013120000_line_appointment_reminder_automation.sql");
    const sql2c = source("supabase/migrations/20261013140000_line_appointment_reminder_phase_2c.sql");
    expect(sql).toMatch(/Owner approval is required/);
    expect(sql).not.toMatch(/DRAFT ONLY/);
    expect(sql).toMatch(/line_customer_bindings/);
    expect(sql).toMatch(/line_notification_preferences/);
    expect(sql).toMatch(/claim_line_appointment_reminder_job/);
    expect(sql).toMatch(/session_user/);
    expect(sql).toMatch(/870121/);
    expect(sql).toMatch(/user_is_org_owner/);
    expect(sql).toMatch(/never a send destination/);
    expect(sql).toMatch(/line_automation_deliveries_job_org_fkey/);
    expect(sql).not.toMatch(/from public\.customers/i);
    expect(source("lib/persistence/fresh-migration-chain.isolation.test.ts")).toMatch(
      /20261013120000_line_appointment_reminder_automation\.sql/,
    );
    expect(sql2c).toMatch(/set_line_appointment_reminder_consent/);
    expect(sql2c).toMatch(/bind_does_not_opt_in/);
    expect(sql2c).not.toMatch(/from public\.customers/i);
    expect(sql2c).toMatch(/Do not apply remotely without Owner approval/);
  });

  it("does not expose Channel tokens or reuse Owner recipients", () => {
    const joined = [
      "lib/line/automations/appointment-reminder-actions.ts",
      "features/line/automations/LineAutomationsWorkspace.tsx",
      "app/api/cron/line-appointment-reminders/route.ts",
    ]
      .map(source)
      .join("\n");
    expect(joined).not.toMatch(/OWNER_READ_LINE_TOKEN_CIPHER_RPC|channel_access_token/);
    expect(joined).not.toMatch(/line_owner_recipients|executeLineBroadcastHttp|multicast/);
    expect(source("lib/line/automations/appointment-reminder-bindings.ts")).toMatch(
      /Owner LINE recipients must not be reused/,
    );
  });
});
