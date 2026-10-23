// @vitest-environment node
import { describe, expect, it } from "vitest";
import { diffLineAutomationSchedule } from "@/lib/line/automations/schedule-apply";
import { automationJobFingerprint } from "@/lib/line/automations/schedule-fire-at";
import type { LineAutomationExistingJob, LineAutomationProposedJob, LineAutomationSchedulePlan } from "@/lib/line/automations/schedule-types";

const organizationId = "org-appointment-test";
const fingerprint = automationJobFingerprint({
  organizationId, automationType: "appointment_reminder",
  eventId: "appointment-1", timingId: "hours_before_3",
});
const existing: LineAutomationExistingJob = {
  id: "job-1", organizationId, automationType: "appointment_reminder",
  eventId: "appointment-1", customerId: "customer-1",
  timingId: "hours_before_3", fingerprint,
  scheduledFor: "2026-11-10T07:00:00.000Z",
  status: "scheduled", messageSnapshot: "提醒",
};
const proposed: LineAutomationProposedJob = {
  organizationId, automationType: "appointment_reminder", eventKind: "appointment",
  eventId: "appointment-1", customerId: "customer-1",
  timingId: "hours_before_3", fingerprint,
  fireAt: "2026-11-11T07:00:00.000Z",
  messageSnapshot: "提醒", recipientReady: true, decision: "planned",
};
const plan = (jobs: LineAutomationProposedJob[]): LineAutomationSchedulePlan => ({
  organizationId, proposed: jobs, skipped: [], missingDependencies: [],
  sendOpen: false, cancelPolicy: {
    allowCancel: true, disabledTypes: [],
    scannedEvents: [{ automationType: "appointment_reminder", eventId: "appointment-1" }],
  },
});

describe("Phase 3 appointment reschedule and cancellation isolation", () => {
  it("updates a mutable reminder instead of inserting a duplicate on reschedule", () => {
    const result = diffLineAutomationSchedule({ organizationId, plan: plan([proposed]), existingJobs: [existing] });
    expect(result.insert).toHaveLength(0);
    expect(result.update).toHaveLength(1);
    expect(result.update[0].fireAt).toBe(proposed.fireAt);
  });

  it("cancels an unsent reminder when a scanned appointment no longer qualifies", () => {
    const result = diffLineAutomationSchedule({ organizationId, plan: plan([]), existingJobs: [existing] });
    expect(result.cancel.map(job => job.id)).toEqual(["job-1"]);
  });

  it("does not cancel when appointment source was not scanned", () => {
    const unscanned = {
      ...plan([]),
      cancelPolicy: { allowCancel: true, disabledTypes: [], scannedEvents: [] },
    };
    const result = diffLineAutomationSchedule({ organizationId, plan: unscanned, existingJobs: [existing] });
    expect(result.cancel).toHaveLength(0);
    expect(result.unchanged.map(job => job.id)).toContain("job-1");
  });

  it("does not touch jobs belonging to another organization", () => {
    const otherOrg = { ...existing, organizationId: "org-other" };
    const result = diffLineAutomationSchedule({ organizationId, plan: plan([]), existingJobs: [otherOrg] });
    expect(result.cancel).toHaveLength(0);
    expect(result.update).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
  });

  it("never cancels a claimed reminder even if the appointment was canceled", () => {
    const result = diffLineAutomationSchedule({
      organizationId, plan: plan([]), existingJobs: [{ ...existing, status: "claimed" }],
    });
    expect(result.cancel).toHaveLength(0);
    expect(result.update).toHaveLength(0);
  });

  it.each(["claimed", "accepted", "pending_confirmation", "reconciled"] as const)(
    "does not mutate or resend a %s reminder",
    (status) => {
      const result = diffLineAutomationSchedule({
        organizationId, plan: plan([proposed]), existingJobs: [{ ...existing, status }],
      });
      expect(result.insert).toHaveLength(0);
      expect(result.update).toHaveLength(0);
      expect(result.cancel).toHaveLength(0);
    },
  );
});
