// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORG_BEAUTY_OS_TEST_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_GRANT_PERSIST_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import {
  canProveBindCodeUniqueness,
  comparePhase2F6Architectures,
  createSplitStore,
  executeConstrainedForward,
  issueSplitChallenge,
  PHASE_2F6_RECOMMENDED,
  phase2F6FlagsClosed,
  planBSafelyLandableWithoutCoordinator,
  previewHandleWebhook,
  productionHandleForward,
  signLocalWebhookBody,
} from "@/lib/line/webhook-routing/constrained-forward";

const ROOT = process.cwd();
function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const FAKE_USER = "U00000000000000000000000000000001";
const TEST_CODE = "11111111";
const ENJOYE_CODE = "89ABCDEF";

function body(code: string, eventId: string) {
  return JSON.stringify({
    events: [
      {
        webhookEventId: eventId,
        type: "message",
        source: { type: "user", userId: FAKE_USER },
        message: { type: "text", text: code },
      },
    ],
  });
}

function signed(code: string, eventId: string) {
  const rawBody = body(code, eventId);
  return { rawBody, signature: signLocalWebhookBody(rawBody) };
}

describe("Phase 2F-6 split-environment constrained forward", () => {
  it("proves uniqueness by namespace, not by reading both stores", () => {
    const preview = createSplitStore("preview");
    const production = createSplitStore("production");
    expect(preview.claimedEvents).not.toBe(production.claimedEvents);
    expect(canProveBindCodeUniqueness(TEST_CODE, ORG_BEAUTY_OS_TEST_ID)).toBe(true);
    expect(canProveBindCodeUniqueness(ENJOYE_CODE, ORG_ENJOYE_ID)).toBe(true);
    expect(canProveBindCodeUniqueness(ENJOYE_CODE, ORG_BEAUTY_OS_TEST_ID)).toBe(false);
    expect(canProveBindCodeUniqueness(TEST_CODE, ORG_ENJOYE_ID)).toBe(false);
    expect(canProveBindCodeUniqueness(TEST_CODE, ORG_BEAUTY_OS_TEST_ID, "none")).toBe(false);
    expect(canProveBindCodeUniqueness(ENJOYE_CODE, ORG_ENJOYE_ID, "none")).toBe(false);

    expect(issueSplitChallenge({ store: preview, organizationId: ORG_BEAUTY_OS_TEST_ID, staffUserId: "staff-test-1", code: TEST_CODE })).toBeTruthy();
    expect(issueSplitChallenge({ store: production, organizationId: ORG_ENJOYE_ID, staffUserId: "staff-001", code: ENJOYE_CODE })).toBeTruthy();
    expect(issueSplitChallenge({ store: preview, organizationId: ORG_ENJOYE_ID, staffUserId: "staff-001", code: ENJOYE_CODE })).toBeNull();
    expect(issueSplitChallenge({ store: production, organizationId: ORG_BEAUTY_OS_TEST_ID, staffUserId: "staff-test-1", code: TEST_CODE })).toBeNull();
    expect(
      issueSplitChallenge({
        store: preview,
        organizationId: ORG_BEAUTY_OS_TEST_ID,
        staffUserId: "staff-test-1",
        code: TEST_CODE,
        uniquenessProof: "none",
      }),
    ).toBeNull();
    expect(issueSplitChallenge({ store: preview, organizationId: ORG_BEAUTY_OS_TEST_ID, staffUserId: "staff-test-1", code: ENJOYE_CODE })).toBeNull();
    expect(issueSplitChallenge({ store: production, organizationId: ORG_ENJOYE_ID, staffUserId: "staff-001", code: TEST_CODE })).toBeNull();
  });

  it("lets Preview consume TEST only and never treats a Preview miss as a Production hit", () => {
    const preview = createSplitStore("preview");
    const production = createSplitStore("production");
    issueSplitChallenge({ store: preview, organizationId: ORG_BEAUTY_OS_TEST_ID, staffUserId: "staff-test-1", code: TEST_CODE });
    issueSplitChallenge({ store: production, organizationId: ORG_ENJOYE_ID, staffUserId: "staff-001", code: ENJOYE_CODE });

    const testHit = executeConstrainedForward({ preview, production, ...signed(TEST_CODE, "evt-test-1") });
    expect(testHit.preview).toMatchObject({ action: "consume_test", staffUserId: "staff-test-1" });
    expect(testHit.production).toBeNull();
    expect(preview.recipients).toEqual([
      { organizationId: ORG_BEAUTY_OS_TEST_ID, staffUserId: "staff-test-1", eventId: "evt-test-1" },
    ]);
    expect(production.recipients).toHaveLength(0);

    const unknownTest = executeConstrainedForward({
      preview,
      production,
      ...signed("22222222", "evt-unknown-test"),
    });
    expect(unknownTest.preview).toMatchObject({ action: "reject", reason: "unknown" });
    expect(unknownTest.production).toBeNull();
    expect(production.recipients).toHaveLength(0);

    const enjoye = executeConstrainedForward({ preview, production, ...signed(ENJOYE_CODE, "evt-enjoye-1") });
    expect(enjoye.preview).toMatchObject({ action: "forward_candidate", code: ENJOYE_CODE });
    expect(enjoye.production).toMatchObject({ action: "consume_enjoye", staffUserId: "staff-001" });
    expect(preview.recipients).toHaveLength(1);
    expect(production.recipients).toEqual([
      { organizationId: ORG_ENJOYE_ID, staffUserId: "staff-001", eventId: "evt-enjoye-1" },
    ]);
  });

  it("rejects replay, bad signatures, unknown Enjoye codes, and cross-shop codes", () => {
    const preview = createSplitStore("preview");
    const production = createSplitStore("production");
    issueSplitChallenge({ store: production, organizationId: ORG_ENJOYE_ID, staffUserId: "staff-001", code: ENJOYE_CODE });

    const first = executeConstrainedForward({ preview, production, ...signed(ENJOYE_CODE, "evt-replay") });
    expect(first.production).toMatchObject({ action: "consume_enjoye" });
    const replay = executeConstrainedForward({ preview, production, ...signed(ENJOYE_CODE, "evt-replay") });
    expect(replay.preview.action).toBe("forward_candidate");
    expect(replay.production).toMatchObject({ action: "reject", reason: "duplicate" });
    expect(production.recipients).toHaveLength(1);

    const bad = previewHandleWebhook({
      store: preview,
      rawBody: body(TEST_CODE, "evt-bad"),
      signature: "not-a-signature",
    });
    expect(bad).toMatchObject({ action: "reject", reason: "unauthorized" });

    const forged = productionHandleForward({
      store: production,
      rawBody: body(ENJOYE_CODE, "evt-forged"),
      signature: "not-a-signature",
    });
    expect(forged).toMatchObject({ action: "reject", reason: "unauthorized" });
    expect(production.recipients).toHaveLength(1);

    const miss = executeConstrainedForward({
      preview,
      production,
      ...signed("8FFFFFFF", "evt-enjoye-miss"),
    });
    expect(miss.preview.action).toBe("forward_candidate");
    expect(miss.production).toMatchObject({ action: "reject", reason: "unknown" });

    const unproven = previewHandleWebhook({
      store: preview,
      ...signed(TEST_CODE, "evt-unproven"),
      uniquenessProof: "none",
    });
    expect(unproven).toMatchObject({ action: "reject", reason: "unproven" });

    const cross = productionHandleForward({
      store: production,
      ...signed(TEST_CODE, "evt-cross"),
    });
    expect(cross).toMatchObject({ action: "reject", reason: "unproven" });
  });

  it("fail-closes when a store is down or the forward times out", () => {
    const preview = createSplitStore("preview");
    const production = createSplitStore("production");
    issueSplitChallenge({ store: preview, organizationId: ORG_BEAUTY_OS_TEST_ID, staffUserId: "staff-test-1", code: TEST_CODE });
    issueSplitChallenge({ store: production, organizationId: ORG_ENJOYE_ID, staffUserId: "staff-001", code: ENJOYE_CODE });

    preview.available = false;
    const previewDown = executeConstrainedForward({
      preview,
      production,
      ...signed(TEST_CODE, "evt-preview-down"),
    });
    expect(previewDown.preview).toMatchObject({ action: "reject", reason: "unavailable" });
    expect(previewDown.production).toBeNull();
    expect(preview.recipients).toHaveLength(0);

    preview.available = true;
    const timeout = executeConstrainedForward({
      preview,
      production,
      ...signed(ENJOYE_CODE, "evt-timeout"),
      network: "timeout",
    });
    expect(timeout.preview.action).toBe("forward_candidate");
    expect(timeout.production).toMatchObject({ action: "reject", reason: "timeout" });
    expect(production.recipients).toHaveLength(0);
    expect(production.challenges[0]?.consumed).toBe(false);

    const offline = executeConstrainedForward({
      preview,
      production,
      ...signed(ENJOYE_CODE, "evt-prod-down"),
      network: "offline_production",
    });
    expect(offline.production).toMatchObject({ action: "reject", reason: "unavailable" });
    expect(production.recipients).toHaveLength(0);
  });

  it("does not bind twice under concurrent Production claims", () => {
    const production = createSplitStore("production");
    issueSplitChallenge({ store: production, organizationId: ORG_ENJOYE_ID, staffUserId: "staff-001", code: ENJOYE_CODE });
    const packet = signed(ENJOYE_CODE, "evt-concurrent");
    const first = productionHandleForward({ store: production, ...packet });
    const second = productionHandleForward({ store: production, ...packet });
    expect(first.action).toBe("consume_enjoye");
    expect(second).toMatchObject({ action: "reject", reason: "duplicate" });
    expect(production.recipients).toHaveLength(1);
  });

  it("keeps every send flag closed and recommends separate channels", () => {
    expect(phase2F6FlagsClosed()).toBe(true);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_AUTOMATION_SEND_OPEN).toBe(false);
    expect(LINE_OWNER_SELF_PUSH_OPEN).toBe(false);
    expect(LINE_AUTOMATION_KILL_SWITCH).toBe(false);
    expect(LINE_OWNER_SELF_GRANT_PERSIST_OPEN).toBe(false);
    expect(planBSafelyLandableWithoutCoordinator()).toBe(false);
    expect(PHASE_2F6_RECOMMENDED).toBe("C_separate_channels");
    expect(comparePhase2F6Architectures().recommended).toBe("C_separate_channels");
    expect(comparePhase2F6Architectures().planBLandable).toBe(false);
  });

  it("does not wire a real webhook or copy secrets", () => {
    const src = source("lib/line/webhook-routing/constrained-forward.ts");
    expect(src).not.toMatch(/api\.line\.me|executeLineBroadcastHttp|multicast/);
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|BEAUTY_OS_LINE_CREDENTIAL_KEY/);
    expect(source("app/api/line/webhook/[organizationId]/[publicToken]/route.ts")).not.toMatch(
      /executeConstrainedForward|previewHandleWebhook|productionHandleForward/,
    );
    expect(source("lib/line/line-flag.ts")).toMatch(/LINE_BROADCAST_SEND_OPEN = false/);
  });
});
