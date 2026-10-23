// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/20261023120000_line_automation_birthday_annual_schedule_contract.sql");
const flags = read("lib/line/automations/schedule-types.ts");
const birthdayHelperSql = read("supabase/migrations/20261023110000_line_automation_birthday_fingerprint_v2_helper.sql");
const applyDiff = read("lib/line/automations/schedule-apply.ts");
const validation = read("lib/line/automations/schedule-validate.ts");
const planner = read("lib/line/automations/schedule-engine.ts");

describe("Phase 3 birthday SQL cutover contract", () => {
  it("keeps the birthday helper valid SQL text without escaped newline tokens", () => {
    expect(birthdayHelperSql).not.toContain(String.fromCharCode(92, 110));
    expect(birthdayHelperSql).toContain("create or replace function public.line_automation_birthday_fingerprint_v2(");
    expect(birthdayHelperSql).toContain("p_occurrence_date is null");
  });

  it("keeps JS validation legacy-only while the annual cutover flag is false", () => {
    expect(flags).toMatch(/LINE_BIRTHDAY_ANNUAL_FINGERPRINT_READY\\s*=\\s*false/);
    expect(validation).toContain("if (fingerprint !== expectedFingerprint)");
    expect(applyDiff).toContain("isAnnualBirthdayCollision(job)");
  });

  it("keeps the annual identity disabled until database verification", () => {
    expect(flags).toMatch(/LINE_BIRTHDAY_ANNUAL_FINGERPRINT_READY\s*=\s*false/);
    expect(planner).toContain("LINE_BIRTHDAY_ANNUAL_FINGERPRINT_READY");
  });

  it("validates the occurrence year against server-computed scheduled time", () => {
    expect(sql).toContain("v_scheduled is distinct from v_expected");
    expect(sql).toContain("(v_expected at time zone 'Asia/Taipei')::date +");
    expect(sql).toContain("public.line_automation_birthday_fingerprint_v2(");
    expect(sql).toContain("v_fp is distinct from (p_organization_id || '|' || v_type");
  });

  it("preserves stored identity on update and validates cancellation of both generations", () => {
    expect(sql).toContain("'fingerprint', v_existing.fingerprint");
    expect(sql).toContain("(p_job.scheduled_for at time zone 'Asia/Taipei')::date +");
    expect(sql).toContain("p_job.fingerprint is distinct from v_canonical");
    expect(sql).toContain("v_existing.status not in ('scheduled', 'pending_recipient')");
  });

  it("keeps owner checks, no outbound sending, and authenticated-only apply", () => {
    expect(sql).toContain("public.user_is_org_owner(p_organization_id)");
    expect(sql).toContain("grant execute on function public.apply_line_automation_schedule(text, jsonb) to authenticated");
    expect(sql).not.toMatch(/(?:net\.http_post|api\.line\.me|cron\.schedule|pg_cron\.schedule)/i);
    expect(sql).not.toContain("claim_line_broadcast_send");
  });
});
