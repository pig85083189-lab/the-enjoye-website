// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canAutoEnrollProductionCustomers,
  canCopyPreviewBindToProduction,
  canEnableAutomaticLineSend,
  laterAutomationModuleOrder,
  laterAutomationModuleRequirements,
  lineFeatureInventory,
  officialSiteTestModeRules,
  phase3ADevelopmentOrder,
  phase3AFlagsClosed,
  PHASE_3A_TEST_MODE,
  TEST_LINE_CHANNEL_ID,
  treatTestChannelAsBusinessLine,
} from "@/lib/line/automations/phase-3a-inventory";

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("Phase 3A test-LINE-first inventory", () => {
  it("records current maturity and keeps test mode isolated", () => {
    expect(TEST_LINE_CHANNEL_ID).toBe("2009219238");
    expect(PHASE_3A_TEST_MODE).toBe("official_site_ui_isolated");
    expect(lineFeatureInventory().map((row) => row.id)).toEqual([
      "broadcast",
      "bind",
      "appointment_reminder",
      "later_automations",
      "logs_quota",
      "optout_schedule",
    ]);
    expect(lineFeatureInventory().find((row) => row.id === "appointment_reminder")?.maturity).toBe(
      "partial",
    );
    expect(lineFeatureInventory().find((row) => row.id === "later_automations")?.maturity).toBe(
      "partial",
    );
    expect(canAutoEnrollProductionCustomers()).toBe(false);
    expect(canCopyPreviewBindToProduction()).toBe(false);
    expect(treatTestChannelAsBusinessLine()).toBe(false);
    expect(canEnableAutomaticLineSend()).toBe(false);
    expect(officialSiteTestModeRules()).toEqual(
      expect.arrayContaining(["Channel 2009219238 是測試 LINE，不是 THE ENJOYE 正式營業帳號"]),
    );
    expect(laterAutomationModuleOrder()).toEqual([
      "birthday_greeting",
      "holiday_greeting",
      "satisfaction_survey",
      "coupon_expiry",
    ]);
    expect(laterAutomationModuleRequirements()).toHaveLength(8);
    expect(phase3ADevelopmentOrder()[0]).toMatch(/盤點/);
    expect(phase3AFlagsClosed()).toBe(true);
  });

  it("does not wire gateway research or a real send path", () => {
    const src = [
      source("lib/line/automations/phase-3a-inventory.ts"),
      source("lib/line/automations/appointment-reminder-schedule.ts"),
      source("lib/line/automations/schedule-engine.ts"),
      source("lib/line/automations/schedule-actions.ts"),
    ].join("\n");
    expect(src).not.toMatch(/constrained-forward|shared-channel-router|api\.line\.me/);
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|executeLineBroadcastHttp/);
    expect(source("app/api/line/webhook/[organizationId]/[publicToken]/route.ts")).not.toMatch(
      /planAppointmentReminderJobs|phase-3a-inventory/,
    );
  });
});
