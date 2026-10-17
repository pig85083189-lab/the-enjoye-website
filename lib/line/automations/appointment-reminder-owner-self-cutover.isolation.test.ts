// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ORG_BEAUTY_OS_TEST_ID,
  ORG_ENJOYE_ID,
} from "@/lib/tenant/constants";
import {
  broadcastImpactOfWebhookSwitch,
  canRecommendOfficialWebhookSwitch,
  classifyWebhookPathOrganization,
  currentPhase2F3Blockers,
  cutoverChecklist,
  officialWebhookTargetUrl,
  ownerNextApprovals,
  previewWebhookTargetUrl,
  rollbackSteps,
  testWebhookBindAfterSwitch,
  webhookCutoverFlagsClosed,
} from "@/lib/line/automations/appointment-reminder-owner-self-cutover";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";

const ROOT = process.cwd();
function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("Phase 2F-3 webhook cutover planning", () => {
  it("keeps every send flag closed and does not recommend switching", () => {
    expect(webhookCutoverFlagsClosed()).toBe(true);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(canRecommendOfficialWebhookSwitch()).toBe(false);
    expect(
      canRecommendOfficialWebhookSwitch({
        ownerApprovedSwitch: true,
        blockers: currentPhase2F3Blockers(),
      }),
    ).toBe(false);
    expect(currentPhase2F3Blockers().length).toBeGreaterThan(0);
    expect(currentPhase2F3Blockers()).toContain("single_channel_single_url");
    expect(currentPhase2F3Blockers()).toContain("preview_and_production_are_different_databases");
    expect(currentPhase2F3Blockers()).toContain("enjoye_bind_ui_gated_to_test");
  });

  it("classifies webhook path orgs without exposing tokens", () => {
    expect(
      classifyWebhookPathOrganization(`/api/line/webhook/${ORG_ENJOYE_ID}/tokentokentokentokentoken12`),
    ).toEqual({ organizationId: ORG_ENJOYE_ID, known: "enjoye" });
    expect(
      classifyWebhookPathOrganization(
        `/api/line/webhook/${ORG_BEAUTY_OS_TEST_ID}/tokentokentokentokentoken12`,
      ),
    ).toEqual({ organizationId: ORG_BEAUTY_OS_TEST_ID, known: "test" });
    expect(classifyWebhookPathOrganization("")).toEqual({ organizationId: null, known: "unknown" });
    expect(officialWebhookTargetUrl(ORG_ENJOYE_ID)).toContain("{publicToken}");
    expect(previewWebhookTargetUrl(ORG_BEAUTY_OS_TEST_ID)).toContain("{publicToken}");
    expect(officialWebhookTargetUrl(ORG_ENJOYE_ID)).not.toMatch(/[A-Za-z0-9_-]{32,}/);
  });

  it("marks TEST bind and unknown path as blockers and leaves Broadcast send unchanged", () => {
    expect(testWebhookBindAfterSwitch({ developersPathOrg: "unknown" }).blocker).toBe(true);
    expect(testWebhookBindAfterSwitch({ developersPathOrg: "enjoye" }).remainsUsable).toBe(false);
    expect(testWebhookBindAfterSwitch({ developersPathOrg: "test" }).blocker).toBe(true);
    expect(broadcastImpactOfWebhookSwitch().sendPathChanges).toBe(false);
  });

  it("requires rollback and Owner confirmations before any URL change", () => {
    expect(cutoverChecklist().join("\n")).toMatch(/不要貼 public token/);
    expect(rollbackSteps().join("\n")).toMatch(/改回舊 Preview 別名/);
    expect(ownerNextApprovals().join("\n")).toMatch(/不要核准把 Webhook 改成 Production URL/);
    const src = source("lib/line/automations/appointment-reminder-owner-self-cutover.ts");
    expect(src).not.toMatch(/api\.line\.me|executeLineBroadcastHttp|multicast/);
    expect(src).not.toMatch(/LINE_BROADCAST_SEND_OPEN = true/);
    expect(source("app/api/line/webhook/[organizationId]/[publicToken]/route.ts")).toMatch(
      /processLineWebhookBind/,
    );
    expect(source("features/line/LineOfficialAccountSettings.tsx")).toMatch(
      /canShowLineEngineerDiagnostics/,
    );
  });
});
