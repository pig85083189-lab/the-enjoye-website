// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENJOYE_OWNER_BIND_ISSUE_OPEN,
  ENJOYE_OWNER_BIND_WEBHOOK_READY,
} from "@/lib/line/enjoye-owner-bind-prep";
import { LINE_BROADCAST_CHANNEL_LOCK_NAMESPACE } from "@/lib/line/line-channel-lock";
import {
  LINE_BROADCAST_ONESHOT_BOT_BASIC_ID,
  LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME,
  LINE_BROADCAST_ONESHOT_CHANNEL_ID,
  LINE_BROADCAST_SEND_OPEN,
} from "@/lib/line/line-flag";
import { lineBroadcastSharedChannelOwner } from "@/lib/line/line-formal";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_GRANT_PERSIST_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import {
  canDiscussOfficialWebhookMove,
  channelSplitRollbackSteps,
  currentChannelSplitPhase,
  nextOwnerApprovalActions,
  officialChannelRetention,
  officialChannelStillSharedWithTest,
  officialOwnerBindLaterChecklist,
  officialWebhookLaterOrder,
  ownerCreateTestChannelSteps,
  phase2F7FlagsClosed,
  PREVIEW_TEST_CHANNEL_ID,
  previewTestOfficialChannelCouplings,
  previewTestSwitchChecklist,
  remainingChannelSplitBlockers,
} from "@/lib/line/channel-separation/official-test-split";

const ROOT = process.cwd();
function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("Phase 2F-7 official vs TEST Channel split plan", () => {
  it("keeps the official Channel and leaves TEST unassigned", () => {
    const keep = officialChannelRetention();
    expect(keep).toMatchObject({
      channelId: "2009219238",
      botDisplayName: "ai",
      botBasicId: "@357gospk",
      formalOwnerOrganizationId: ORG_ENJOYE_ID,
      lockNamespace: 870121,
      keepFriends: true,
      keepBroadcastProgram: true,
    });
    expect(PREVIEW_TEST_CHANNEL_ID).toBeNull();
    expect(officialChannelStillSharedWithTest()).toBe(true);
    expect(LINE_BROADCAST_ONESHOT_CHANNEL_ID).toBe("2009219238");
    expect(LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME).toBe("ai");
    expect(LINE_BROADCAST_ONESHOT_BOT_BASIC_ID).toBe("@357gospk");
    expect(lineBroadcastSharedChannelOwner("2009219238")).toBe(ORG_ENJOYE_ID);
    expect(LINE_BROADCAST_CHANNEL_LOCK_NAMESPACE).toBe(870121);
    expect(previewTestOfficialChannelCouplings()).toEqual(
      expect.arrayContaining([
        "LINE_BROADCAST_ONESHOT_CHANNEL_ID=2009219238",
        "official Developers Webhook still on Preview TEST path",
      ]),
    );
  });

  it("gives Owner screen steps and refuses official webhook talk until TEST is independent", () => {
    expect(currentChannelSplitPhase()).toBe("prepare_test_channel_checklist");
    const steps = ownerCreateTestChannelSteps();
    expect(steps.map((row) => row.id)).toEqual([
      "create_test_oa",
      "enable_messaging_api",
      "read_test_channel_id",
      "plan_preview_webhook",
      "plan_test_secrets",
      "plan_test_bind_isolation",
    ]);
    expect(steps[0]?.screens[1]).toMatch(/不要打開既有「ai \/ THE ENJOYE」/);
    expect(previewTestSwitchChecklist()[0]).toMatch(/Channel ID ≠ 2009219238/);
    expect(canDiscussOfficialWebhookMove({})).toMatchObject({
      ok: false,
      reason: "test_channel_unassigned",
    });
    expect(
      canDiscussOfficialWebhookMove({
        testChannelId: "2009219238",
        testWebhookVerified: true,
        oneshotStillOfficial: false,
      }),
    ).toMatchObject({ reason: "test_channel_unassigned" });
    expect(
      canDiscussOfficialWebhookMove({
        testChannelId: "9999999999",
        officialWebhookChanged: true,
      }),
    ).toMatchObject({ reason: "forbidden" });
    expect(
      canDiscussOfficialWebhookMove({
        testChannelId: "9999999999",
        testWebhookVerified: true,
        oneshotStillOfficial: false,
      }),
    ).toMatchObject({ ok: false, reason: "not_this_phase" });
    expect(officialWebhookLaterOrder()[0]).toMatch(/不再引用 2009219238/);
    expect(officialOwnerBindLaterChecklist()[0]).toMatch(/2F-4/);
    expect(channelSplitRollbackSteps()[1]).toMatch(/改回舊 Preview 別名/);
    expect(remainingChannelSplitBlockers()).toEqual(
      expect.arrayContaining(["PREVIEW_TEST_CHANNEL_ID 仍未指派"]),
    );
    expect(nextOwnerApprovalActions()[0]).toMatch(/不要改 2009219238/);
  });

  it("keeps every send and official bind switch closed", () => {
    expect(phase2F7FlagsClosed()).toBe(true);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_AUTOMATION_SEND_OPEN).toBe(false);
    expect(LINE_OWNER_SELF_PUSH_OPEN).toBe(false);
    expect(LINE_AUTOMATION_KILL_SWITCH).toBe(false);
    expect(LINE_OWNER_SELF_GRANT_PERSIST_OPEN).toBe(false);
    expect(ENJOYE_OWNER_BIND_WEBHOOK_READY).toBe(false);
    expect(ENJOYE_OWNER_BIND_ISSUE_OPEN).toBe(false);
  });

  it("does not wire a real webhook or copy secrets", () => {
    const src = source("lib/line/channel-separation/official-test-split.ts");
    expect(src).not.toMatch(/api\.line\.me|executeLineBroadcastHttp|multicast/);
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|BEAUTY_OS_LINE_CREDENTIAL_KEY/);
    expect(source("app/api/line/webhook/[organizationId]/[publicToken]/route.ts")).not.toMatch(
      /official-test-split|ownerCreateTestChannelSteps/,
    );
    expect(source("lib/line/line-flag.ts")).toMatch(/LINE_BROADCAST_SEND_OPEN = false/);
    expect(source("lib/line/enjoye-owner-bind-prep.ts")).toMatch(
      /ENJOYE_OWNER_BIND_WEBHOOK_READY = false/,
    );
  });
});
