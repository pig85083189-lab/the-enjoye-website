// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeLineQuota } from "@/lib/line/line-quota";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import { taipeiLocalToUtcIso } from "@/lib/persistence/appointment-time";
import {
  cancelDryRunAppointment,
  createDryRunAppointment,
  createDryRunRecipient,
  createDryRunStore,
  DRY_RUN_APPOINTMENT_ID,
  DRY_RUN_DID_NOT_SEND_LINE,
  DRY_RUN_ORGANIZATION_ID,
  executeDueDryRunJobs,
  futureReminderRuntimePlan,
  planDryRunReminders,
  rescheduleDryRunAppointment,
  runCanonicalAppointmentReminderDryRun,
  seedDryRunAppointment,
  seedDryRunRecipient,
} from "@/lib/line/automations/appointment-reminder-dry-run";

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

const PLAN_MS = Date.parse("2026-10-18T00:00:00.000Z");
const DAY_BEFORE_MS = Date.parse("2026-10-19T02:00:00.000Z");
const THREE_HOUR_MS = Date.parse("2026-10-20T05:00:00.000Z");

function primedStore() {
  const store = createDryRunStore();
  seedDryRunRecipient(store, createDryRunRecipient());
  seedDryRunAppointment(store, createDryRunAppointment());
  planDryRunReminders(store, DRY_RUN_APPOINTMENT_ID, PLAN_MS);
  return store;
}

describe("Phase 3B appointment reminder dry run", () => {
  it("runs create → two jobs → due reverify → simulated send without LINE", () => {
    const result = runCanonicalAppointmentReminderDryRun();
    expect(result.sentLine).toBe(false);
    expect(DRY_RUN_DID_NOT_SEND_LINE).toBe(true);
    expect(result.simulatedCount).toBe(2);
    expect(result.jobs.map((row) => row.kind)).toEqual(["day_before", "hours_before_3"]);
    expect(result.jobs.every((row) => row.status === "simulated")).toBe(true);
    expect(result.logs.some((row) => row.action === "create")).toBe(true);
    expect(result.logs.filter((row) => row.action === "simulate_send")).toHaveLength(2);
    expect(result.logs.every((row) => row.sentLine === false)).toBe(true);
    expect(result.store.organizationId).toBe(DRY_RUN_ORGANIZATION_ID);
  });

  it("skips cancel, reschedule, duplicate, and concurrent claims", () => {
    const cancelled = primedStore();
    cancelDryRunAppointment(cancelled, DRY_RUN_APPOINTMENT_ID);
    const afterCancel = executeDueDryRunJobs({ store: cancelled, nowMs: DAY_BEFORE_MS });
    expect(afterCancel.sentLine).toBe(false);
    expect(cancelled.jobs.every((row) => row.status === "invalidated")).toBe(true);

    const moved = primedStore();
    const nextJobs = rescheduleDryRunAppointment(
      moved,
      DRY_RUN_APPOINTMENT_ID,
      taipeiLocalToUtcIso("2026-10-21", "11:00"),
      PLAN_MS,
    );
    expect(moved.jobs.filter((row) => row.status === "invalidated")).toHaveLength(2);
    expect(nextJobs.every((row) => row.version === 2)).toBe(true);
    executeDueDryRunJobs({ store: moved, nowMs: DAY_BEFORE_MS });
    expect(moved.jobs.filter((row) => row.version === 1).every((row) => row.status === "invalidated")).toBe(
      true,
    );

    const replay = primedStore();
    executeDueDryRunJobs({ store: replay, nowMs: DAY_BEFORE_MS });
    replay.jobs = replay.jobs.map((row) =>
      row.kind === "day_before" ? { ...row, status: "planned", reason: "重放同一提醒" } : row,
    );
    executeDueDryRunJobs({ store: replay, nowMs: DAY_BEFORE_MS });
    expect(replay.jobs.find((row) => row.kind === "day_before")?.status).toBe("duplicate");

    const concurrent = primedStore();
    concurrent.inflightKeys.add(concurrent.jobs[0]!.key);
    executeDueDryRunJobs({ store: concurrent, nowMs: DAY_BEFORE_MS });
    expect(concurrent.jobs[0]?.status).toBe("duplicate");
    expect(concurrent.jobs[1]?.status).toBe("planned");
  });

  it("skips disabled, invalid recipient, block, unsubscribe, quota, past, down store, and failure", () => {
    const disabled = primedStore();
    disabled.reminderEnabled = false;
    executeDueDryRunJobs({ store: disabled, nowMs: DAY_BEFORE_MS });
    expect(disabled.jobs[0]?.status).toBe("skipped_disabled");

    const invalid = primedStore();
    seedDryRunRecipient(invalid, createDryRunRecipient({ approved: false, audience: "production_customer" }));
    executeDueDryRunJobs({ store: invalid, nowMs: DAY_BEFORE_MS });
    expect(invalid.jobs[0]?.status).toBe("blocked_audience");

    const blocked = primedStore();
    seedDryRunRecipient(blocked, createDryRunRecipient({ blocked: true }));
    executeDueDryRunJobs({ store: blocked, nowMs: DAY_BEFORE_MS });
    expect(blocked.jobs[0]?.reason).toMatch(/封鎖/);

    const unsubscribed = primedStore();
    seedDryRunRecipient(unsubscribed, createDryRunRecipient({ unsubscribed: true }));
    executeDueDryRunJobs({ store: unsubscribed, nowMs: DAY_BEFORE_MS });
    expect(unsubscribed.jobs[0]?.reason).toMatch(/退訂/);

    const quota = primedStore();
    quota.quota = describeLineQuota({ type: "limited", limit: 10, usage: 10 });
    executeDueDryRunJobs({ store: quota, nowMs: DAY_BEFORE_MS });
    expect(quota.jobs[0]?.status).toBe("blocked_quota");

    const past = createDryRunStore();
    seedDryRunRecipient(past, createDryRunRecipient());
    seedDryRunAppointment(past, createDryRunAppointment());
    planDryRunReminders(past, DRY_RUN_APPOINTMENT_ID, THREE_HOUR_MS);
    expect(past.jobs.every((row) => row.status === "skipped_past")).toBe(true);

    const down = primedStore();
    down.available = false;
    executeDueDryRunJobs({ store: down, nowMs: DAY_BEFORE_MS });
    expect(down.jobs.every((row) => row.status === "unavailable")).toBe(true);

    const failed = primedStore();
    failed.failNextExecution = true;
    executeDueDryRunJobs({ store: failed, nowMs: DAY_BEFORE_MS });
    expect(failed.jobs[0]?.status).toBe("failed");
    expect(failed.jobs[0]?.reason).toMatch(/未呼叫 LINE/);
    expect(failed.jobs[1]?.status).toBe("planned");
  });

  it("keeps send closed and only plans a future runtime", () => {
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_AUTOMATION_SEND_OPEN).toBe(false);
    expect(LINE_OWNER_SELF_PUSH_OPEN).toBe(false);
    expect(LINE_AUTOMATION_KILL_SWITCH).toBe(false);
    expect(futureReminderRuntimePlan()).toMatchObject({
      persistJobs: true,
      atomicClaim: true,
      appliesSqlThisPhase: false,
      createsCronThisPhase: false,
    });
    const src = source("lib/line/automations/appointment-reminder-dry-run.ts");
    expect(src).not.toMatch(/api\.line\.me|executeLineBroadcastHttp|multicast/);
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|createServiceRoleClient/);
    expect(source("app/api/line/webhook/[organizationId]/[publicToken]/route.ts")).not.toMatch(
      /executeDueDryRunJobs|runCanonicalAppointmentReminderDryRun/,
    );
  });
});
