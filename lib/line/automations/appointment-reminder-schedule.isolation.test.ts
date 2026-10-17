// @vitest-environment node
import { describe, expect, it } from "vitest";
import { describeLineQuota } from "@/lib/line/line-quota";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import {
  APPOINTMENT_REMINDER_TIMEZONE,
  appointmentReminderFlagsClosed,
  buildLocalReminderDemo,
  evaluateReminderDispatch,
  invalidateReminderJobs,
  localReminderDemoAppointment,
  planAppointmentReminderJobs,
  reminderFireAt,
  reminderJobKey,
} from "@/lib/line/automations/appointment-reminder-schedule";
import { taipeiLocalToUtcIso } from "@/lib/persistence/appointment-time";

const appointment = {
  id: "apt-3a-1",
  organizationId: "org-beauty-os-test",
  customerId: "cust-3a-local-test",
  startAt: taipeiLocalToUtcIso("2026-10-20", "16:00"),
  status: "BOOKED" as const,
  version: 1,
};

describe("Phase 3A appointment reminder planner", () => {
  it("plans Taipei day-before 10:00 and 3 hours before", () => {
    expect(APPOINTMENT_REMINDER_TIMEZONE).toBe("Asia/Taipei");
    expect(reminderFireAt("day_before", appointment.startAt)).toBe(
      taipeiLocalToUtcIso("2026-10-19", "10:00"),
    );
    expect(reminderFireAt("hours_before_3", appointment.startAt)).toBe(
      taipeiLocalToUtcIso("2026-10-20", "13:00"),
    );
    const jobs = planAppointmentReminderJobs({
      appointment,
      enabled: true,
      audience: "explicit_test",
      nowMs: Date.parse("2026-10-18T00:00:00.000Z"),
    });
    expect(jobs.map((row) => row.status)).toEqual(["planned", "planned"]);
    expect(jobs[0]?.key).toBe(
      reminderJobKey({
        organizationId: appointment.organizationId,
        appointmentId: appointment.id,
        kind: "day_before",
        version: 1,
      }),
    );
  });

  it("invalidates cancel/reschedule and refuses duplicates, quota, rate, and customers", () => {
    const planned = planAppointmentReminderJobs({
      appointment,
      enabled: true,
      audience: "explicit_test",
      nowMs: Date.parse("2026-10-18T00:00:00.000Z"),
    });
    const cancelled = invalidateReminderJobs(planned, appointment.id, "cancel");
    expect(cancelled.every((row) => row.status === "invalidated")).toBe(true);
    const moved = invalidateReminderJobs(planned, appointment.id, "reschedule");
    expect(moved[0]?.reason).toMatch(/改期/);
    const nextVersion = planAppointmentReminderJobs({
      appointment: { ...appointment, version: 2, startAt: taipeiLocalToUtcIso("2026-10-21", "11:00") },
      enabled: true,
      audience: "explicit_test",
      nowMs: Date.parse("2026-10-18T00:00:00.000Z"),
    });
    expect(nextVersion[0]?.key).not.toBe(planned[0]?.key);

    const first = evaluateReminderDispatch({
      job: planned[1]!,
      claimedKeys: new Set(),
      audience: "explicit_test",
      quota: describeLineQuota({ type: "none", usage: 0 }),
      nowMs: Date.parse("2026-10-20T05:00:00.000Z"),
    });
    expect(first.status).toBe("blocked_send_closed");
    const replay = evaluateReminderDispatch({
      job: planned[1]!,
      claimedKeys: new Set([planned[1]!.key]),
      audience: "explicit_test",
      quota: describeLineQuota({ type: "none", usage: 0 }),
    });
    expect(replay.status).toBe("duplicate");
    expect(
      evaluateReminderDispatch({
        job: planned[0]!,
        claimedKeys: new Set(),
        audience: "production_customer",
        quota: describeLineQuota({ type: "none", usage: 0 }),
      }).status,
    ).toBe("blocked_audience");
    expect(
      evaluateReminderDispatch({
        job: planned[0]!,
        claimedKeys: new Set(),
        audience: "explicit_test",
        quota: describeLineQuota({ type: "limited", limit: 10, usage: 10 }),
      }).status,
    ).toBe("blocked_quota");
    expect(
      evaluateReminderDispatch({
        job: planned[0]!,
        claimedKeys: new Set(),
        audience: "explicit_test",
        quota: describeLineQuota({ type: "none", usage: 0 }),
        dispatchedThisWindow: 10,
      }).status,
    ).toBe("blocked_rate");
    expect(
      planAppointmentReminderJobs({
        appointment: { ...appointment, status: "CANCELLED" },
        enabled: true,
        audience: "explicit_test",
      })[0]?.status,
    ).toBe("skipped_ineligible");
    expect(
      planAppointmentReminderJobs({
        appointment,
        enabled: false,
        audience: "explicit_test",
      })[0]?.status,
    ).toBe("skipped_disabled");
  });

  it("keeps the local demo off real customers and every send flag closed", () => {
    const demo = localReminderDemoAppointment();
    expect(demo.customerId).toBe("cust-3a-local-test");
    expect(demo.id).toBe("apt-3a-local-test");
    expect(buildLocalReminderDemo({ enabled: true }).every((row) => row.audience === "explicit_test")).toBe(
      true,
    );
    expect(appointmentReminderFlagsClosed()).toBe(true);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_AUTOMATION_SEND_OPEN).toBe(false);
    expect(LINE_OWNER_SELF_PUSH_OPEN).toBe(false);
    expect(LINE_AUTOMATION_KILL_SWITCH).toBe(false);
  });
});
