// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planLineAutomationSchedule } from "@/lib/line/automations/schedule-engine";
import { LINE_HOLIDAY_CALENDAR_READY } from "@/lib/line/automations/schedule-types";

describe("Phase 3 holiday source safety", () => {
  it("does not accept caller-injected holiday dates while the calendar is unverified", () => {
    expect(LINE_HOLIDAY_CALENDAR_READY).toBe(false);
    const result = planLineAutomationSchedule({
      organizationId: "org-holiday-test",
      nowMs: Date.parse("2026-10-23T00:00:00.000Z"),
      rules: [{
        organizationId: "org-holiday-test",
        automationType: "holiday_greeting",
        enabled: true,
        selectedTimingIds: ["christmas"],
        template: "節日快樂",
      }],
      customers: [{
        id: "customer-1",
        organizationId: "org-holiday-test",
        status: "ACTIVE",
        verifiedLineBinding: true,
      }],
      holidayOccurrences: [{
        id: "christmas-2026",
        holidayId: "christmas",
        dateYmd: "2026-12-25",
      }],
    });
    expect(result.proposed.filter(job => job.automationType === "holiday_greeting")).toHaveLength(0);
    expect(result.missingDependencies).toContain("holiday_calendar");
  });
});
