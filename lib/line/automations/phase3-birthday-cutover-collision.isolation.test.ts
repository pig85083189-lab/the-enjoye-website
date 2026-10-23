// @vitest-environment node
import { describe, expect, it } from "vitest";
import { diffLineAutomationSchedule } from "@/lib/line/automations/schedule-apply";
import type {
  LineAutomationExistingJob,
  LineAutomationProposedJob,
  LineAutomationSchedulePlan,
} from "@/lib/line/automations/schedule-types";

const organizationId = "org-birthday";
const legacyFingerprint = "org-birthday|birthday_greeting|customer-1|birthday_morning";
const annualFingerprint = legacyFingerprint + "|2027";
const oldJob: LineAutomationExistingJob = {
  id: "birthday-old", organizationId, automationType: "birthday_greeting",
  eventId: "customer-1", customerId: "customer-1", timingId: "birthday_morning",
  fingerprint: legacyFingerprint, scheduledFor: "2027-01-01T02:00:00.000Z",
  status: "scheduled", messageSnapshot: "生日快樂",
};
const newJob: LineAutomationProposedJob = {
  organizationId, automationType: "birthday_greeting", eventKind: "customer_birthday",
  eventId: "customer-1", customerId: "customer-1", timingId: "birthday_morning",
  fingerprint: annualFingerprint, fireAt: "2027-01-01T02:00:00.000Z",
  messageSnapshot: "生日快樂", recipientReady: true, decision: "planned",
};
const plan: LineAutomationSchedulePlan = {
  organizationId, proposed: [newJob], skipped: [], missingDependencies: [],
  sendOpen: false, cancelPolicy: {
    allowCancel: true, disabledTypes: [],
    scannedEvents: [{ automationType: "birthday_greeting", eventId: "customer-1" }],
  },
};

describe("Phase 3 birthday legacy-to-annual collision safety", () => {
  it("does not cancel a legacy birthday job or insert an annual duplicate", () => {
    const result = diffLineAutomationSchedule({ organizationId, plan, existingJobs: [oldJob] });
    expect(result.cancel).toEqual([]);
    expect(result.insert).toEqual([]);
    expect(result.update).toEqual([]);
    expect(result.unchanged.map((job) => job.id)).toContain("birthday-old");
  });

  it("still inserts annual birthday jobs for customers without legacy jobs", () => {
    const result = diffLineAutomationSchedule({ organizationId, plan, existingJobs: [] });
    expect(result.insert.map((job) => job.fingerprint)).toEqual([annualFingerprint]);
  });

  it("allows the next birthday year while retaining the previous year's legacy job", () => {
    const previousYear = {
      ...oldJob,
      scheduledFor: "2026-01-01T02:00:00.000Z",
      status: "accepted" as const,
    };
    const result = diffLineAutomationSchedule({
      organizationId, plan, existingJobs: [previousYear],
    });
    expect(result.insert.map((job) => job.fingerprint)).toEqual([annualFingerprint]);
    expect(result.cancel).toEqual([]);
    expect(result.unchanged.map((job) => job.id)).toContain("birthday-old");
  });

  it("recognizes a January birthday advanced into the previous December", () => {
    const advanceLegacy = {
      ...oldJob,
      timingId: "days_before_3",
      fingerprint: "org-birthday|birthday_greeting|customer-1|days_before_3",
      scheduledFor: "2026-12-29T02:00:00.000Z",
    };
    const advanceAnnual = {
      ...newJob,
      timingId: "days_before_3",
      fingerprint: "org-birthday|birthday_greeting|customer-1|days_before_3|2027",
      fireAt: "2026-12-29T02:00:00.000Z",
    };
    const result = diffLineAutomationSchedule({
      organizationId,
      plan: { ...plan, proposed: [advanceAnnual] },
      existingJobs: [advanceLegacy],
    });
    expect(result.insert).toEqual([]);
    expect(result.cancel).toEqual([]);
  });

  it("does not collide with another customer or reminder timing", () => {
    const unrelated = { ...oldJob, eventId: "customer-2", customerId: "customer-2" };
    const result = diffLineAutomationSchedule({ organizationId, plan, existingJobs: [unrelated] });
    expect(result.insert.map((job) => job.fingerprint)).toEqual([annualFingerprint]);
  });

  it("does not mutate an in-flight legacy birthday job during cutover", () => {
    const result = diffLineAutomationSchedule({
      organizationId, plan, existingJobs: [{ ...oldJob, status: "claimed" }],
    });
    expect(result.cancel).toEqual([]);
    expect(result.update).toEqual([]);
    expect(result.insert).toEqual([]);
  });
});
