// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { annualBirthdayJobFingerprint } from "@/lib/line/automations/schedule-fire-at";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261023110000_line_automation_birthday_fingerprint_v2_helper.sql"), "utf8");

describe("Phase 3 birthday SQL identity helper contract", () => {
  it("matches the TypeScript year-scoped fingerprint layout", () => {
    expect(annualBirthdayJobFingerprint({
      organizationId: "org-test", customerId: "c1",
      timingId: "birthday_morning", occurrenceYmd: "2027-02-28",
    })).toBe("org-test|birthday_greeting|c1|birthday_morning|2027");
    expect(sql).toMatch(/extract\(year from p_occurrence_date\)::int::text/i);
    expect(sql).toContain("|birthday_greeting|");
  });

  it("does not replace the schedule apply RPC or legacy broadcast function", () => {
    expect(sql).not.toMatch(/create\s+or\s+replace\s+function\s+public\.apply_line_automation_schedule/i);
    expect(sql).not.toMatch(/claim_line_broadcast_send/i);
    expect(sql).not.toMatch(/cron\.schedule|net\.http_post/i);
  });

  it("does not grant execution to untrusted roles", () => {
    expect(sql).toMatch(/revoke all on function public\.line_automation_birthday_fingerprint_v2/i);
    expect(sql).not.toMatch(/grant execute/i);
  });
});
