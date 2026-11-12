// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_BROADCAST_SEND_OPEN, LINE_TEST_PUSH_OPEN } from "@/lib/line/line-flag";
import { executeLineTestPushHttp } from "@/lib/line/line-push-adapter";
import { runIsolatedTestPushAttempt, shouldRetryTestPush } from "@/lib/line/automations/test-push-oneshot-attempt";
import {
  canEnableTestPushSendButton,
  createTestPushStore,
  currentTestPushRecipientStatus,
  evaluateTestPushGates,
  issueLocalTestPushGrant,
  maskTestPushChannelId,
  maskTestPushRecipient,
  ownerPreviewTestStepsWithoutSecrets,
  passingTestPushSnapshot,
  recommendedTestPushEnvironment,
  TEST_PUSH_GATE_IDS,
  TEST_PUSH_PREP_CHANNEL_ID,
  TEST_PUSH_PREVIEW_TEXT,
  testPushPrepFlagsClosed,
} from "@/lib/line/automations/test-push-oneshot-prep";

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("Phase 3C-1 TEST LINE one-shot push prep", () => {
  it("requires every send gate and keeps the real send button closed", () => {
    const passing = evaluateTestPushGates(passingTestPushSnapshot());
    expect(passing.ok).toBe(true);
    expect(passing.sendOpen).toBe(false);
    expect(passing.gates.map((row) => row.id)).toEqual([...TEST_PUSH_GATE_IDS]);
    expect(canEnableTestPushSendButton()).toBe(false);
    expect(testPushPrepFlagsClosed()).toBe(true);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_TEST_PUSH_OPEN).toBe(false);

    const missingBind = evaluateTestPushGates({
      ...passingTestPushSnapshot(),
      recipient: { readable: false },
    });
    expect(missingBind.ok).toBe(false);
    expect(missingBind.gates.find((row) => row.id === "webhook_code_bind")?.ok).toBe(false);
    expect(evaluateTestPushGates({ ...passingTestPushSnapshot(), quota: null }).ok).toBe(false);
    expect(currentTestPushRecipientStatus()).toEqual({
      status: "unknown",
      hint: "••••",
      bindMethod: null,
      valid: null,
      ownerIdentityConfirmed: null,
      blocked: "unknown",
      revoked: "unknown",
    });
    expect(maskTestPushChannelId()).toBe("••••9238");
    expect(maskTestPushRecipient({ readable: true, rawUserId: "U0000000000000000000000000000abcd" })).toBe(
      "••••abcd",
    );
    expect(TEST_PUSH_PREP_CHANNEL_ID).toBe("2009219238");
    expect(TEST_PUSH_PREVIEW_TEXT).toContain("THE ENJOYE");
  });

  it("claims once, rejects replay/expiry/revoke, and never retries unknown LINE results", async () => {
    const store = createTestPushStore();
    const grant = issueLocalTestPushGrant(store);
    const first = await runIsolatedTestPushAttempt({
      store,
      grantId: grant.id,
      requestId: "req-3c1-1",
      http: { timedOut: true },
    });
    expect(first.sentLine).toBe(false);
    expect(first.status).toBe("pending_confirmation");
    expect(shouldRetryTestPush(first.status)).toBe(false);

    const replay = await runIsolatedTestPushAttempt({
      store,
      grantId: grant.id,
      requestId: "req-3c1-1",
    });
    expect(replay.status).toBe("blocked");
    expect(replay.reason).toMatch(/重複/);

    const consumed = await runIsolatedTestPushAttempt({
      store,
      grantId: grant.id,
      requestId: "req-3c1-2",
    });
    expect(consumed.status).toBe("blocked");

    const expiredStore = createTestPushStore();
    const expired = issueLocalTestPushGrant(expiredStore, Date.now() - 20 * 60 * 1000);
    expired.expiresAtMs = Date.now() - 1;
    const expiredResult = await runIsolatedTestPushAttempt({
      store: expiredStore,
      grantId: expired.id,
      requestId: "req-3c1-expired",
    });
    expect(expiredResult.reason).toMatch(/過期/);

    const revokedStore = createTestPushStore();
    const revoked = issueLocalTestPushGrant(revokedStore);
    revoked.revoked = true;
    const revokedResult = await runIsolatedTestPushAttempt({
      store: revokedStore,
      grantId: revoked.id,
      requestId: "req-3c1-revoked",
    });
    expect(revokedResult.reason).toMatch(/撤銷/);

    const unknown = await runIsolatedTestPushAttempt({
      store: createTestPushStore(),
      grantId: issueLocalTestPushGrant(createTestPushStore()).id,
      requestId: "req-3c1-missing",
    });
    expect(unknown.status).toBe("blocked");
  });

  it("reuses the existing push adapter while it stays closed and does not fetch", async () => {
    let fetched = 0;
    const closed = await executeLineTestPushHttp({
      accessToken: "must-not-be-used",
      lineUserId: "U00000000000000000000000000000001",
      textBody: TEST_PUSH_PREVIEW_TEXT,
      requestId: "req-3c1-adapter",
      testPushOpen: false,
      fetchImpl: async () => {
        fetched += 1;
        return new Response("{}", { status: 200 });
      },
    });
    expect(fetched).toBe(0);
    expect(closed.httpOk).toBe(false);

    const env = recommendedTestPushEnvironment();
    expect(env.executeOn).toBe("preview");
    expect(env.copyPreviewBindToProduction).toBe(false);
    expect(ownerPreviewTestStepsWithoutSecrets()[0]).toMatch(/不要貼 Channel Secret/);
    expect(source("lib/line/automations/test-push-oneshot-attempt.ts")).toMatch(
      /runClaimedLineBroadcastSend|executeLineTestPushHttp/,
    );
    expect(source("lib/line/automations/test-push-oneshot-prep.ts")).not.toMatch(
      /executeLineTestPushHttp|LINE_BROADCAST_SEND_OPEN = true/,
    );
    expect(source("app/api/line/webhook/[organizationId]/[publicToken]/route.ts")).not.toMatch(
      /runIsolatedTestPushAttempt|test-push-oneshot-prep/,
    );
    expect(source("lib/line/line-oneshot-authorized-send.ts")).toMatch(/executeLineBroadcastHttp/);
    expect(source("lib/line/line-flag.ts")).toMatch(/LINE_BROADCAST_SEND_OPEN = false/);
  });
});
