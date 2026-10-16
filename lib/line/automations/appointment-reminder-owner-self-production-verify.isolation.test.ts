// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OFFICIAL_LINE_CHANNEL_ID,
  OFFICIAL_SITE_HOST,
  PHASE_2F2_OWNER_BIND_VERDICT,
  PHASE_2F2_WEBHOOK_TARGET,
  PREVIEW_WEBHOOK_ALIAS_HOST,
  classifyOfficialLineWebhookUrl,
  evaluateProductionOwnerBindSnapshot,
  nextOfficialIntegrationSteps,
  officialWebhookManualSteps,
} from "@/lib/line/automations/appointment-reminder-owner-self-production-verify";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_GRANT_PERSIST_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";

const ROOT = process.cwd();
function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("Phase 2F-2 official webhook and bind classification", () => {
  it("classifies official, preview-alias, other, and empty webhook URLs", () => {
    expect(
      classifyOfficialLineWebhookUrl(
        `https://${OFFICIAL_SITE_HOST}/api/line/webhook/org-the-enjoye/tokentokentokentokentoken12`,
      ),
    ).toBe("A_production");
    expect(
      classifyOfficialLineWebhookUrl(
        `https://${PREVIEW_WEBHOOK_ALIAS_HOST}/api/line/webhook/org-the-enjoye/tokentokentokentokentoken12`,
      ),
    ).toBe("B_preview_alias");
    expect(classifyOfficialLineWebhookUrl("https://example.test/api/line/webhook/org-the-enjoye/x")).toBe(
      "C_other",
    );
    expect(classifyOfficialLineWebhookUrl("")).toBe("D_unknown");
    expect(classifyOfficialLineWebhookUrl(null)).toBe("D_unknown");
  });

  it("keeps this run at UNKNOWN because LINE Developers and Production bind were unreadable", () => {
    expect(OFFICIAL_LINE_CHANNEL_ID).toBe("2009219238");
    expect(PHASE_2F2_WEBHOOK_TARGET).toBe("D_unknown");
    expect(PHASE_2F2_OWNER_BIND_VERDICT).toBe("unknown");
    expect(
      evaluateProductionOwnerBindSnapshot({
        readable: false,
      }),
    ).toBe("unknown");
    expect(officialWebhookManualSteps().length).toBeGreaterThan(3);
    expect(
      nextOfficialIntegrationSteps({
        webhook: PHASE_2F2_WEBHOOK_TARGET,
        bind: PHASE_2F2_OWNER_BIND_VERDICT,
      }).join("\n"),
    ).toMatch(/不套用 Production SQL/);
  });

  it("refuses unverified, mismatched, or fake bind snapshots when a row is readable", () => {
    expect(
      evaluateProductionOwnerBindSnapshot({
        readable: true,
        organizationId: "org-the-enjoye",
        staffUserId: "staff-001",
        actorStaffUserId: "staff-001",
        bindMethod: "webhook_code",
        hint: "••••fc8c",
        boundAt: "2026-10-16T00:00:00.000Z",
        keyId: "line-cred-v1",
      }),
    ).toBe("trusted");
    expect(
      evaluateProductionOwnerBindSnapshot({
        readable: true,
        organizationId: "org-beauty-os-test",
        staffUserId: "staff-001",
        actorStaffUserId: "staff-001",
        bindMethod: "webhook_code",
        hint: "••••fc8c",
        boundAt: "2026-10-16T00:00:00.000Z",
        keyId: "line-cred-v1",
      }),
    ).toBe("untrusted");
    expect(
      evaluateProductionOwnerBindSnapshot({
        readable: true,
        organizationId: "org-the-enjoye",
        staffUserId: "cust-2d2-fake-bound",
        actorStaffUserId: "staff-001",
        bindMethod: "manual",
        hint: "U-not-masked",
        boundAt: "2026-10-16T00:00:00.000Z",
        keyId: "line-cred-v1",
      }),
    ).toBe("untrusted");
    expect(evaluateProductionOwnerBindSnapshot({ readable: true, unbound: true })).toBe("absent");
  });

  it("does not open send flags or import LINE / Preview persist", () => {
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_AUTOMATION_SEND_OPEN).toBe(false);
    expect(LINE_OWNER_SELF_PUSH_OPEN).toBe(false);
    expect(LINE_AUTOMATION_KILL_SWITCH).toBe(false);
    expect(LINE_OWNER_SELF_GRANT_PERSIST_OPEN).toBe(false);
    const src = source("lib/line/automations/appointment-reminder-owner-self-production-verify.ts");
    expect(src).not.toMatch(/api\.line\.me|executeLineBroadcastHttp|multicast/);
    expect(src).not.toMatch(/verified\s*=\s*true|cust-2d2-fake-bound|apt-2e7-owner-self/);
    expect(src).not.toMatch(/GRANT_PERSIST_OPEN = true|LINE_BROADCAST_SEND_OPEN = true/);
  });

  it("keeps the unpublished Production SQL draft free of Preview fixtures and auto-send", () => {
    const sql = source("supabase/drafts/20261016120000_line_owner_self_reminder_grant_production.sql");
    expect(sql).toMatch(/authorized_via_test_push = false/);
    expect(sql).toMatch(/870121/);
    expect(sql).toMatch(/'send_open', false/);
    expect(sql).toMatch(/revoke all on function public.claim_line_owner_self_reminder_oneshot/);
    expect(sql).toMatch(/grant execute on function public.claim_line_owner_self_reminder_oneshot/);
    expect(sql).toMatch(/to service_role/);
    expect(sql).not.toMatch(/appointment_id|apt-2e7-owner-self|cust-2d2-fake-bound/);
    expect(sql).toMatch(/Never inserts a grant, oneshot, quota snapshot, or identity row/);
    expect(source("lib/line/line-flag.ts")).toMatch(/LINE_BROADCAST_SEND_OPEN = false/);
  });
});
