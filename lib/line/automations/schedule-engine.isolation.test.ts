// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import {
  mergeScheduleMutations,
  simulateLineAutomationSchedule,
} from "@/lib/line/automations/schedule-apply";
import {
  canInsertAutomationJob,
  canMutateAutomationJob,
  validateAutomationScheduleItem,
} from "@/lib/line/automations/schedule-validate";
import {
  addTaipeiCalendarDays,
  automationJobFingerprint,
  computeAutomationFireAt,
  nextBirthdayYmd,
} from "@/lib/line/automations/schedule-fire-at";
import { buildScheduleSnapshot, LINE_AUTOMATION_SCHEDULE_CUSTOMER_COLUMNS } from "@/lib/line/automations/schedule-load";
import {
  LINE_COUPON_CATALOG_READY,
  LINE_HOLIDAY_CALENDAR_READY,
  LINE_AUTOMATION_SCHEDULE_TIMEZONE,
} from "@/lib/line/automations/schedule-types";
import { taipeiLocalToUtcIso } from "@/lib/persistence/appointment-time";
import { LINE_AUTOMATION_SCHEDULE_MIGRATION_FILE } from "@/lib/persistence/schema-contract";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";

const ROOT = process.cwd();
const NOW_MS = Date.parse("2026-10-17T02:00:00.000Z");

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function executableSql(rel: string): string {
  return source(rel)
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function rule(
  organizationId: string,
  automationType: "appointment_reminder" | "birthday_greeting" | "holiday_greeting" | "satisfaction_survey" | "coupon_expiry",
  selectedTimingIds: string[],
  enabled = true,
) {
  return {
    organizationId,
    automationType,
    enabled,
    selectedTimingIds,
    template: `${automationType} template`,
  };
}

describe("Phase 2A LINE automation schedule engine", () => {
  it("computes Taipei fire times for the five notification types", () => {
    expect(LINE_AUTOMATION_SCHEDULE_TIMEZONE).toBe("Asia/Taipei");
    const startAt = taipeiLocalToUtcIso("2026-10-20", "16:00");
    expect(
      computeAutomationFireAt({
        automationType: "appointment_reminder",
        timingId: "day_before_morning",
        eventKind: "appointment",
        startAt,
        nowTaipeiYmd: "2026-10-17",
      }),
    ).toBe(taipeiLocalToUtcIso("2026-10-19", "10:00"));
    expect(
      computeAutomationFireAt({
        automationType: "appointment_reminder",
        timingId: "hours_before_3",
        eventKind: "appointment",
        startAt,
        nowTaipeiYmd: "2026-10-17",
      }),
    ).toBe(taipeiLocalToUtcIso("2026-10-20", "13:00"));

    const lateStart = taipeiLocalToUtcIso("2026-10-20", "01:00");
    expect(
      computeAutomationFireAt({
        automationType: "appointment_reminder",
        timingId: "hours_before_3",
        eventKind: "appointment",
        startAt: lateStart,
        nowTaipeiYmd: "2026-10-17",
      }),
    ).toBe(taipeiLocalToUtcIso("2026-10-19", "22:00"));
    expect(
      computeAutomationFireAt({
        automationType: "appointment_reminder",
        timingId: "day_before_morning",
        eventKind: "appointment",
        startAt: lateStart,
        nowTaipeiYmd: "2026-10-17",
      }),
    ).toBe(taipeiLocalToUtcIso("2026-10-19", "10:00"));

    expect(nextBirthdayYmd("2000-02-29", "2026-10-17")).toBe("2027-02-28");
    expect(
      computeAutomationFireAt({
        automationType: "birthday_greeting",
        timingId: "birthday_morning",
        eventKind: "customer_birthday",
        birthdayYmd: "1990-10-20",
        nowTaipeiYmd: "2026-10-17",
      }),
    ).toBe(taipeiLocalToUtcIso("2026-10-20", "10:00"));
    expect(
      computeAutomationFireAt({
        automationType: "birthday_greeting",
        timingId: "days_before_3",
        eventKind: "customer_birthday",
        birthdayYmd: "1990-10-20",
        nowTaipeiYmd: "2026-10-17",
      }),
    ).toBe(taipeiLocalToUtcIso("2026-10-17", "10:00"));

    expect(
      computeAutomationFireAt({
        automationType: "holiday_greeting",
        timingId: "christmas",
        eventKind: "holiday_occurrence",
        holidayDateYmd: "2026-12-25",
        nowTaipeiYmd: "2026-10-17",
      }),
    ).toBe(taipeiLocalToUtcIso("2026-12-25", "10:00"));
    expect(
      computeAutomationFireAt({
        automationType: "holiday_greeting",
        timingId: "christmas",
        eventKind: "holiday_occurrence",
        holidayDateYmd: "2026-12-25",
        nowTaipeiYmd: "2026-10-17",
      }),
    ).not.toBeNull();

    const completedAt = taipeiLocalToUtcIso("2026-10-17", "16:30");
    expect(
      computeAutomationFireAt({
        automationType: "satisfaction_survey",
        timingId: "hours_after_2",
        eventKind: "treatment",
        completedAt,
        nowTaipeiYmd: "2026-10-17",
      }),
    ).toBe(taipeiLocalToUtcIso("2026-10-17", "18:30"));
    expect(
      computeAutomationFireAt({
        automationType: "satisfaction_survey",
        timingId: "days_after_1",
        eventKind: "treatment",
        completedAt,
        nowTaipeiYmd: "2026-10-17",
      }),
    ).toBe(taipeiLocalToUtcIso("2026-10-18", "16:30"));
    expect(addTaipeiCalendarDays("2026-10-17", 1)).toBe("2026-10-18");

    const expiresAt = taipeiLocalToUtcIso("2026-11-01", "00:00");
    expect(
      computeAutomationFireAt({
        automationType: "coupon_expiry",
        timingId: "days_before_7",
        eventKind: "customer_package",
        expiresAt,
        nowTaipeiYmd: "2026-10-17",
      }),
    ).toBe(taipeiLocalToUtcIso("2026-10-25", "10:00"));
  });

  it("schedules enabled events, skips missing data, and isolates organizations", () => {
    const first = simulateLineAutomationSchedule({
      organizationId: ORG_ENJOYE_ID,
      nowMs: NOW_MS,
      rules: [
        rule(ORG_ENJOYE_ID, "appointment_reminder", ["day_before_morning", "hours_before_3"]),
        rule(ORG_ENJOYE_ID, "birthday_greeting", ["birthday_morning"]),
        rule(ORG_ENJOYE_ID, "holiday_greeting", ["cny", "christmas"]),
        rule(ORG_ENJOYE_ID, "satisfaction_survey", ["hours_after_2"]),
        rule(ORG_ENJOYE_ID, "coupon_expiry", ["days_before_7"]),
        rule(ORG_LUMIERE_ID, "appointment_reminder", ["day_before_morning"]),
      ],
      customers: [
        {
          id: "cust-1",
          organizationId: ORG_ENJOYE_ID,
          birthdayYmd: "1990-10-20",
          status: "ACTIVE",
          verifiedLineBinding: true,
        },
        {
          id: "cust-missing-birthday",
          organizationId: ORG_ENJOYE_ID,
          birthdayYmd: null,
          status: "ACTIVE",
          verifiedLineBinding: true,
        },
        {
          id: "cust-inactive",
          organizationId: ORG_ENJOYE_ID,
          birthdayYmd: "1990-11-01",
          status: "INACTIVE",
          verifiedLineBinding: true,
        },
        {
          id: "cust-lumiere",
          organizationId: ORG_LUMIERE_ID,
          birthdayYmd: "1990-10-20",
          status: "ACTIVE",
          verifiedLineBinding: true,
        },
      ],
      appointments: [
        {
          id: "apt-1",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          startAt: taipeiLocalToUtcIso("2026-10-20", "16:00"),
          status: "BOOKED",
        },
        {
          id: "apt-cancelled",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          startAt: taipeiLocalToUtcIso("2026-10-21", "16:00"),
          status: "CANCELLED",
        },
        {
          id: "apt-no-customer",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-unknown",
          startAt: taipeiLocalToUtcIso("2026-10-22", "16:00"),
          status: "BOOKED",
        },
        {
          id: "apt-lumiere",
          organizationId: ORG_LUMIERE_ID,
          customerId: "cust-lumiere",
          startAt: taipeiLocalToUtcIso("2026-10-20", "16:00"),
          status: "BOOKED",
        },
      ],
      treatments: [
        {
          id: "trt-1",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          completedAt: taipeiLocalToUtcIso("2026-10-17", "16:30"),
          status: "COMPLETED",
        },
        {
          id: "trt-draft",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          completedAt: null,
          status: "DRAFT",
        },
      ],
      packages: [
        {
          id: "pkg-1",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          expiresAt: taipeiLocalToUtcIso("2026-11-01", "00:00"),
          status: "ACTIVE",
          source: "customer_package",
        },
      ],
    });

    expect(first.sentLine).toBe(false);
    expect(first.plan.sendOpen).toBe(false);
    expect(first.plan.missingDependencies).toEqual(["holiday_calendar"]);
    expect(first.plan.proposed.map((job) => job.automationType).sort()).toEqual([
      "appointment_reminder",
      "appointment_reminder",
      "birthday_greeting",
      "coupon_expiry",
      "satisfaction_survey",
    ]);
    expect(first.plan.proposed.every((job) => job.organizationId === ORG_ENJOYE_ID)).toBe(true);
    expect(first.plan.proposed.some((job) => job.eventId === "apt-lumiere")).toBe(false);
    expect(first.plan.proposed.some((job) => job.eventId === "apt-cancelled")).toBe(false);
    expect(first.plan.proposed.some((job) => job.eventId === "apt-no-customer")).toBe(false);
    expect(first.plan.skipped.some((row) => row.decision === "skipped_disabled")).toBe(false);
    expect(first.plan.skipped.some((row) => row.decision === "skipped_missing_data")).toBe(true);
    expect(first.plan.skipped.some((row) => row.decision === "blocked_missing_source")).toBe(true);
    expect(first.mutation.insert).toHaveLength(first.plan.proposed.length);

    const replay = simulateLineAutomationSchedule({
      organizationId: ORG_ENJOYE_ID,
      nowMs: NOW_MS,
      rules: first.plan.proposed.length
        ? [
            rule(ORG_ENJOYE_ID, "appointment_reminder", ["day_before_morning", "hours_before_3"]),
            rule(ORG_ENJOYE_ID, "birthday_greeting", ["birthday_morning"]),
            rule(ORG_ENJOYE_ID, "holiday_greeting", ["cny", "christmas"]),
            rule(ORG_ENJOYE_ID, "satisfaction_survey", ["hours_after_2"]),
            rule(ORG_ENJOYE_ID, "coupon_expiry", ["days_before_7"]),
          ]
        : [],
      customers: [
        {
          id: "cust-1",
          organizationId: ORG_ENJOYE_ID,
          birthdayYmd: "1990-10-20",
          status: "ACTIVE",
          verifiedLineBinding: true,
        },
      ],
      appointments: [
        {
          id: "apt-1",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          startAt: taipeiLocalToUtcIso("2026-10-20", "16:00"),
          status: "BOOKED",
        },
      ],
      treatments: [
        {
          id: "trt-1",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          completedAt: taipeiLocalToUtcIso("2026-10-17", "16:30"),
          status: "COMPLETED",
        },
      ],
      packages: [
        {
          id: "pkg-1",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          expiresAt: taipeiLocalToUtcIso("2026-11-01", "00:00"),
          status: "ACTIVE",
          source: "customer_package",
        },
      ],
      existingJobs: first.mutation.insert.map((job, index) => ({
        id: `laj-${index}`,
        organizationId: job.organizationId,
        automationType: job.automationType,
        eventId: job.eventId,
        customerId: job.customerId,
        timingId: job.timingId,
        fingerprint: job.fingerprint,
        scheduledFor: job.fireAt,
        status: job.recipientReady ? "scheduled" : "pending_recipient",
        messageSnapshot: job.messageSnapshot,
      })),
    });
    expect(replay.mutation.insert).toEqual([]);
    expect(replay.mutation.update).toEqual([]);
    expect(replay.mutation.cancel).toEqual([]);
  });

  it("does not schedule disabled rules and keeps custom timings uncomputed", () => {
    const result = simulateLineAutomationSchedule({
      organizationId: ORG_ENJOYE_ID,
      nowMs: NOW_MS,
      rules: [
        rule(ORG_ENJOYE_ID, "appointment_reminder", ["day_before_morning", "custom-9am"], false),
        rule(ORG_ENJOYE_ID, "birthday_greeting", ["birthday_morning"], false),
        rule(ORG_ENJOYE_ID, "holiday_greeting", ["cny"], false),
        rule(ORG_ENJOYE_ID, "satisfaction_survey", ["hours_after_2"], false),
        rule(ORG_ENJOYE_ID, "coupon_expiry", ["days_before_7"], false),
      ],
      customers: [
        {
          id: "cust-1",
          organizationId: ORG_ENJOYE_ID,
          birthdayYmd: "1990-10-20",
          verifiedLineBinding: true,
        },
      ],
      appointments: [
        {
          id: "apt-1",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          startAt: taipeiLocalToUtcIso("2026-10-20", "16:00"),
          status: "BOOKED",
        },
      ],
    });
    expect(result.plan.proposed).toEqual([]);
    expect(result.plan.skipped.map((row) => row.decision)).toEqual([
      "skipped_disabled",
      "skipped_disabled",
      "skipped_disabled",
      "skipped_disabled",
      "skipped_disabled",
    ]);
  });

  it("cancels ineligible appointments and updates unsent jobs after setting changes", () => {
    const fingerprint = automationJobFingerprint({
      organizationId: ORG_ENJOYE_ID,
      automationType: "appointment_reminder",
      eventId: "apt-1",
      timingId: "day_before_morning",
    });
    const existing = [
      {
        id: "laj-old",
        organizationId: ORG_ENJOYE_ID,
        automationType: "appointment_reminder" as const,
        eventId: "apt-1",
        customerId: "cust-1",
        timingId: "day_before_morning",
        fingerprint,
        scheduledFor: taipeiLocalToUtcIso("2026-10-18", "10:00"),
        status: "scheduled" as const,
        messageSnapshot: "old",
      },
      {
        id: "laj-hours",
        organizationId: ORG_ENJOYE_ID,
        automationType: "appointment_reminder" as const,
        eventId: "apt-1",
        customerId: "cust-1",
        timingId: "hours_before_3",
        fingerprint: automationJobFingerprint({
          organizationId: ORG_ENJOYE_ID,
          automationType: "appointment_reminder",
          eventId: "apt-1",
          timingId: "hours_before_3",
        }),
        scheduledFor: taipeiLocalToUtcIso("2026-10-20", "13:00"),
        status: "scheduled" as const,
        messageSnapshot: "old",
      },
      {
        id: "laj-accepted",
        organizationId: ORG_ENJOYE_ID,
        automationType: "appointment_reminder" as const,
        eventId: "apt-1",
        customerId: "cust-1",
        timingId: "day_before_morning",
        fingerprint,
        scheduledFor: taipeiLocalToUtcIso("2026-10-19", "10:00"),
        status: "accepted" as const,
        messageSnapshot: "sent",
      },
    ];

    const cancelled = simulateLineAutomationSchedule({
      organizationId: ORG_ENJOYE_ID,
      nowMs: NOW_MS,
      rules: [rule(ORG_ENJOYE_ID, "appointment_reminder", ["day_before_morning"])],
      customers: [
        {
          id: "cust-1",
          organizationId: ORG_ENJOYE_ID,
          verifiedLineBinding: true,
        },
      ],
      appointments: [
        {
          id: "apt-1",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          startAt: taipeiLocalToUtcIso("2026-10-20", "16:00"),
          status: "CANCELLED",
        },
      ],
      existingJobs: existing,
    });
    expect(cancelled.mutation.cancel.map((job) => job.id).sort()).toEqual(["laj-hours", "laj-old"]);
    expect(cancelled.mutation.insert).toEqual([]);
    expect(cancelled.mutation.unchanged.some((job) => job.id === "laj-accepted")).toBe(true);

    const unsanned = simulateLineAutomationSchedule({
      organizationId: ORG_ENJOYE_ID,
      nowMs: NOW_MS,
      rules: [rule(ORG_ENJOYE_ID, "appointment_reminder", ["day_before_morning"])],
      customers: [
        {
          id: "cust-1",
          organizationId: ORG_ENJOYE_ID,
          verifiedLineBinding: true,
        },
      ],
      existingJobs: [existing[0]!, {
        id: "laj-other-event",
        organizationId: ORG_ENJOYE_ID,
        automationType: "appointment_reminder",
        eventId: "apt-not-in-scan",
        customerId: "cust-1",
        timingId: "day_before_morning",
        fingerprint: automationJobFingerprint({
          organizationId: ORG_ENJOYE_ID,
          automationType: "appointment_reminder",
          eventId: "apt-not-in-scan",
          timingId: "day_before_morning",
        }),
        scheduledFor: taipeiLocalToUtcIso("2026-10-22", "10:00"),
        status: "scheduled",
        messageSnapshot: "keep",
      }],
    });
    expect(unsanned.mutation.cancel).toEqual([]);
    expect(unsanned.mutation.unchanged.map((job) => job.id).sort()).toEqual(["laj-old", "laj-other-event"]);

    const holidayKept = simulateLineAutomationSchedule({
      organizationId: ORG_ENJOYE_ID,
      nowMs: NOW_MS,
      rules: [rule(ORG_ENJOYE_ID, "holiday_greeting", ["christmas"])],
      customers: [
        {
          id: "cust-1",
          organizationId: ORG_ENJOYE_ID,
          verifiedLineBinding: true,
        },
      ],
      existingJobs: [{
        id: "laj-holiday",
        organizationId: ORG_ENJOYE_ID,
        automationType: "holiday_greeting",
        eventId: "christmas:cust-1",
        customerId: "cust-1",
        timingId: "christmas",
        fingerprint: automationJobFingerprint({
          organizationId: ORG_ENJOYE_ID,
          automationType: "holiday_greeting",
          eventId: "christmas:cust-1",
          timingId: "christmas",
        }),
        scheduledFor: taipeiLocalToUtcIso("2026-12-25", "10:00"),
        status: "scheduled",
        messageSnapshot: "holiday",
      }],
    });
    expect(holidayKept.plan.missingDependencies).toEqual(["holiday_calendar"]);
    expect(holidayKept.mutation.cancel).toEqual([]);
    expect(holidayKept.mutation.unchanged.map((job) => job.id)).toEqual(["laj-holiday"]);

    const disabledCancel = simulateLineAutomationSchedule({
      organizationId: ORG_ENJOYE_ID,
      nowMs: NOW_MS,
      rules: [rule(ORG_ENJOYE_ID, "appointment_reminder", ["day_before_morning"], false)],
      existingJobs: [existing[0]!],
    });
    expect(disabledCancel.mutation.cancel.map((job) => job.id)).toEqual(["laj-old"]);

    const rescheduled = simulateLineAutomationSchedule({
      organizationId: ORG_ENJOYE_ID,
      nowMs: NOW_MS,
      rules: [rule(ORG_ENJOYE_ID, "appointment_reminder", ["day_before_morning"])],
      customers: [
        {
          id: "cust-1",
          organizationId: ORG_ENJOYE_ID,
          verifiedLineBinding: false,
        },
      ],
      appointments: [
        {
          id: "apt-1",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          startAt: taipeiLocalToUtcIso("2026-10-21", "16:00"),
          status: "CONFIRMED",
        },
      ],
      existingJobs: [existing[0]!],
    });
    expect(rescheduled.plan.proposed[0]?.decision).toBe("pending_recipient");
    expect(rescheduled.mutation.update[0]?.id).toBe("laj-old");
    expect(rescheduled.mutation.update[0]?.fireAt).toBe(taipeiLocalToUtcIso("2026-10-20", "10:00"));

    expect(canMutateAutomationJob("claimed")).toBe(false);
    expect(canMutateAutomationJob("accepted")).toBe(false);
    expect(canMutateAutomationJob("pending_confirmation")).toBe(false);
    expect(canMutateAutomationJob("reconciled")).toBe(false);
    expect(canInsertAutomationJob("claimed")).toBe(false);
    expect(canInsertAutomationJob("accepted")).toBe(false);
    expect(validateAutomationScheduleItem({
      organizationId: ORG_ENJOYE_ID,
      automationType: "holiday_greeting",
      eventKind: "holiday_occurrence",
      eventId: "christmas:cust-1",
      customerId: "cust-1",
      timingId: "christmas",
      fingerprint: `${ORG_ENJOYE_ID}|holiday_greeting|christmas:cust-1|christmas`,
    }).ok).toBe(false);
  });

  it("dedupes concurrent plans and never calls LINE", () => {
    const snapshot = {
      organizationId: ORG_ENJOYE_ID,
      nowMs: NOW_MS,
      rules: [rule(ORG_ENJOYE_ID, "appointment_reminder", ["day_before_morning"])],
      customers: [
        {
          id: "cust-1",
          organizationId: ORG_ENJOYE_ID,
          verifiedLineBinding: true,
        },
      ],
      appointments: [
        {
          id: "apt-1",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          startAt: taipeiLocalToUtcIso("2026-10-20", "16:00"),
          status: "BOOKED" as const,
        },
      ],
    };
    const a = simulateLineAutomationSchedule(snapshot);
    const b = simulateLineAutomationSchedule(snapshot);
    const merged = mergeScheduleMutations(a.mutation, b.mutation);
    expect(a.mutation.insert).toHaveLength(1);
    expect(b.mutation.insert).toHaveLength(1);
    expect(a.mutation.insert[0]?.fingerprint).toBe(b.mutation.insert[0]?.fingerprint);
    expect(merged.insert).toHaveLength(1);
    expect(LINE_HOLIDAY_CALENDAR_READY).toBe(false);
    expect(LINE_COUPON_CATALOG_READY).toBe(false);
    expect(LINE_AUTOMATION_SEND_OPEN).toBe(false);
    expect(LINE_OWNER_SELF_PUSH_OPEN).toBe(false);
    expect(LINE_AUTOMATION_KILL_SWITCH).toBe(false);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_AUTOMATION_SCHEDULE_CUSTOMER_COLUMNS).not.toContain("line_user_id");

    const mapped = buildScheduleSnapshot({
      organizationId: ORG_ENJOYE_ID,
      rules: [
        {
          organization_id: ORG_ENJOYE_ID,
          automation_type: "appointment_reminder",
          enabled: true,
          timing_config: { selectedTimingIds: ["day_before_morning"], customTimings: [] },
          message_template: "hi",
        },
      ],
      customers: [
        {
          id: "cust-1",
          app_id: "cust-1",
          birthday: "1990-10-20",
          status: "ACTIVE",
          line_user_id: "U-should-be-ignored",
        },
      ],
    });
    expect(mapped.customers?.[0]?.verifiedLineBinding).toBe(false);
    expect(mapped.holidayOccurrences).toBeUndefined();

    const files = [
      "lib/line/automations/schedule-engine.ts",
      "lib/line/automations/schedule-apply.ts",
      "lib/line/automations/schedule-actions.ts",
      "lib/line/automations/schedule-load.ts",
      "lib/line/automations/schedule-fire-at.ts",
      "lib/line/automations/schedule-validate.ts",
    ];
    const joined = files.map((file) => source(file)).join("\n");
    expect(joined).not.toMatch(/api\.line\.me|multicast|push\/message|pg_cron/i);
    expect(executableSql(LINE_AUTOMATION_SCHEDULE_MIGRATION_FILE)).not.toMatch(
      /api\.line\.me|multicast|push\/message|pg_cron/i,
    );
    expect(joined).not.toMatch(/LINE_AUTOMATION_SEND_OPEN = true/);
    expect(source("lib/line/automations/schedule-actions.ts")).toMatch(/sentLine: false/);
    expect(source("lib/line/automations/schedule-actions.ts")).not.toMatch(/line_user_id/);
    expect(source("lib/line/automations/production-safe-flags.ts")).toMatch(
      /LINE_AUTOMATION_SEND_OPEN = false/,
    );
    expect(executableSql(LINE_AUTOMATION_SCHEDULE_MIGRATION_FILE)).not.toMatch(/api\.line\.me|pg_cron/i);
  });

  it("keeps survey and package jobs tied to event, customer, and organization", () => {
    const mismatched = simulateLineAutomationSchedule({
      organizationId: ORG_ENJOYE_ID,
      nowMs: NOW_MS,
      rules: [
        rule(ORG_ENJOYE_ID, "satisfaction_survey", ["hours_after_2"]),
        rule(ORG_ENJOYE_ID, "coupon_expiry", ["days_before_7"]),
      ],
      customers: [
        {
          id: "cust-1",
          organizationId: ORG_ENJOYE_ID,
          verifiedLineBinding: true,
        },
        {
          id: "cust-2",
          organizationId: ORG_ENJOYE_ID,
          verifiedLineBinding: true,
        },
      ],
      treatments: [
        {
          id: "trt-1",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          completedAt: taipeiLocalToUtcIso("2026-10-17", "16:30"),
          status: "COMPLETED",
        },
      ],
      packages: [
        {
          id: "pkg-1",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          expiresAt: taipeiLocalToUtcIso("2026-11-01", "00:00"),
          status: "ACTIVE",
          source: "customer_package",
        },
      ],
    });
    expect(mismatched.plan.proposed.every((job) => job.customerId === "cust-1")).toBe(true);
    expect(mismatched.plan.proposed.some((job) => job.customerId === "cust-2")).toBe(false);

    const sql = executableSql(LINE_AUTOMATION_SCHEDULE_MIGRATION_FILE);
    expect(sql).toMatch(/line_automation_schedule_customer_id_matches\(t\.customer_id, p_customer_id\)/);
    expect(sql).toMatch(/line_automation_schedule_customer_id_matches\(p\.customer_id, p_customer_id\)/);
    expect(sql).toMatch(/line_automation_schedule_expected_fire_at/);
    expect(sql).toMatch(/line_automation_schedule_recipient_ready/);
    expect(sql).toMatch(/line_automation_schedule_assert_cancelable/);
    expect(sql).toMatch(/line_automation_schedule_assert_job_identity/);
    expect(sql).toMatch(/line_automation_schedule_apply_recipient/);
    expect(sql).toMatch(/job identity mismatch/);
    expect(sql).toMatch(/cancel not allowed/);
    expect(sql).toMatch(/cancel source incomplete/);
    expect(sql).toMatch(/invalid scheduled_for/);
    expect(sql).not.toMatch(/v_item->>'recipient_ready'/);
    expect(sql).not.toMatch(/customers\.line_user_id/);
    expect(sql).not.toMatch(/create table if not exists public\.line_customer_bindings/);
  });

  it("does not downgrade an existing Phase 2B scheduled appointment when binding is unconfirmed", () => {
    const fingerprint = automationJobFingerprint({
      organizationId: ORG_ENJOYE_ID,
      automationType: "appointment_reminder",
      eventId: "apt-1",
      timingId: "day_before_morning",
    });
    const fireAt = taipeiLocalToUtcIso("2026-10-19", "10:00");
    const result = simulateLineAutomationSchedule({
      organizationId: ORG_ENJOYE_ID,
      nowMs: NOW_MS,
      rules: [rule(ORG_ENJOYE_ID, "appointment_reminder", ["day_before_morning"])],
      customers: [
        {
          id: "cust-1",
          organizationId: ORG_ENJOYE_ID,
          verifiedLineBinding: false,
        },
      ],
      appointments: [
        {
          id: "apt-1",
          organizationId: ORG_ENJOYE_ID,
          customerId: "cust-1",
          startAt: taipeiLocalToUtcIso("2026-10-20", "16:00"),
          status: "BOOKED",
        },
      ],
      existingJobs: [
        {
          id: "laj-phase2b",
          organizationId: ORG_ENJOYE_ID,
          automationType: "appointment_reminder",
          eventId: "apt-1",
          customerId: "cust-1",
          timingId: "day_before_morning",
          fingerprint,
          scheduledFor: fireAt,
          status: "scheduled",
          messageSnapshot: "appointment_reminder template",
        },
      ],
    });
    expect(result.plan.proposed[0]?.decision).toBe("pending_recipient");
    expect(result.mutation.update).toEqual([]);
    expect(result.mutation.cancel).toEqual([]);
    expect(result.mutation.unchanged.map((job) => job.id)).toEqual(["laj-phase2b"]);
  });
});
