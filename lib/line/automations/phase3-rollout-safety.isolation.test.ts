// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { annualBirthdayJobFingerprint, automationJobFingerprint } from "@/lib/line/automations/schedule-fire-at";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const legacySql = read("supabase/migrations/20261017140000_line_automation_schedule_engine.sql");
const planner = read("lib/line/automations/schedule-engine.ts");
const validator = read("lib/line/automations/schedule-validate.ts");
const holidayTypes = read("lib/line/automations/schedule-types.ts");

describe("Phase 3 safe rollout blockers", () => {
  it("documents the birthday v2 versus legacy SQL mismatch until coordinated cutover", () => {
    const oldFp = automationJobFingerprint({
      organizationId: "org-test", automationType: "birthday_greeting",
      eventId: "customer-1", timingId: "birthday_morning",
    });
    const newFp = annualBirthdayJobFingerprint({
      organizationId: "org-test", customerId: "customer-1",
      timingId: "birthday_morning", occurrenceYmd: "2027-02-28",
    });
    expect(newFp).not.toBe(oldFp);
    expect(legacySql).toContain("p_organization_id || '|' || v_type || '|' || v_event_id || '|' || v_timing");
    expect(planner).toContain("LINE_BIRTHDAY_ANNUAL_FINGERPRINT_READY");
    expect(planner).toContain("let fingerprint = automationJobFingerprint(input);");
    expect(holidayTypes).toMatch(/LINE_BIRTHDAY_ANNUAL_FINGERPRINT_READY\s*=\s*false/);
    // Remove this guard only in the same PR that migrates SQL validation and planner.
  });

  it("keeps unverified holidays blocked at both planning and validation layers", () => {
    expect(holidayTypes).toMatch(/LINE_HOLIDAY_CALENDAR_READY\s*=\s*false/);
    expect(planner).toContain("if (!LINE_HOLIDAY_CALENDAR_READY)");
    expect(validator).toContain('reason: "holiday source missing"');
    expect(legacySql).toContain("raise exception 'holiday source missing'");
  });

  it("keeps schedule RPC owner-gated and limited to unsent mutations", () => {
    expect(legacySql).toContain("public.user_is_org_owner(p_organization_id)");
    expect(legacySql).toContain("v_existing.status not in ('scheduled', 'pending_recipient')");
    expect(legacySql).toContain("status in ('scheduled', 'pending_recipient')");
  });
});
