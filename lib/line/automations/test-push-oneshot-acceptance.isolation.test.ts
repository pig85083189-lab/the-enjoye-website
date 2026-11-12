// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { interpretLineTestPushApiOutcome } from "@/lib/line/line-http-error";
import { LINE_BROADCAST_SEND_OPEN, LINE_TEST_PUSH_OPEN } from "@/lib/line/line-flag";
import { executeLineTestPushHttp } from "@/lib/line/line-push-adapter";
import { runIsolatedTestPushAttempt, shouldRetryTestPush } from "@/lib/line/automations/test-push-oneshot-attempt";
import {
  FIRST_REAL_SEND_ALLOWED,
  LOCAL_SET_IS_REMOTE_CLAIM,
  PREVIEW_READONLY_QUERY_ALLOWED,
  currentPreviewBindConfirmation,
  evaluateRecipientSafety,
  inspectPreviewRemoteSchema,
  nextOwnerApprovedMinimumAction,
  ownerPreviewBindConfirmationSteps,
  probePreviewReadonlyAccess,
  remainingFirstSendBlockers,
} from "@/lib/line/automations/test-push-oneshot-acceptance";
import {
  REMOTE_ATOMIC_CLAIM_REQUIRED,
  TEST_PUSH_PREP_CHANNEL_ID,
  TEST_PUSH_PREP_ORG_ID,
  TEST_PUSH_PREVIEW_TEXT,
  canEnableTestPushSendButton,
  claimPersistentTestPushGrant,
  createTestPushStore,
  evaluateTestPushGates,
  issueLocalTestPushGrant,
  passingTestPushSnapshot,
  serializeTestPushClaimKey,
  testPushPrepFlagsClosed,
} from "@/lib/line/automations/test-push-oneshot-prep";

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("Phase 3C-2 Preview bind confirmation and one-shot safety", () => {
  it("marks Preview recipient and remote schema UNKNOWN without database access", () => {
    const probe = probePreviewReadonlyAccess({});
    expect(probe.access).toBe("none");
    expect(probe.recipientStatus).toBe("unknown");
    expect(probe.schemaStatus).toBe("unknown");
    expect(probe.canConfirmOwnerIdentity).toBe(false);
    expect(probe.channelIdMasked).toBe("••••9238");
    expect(probe.organizationId).toBe("org-beauty-os-test");
    expect(PREVIEW_READONLY_QUERY_ALLOWED).toBe(false);
    expect(currentPreviewBindConfirmation()).toMatchObject({
      status: "unknown",
      hint: "••••",
      bindMethod: null,
      valid: null,
      ownerIdentityConfirmed: false,
      blocked: "unknown",
      revoked: "unknown",
    });

    const schema = inspectPreviewRemoteSchema();
    expect(schema.verdict).toBe("unknown");
    expect(schema.remoteConfirmed).toBe(false);
    expect(schema.localDraftsExist).toBe(true);
    expect(schema.objects.map((row) => row.id)).toEqual(
      expect.arrayContaining([
        "line_owner_recipients",
        "claim_line_test_send",
        "line_test_sends",
        "line_broadcast_oneshot_permits",
        "appointment_reminder_oneshot_grant",
      ]),
    );
    expect(schema.objects.every((row) => row.remoteApplied === "unknown")).toBe(true);
    expect(schema.objects.find((row) => row.id === "line_broadcast_oneshot_permits")?.notes).toMatch(
      /不可重用/,
    );
    expect(ownerPreviewBindConfirmationSteps()[0]).toMatch(/不要貼 Channel Secret/);
    expect(JSON.stringify(probe)).not.toMatch(/U[0-9a-f]{32}/i);
  });

  it("fails closed when block, revoke, or owner identity is unknown", () => {
    const unknown = evaluateRecipientSafety({ readable: false });
    expect(unknown.ok).toBe(false);
    expect(unknown.verdict).toBe("fail_closed");
    expect(unknown.blocked).toBe("unknown");
    expect(unknown.revoked).toBe("unknown");
    expect(unknown.ownerIdentity).toBe("unknown");

    const fixture = passingTestPushSnapshot();
    expect(evaluateTestPushGates(fixture).ok).toBe(true);
    expect(
      evaluateTestPushGates({
        ...fixture,
        recipient: { ...fixture.recipient!, blocked: undefined, revoked: undefined },
      }).gates.find((row) => row.id === "not_blocked_or_revoked")?.ok,
    ).toBe(false);
    expect(
      evaluateTestPushGates({
        ...fixture,
        recipient: { ...fixture.recipient!, ownerIdentityConfirmed: undefined },
      }).gates.find((row) => row.id === "explicit_test_recipient")?.ok,
    ).toBe(false);
    expect(canEnableTestPushSendButton()).toBe(false);
    expect(testPushPrepFlagsClosed()).toBe(true);
    expect(FIRST_REAL_SEND_ALLOWED).toBe(false);
  });

  it("binds grant, requestId, recipient, and Channel in a persistent claim row", async () => {
    expect(LOCAL_SET_IS_REMOTE_CLAIM).toBe(false);
    expect(REMOTE_ATOMIC_CLAIM_REQUIRED).toBe(true);
    const store = createTestPushStore();
    const grant = issueLocalTestPushGrant(store);
    const first = await runIsolatedTestPushAttempt({
      store,
      grantId: grant.id,
      requestId: "req-3c2-1",
      http: { timedOut: true },
    });
    expect(first.sentLine).toBe(false);
    expect(first.retried).toBe(false);
    expect(first.status).toBe("pending_confirmation");
    expect(shouldRetryTestPush(first.status)).toBe(false);
    expect(store.claims).toHaveLength(1);
    expect(store.claims[0]).toMatchObject({
      grantId: grant.id,
      requestId: "req-3c2-1",
      organizationId: TEST_PUSH_PREP_ORG_ID,
      channelId: TEST_PUSH_PREP_CHANNEL_ID,
      recipientHint: "••••ab12",
      status: "pending_confirmation",
    });
    expect(store.claims[0].claimKey).toBe(
      serializeTestPushClaimKey({
        organizationId: TEST_PUSH_PREP_ORG_ID,
        channelId: TEST_PUSH_PREP_CHANNEL_ID,
        grantId: grant.id,
        requestId: "req-3c2-1",
        recipientHint: "••••ab12",
      }),
    );

    const replay = await runIsolatedTestPushAttempt({
      store,
      grantId: grant.id,
      requestId: "req-3c2-1",
    });
    expect(replay.status).toBe("blocked");
    expect(replay.reason).toMatch(/重複/);

    const consumed = await runIsolatedTestPushAttempt({
      store,
      grantId: grant.id,
      requestId: "req-3c2-2",
    });
    expect(consumed.status).toBe("blocked");
  });

  it("rejects concurrent, expired, revoked, cross-shop, and mismatched claims", async () => {
    const concurrentStore = createTestPushStore();
    const concurrentGrant = issueLocalTestPushGrant(concurrentStore);
    const [left, right] = await Promise.all([
      runIsolatedTestPushAttempt({
        store: concurrentStore,
        grantId: concurrentGrant.id,
        requestId: "req-3c2-race",
        http: { httpOk: true, httpStatus: 200 },
      }),
      runIsolatedTestPushAttempt({
        store: concurrentStore,
        grantId: concurrentGrant.id,
        requestId: "req-3c2-race",
        http: { httpOk: true, httpStatus: 200 },
      }),
    ]);
    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual(["accepted", "blocked"]);
    expect(concurrentStore.claims).toHaveLength(1);
    expect(left.sentLine).toBe(false);
    expect(right.sentLine).toBe(false);

    const expiredStore = createTestPushStore();
    const expired = issueLocalTestPushGrant(expiredStore, Date.now() - 20 * 60 * 1000);
    expired.expiresAtMs = Date.now() - 1;
    const expiredResult = await runIsolatedTestPushAttempt({
      store: expiredStore,
      grantId: expired.id,
      requestId: "req-3c2-expired",
    });
    expect(expiredResult.reason).toMatch(/過期/);

    const revokedStore = createTestPushStore();
    const revoked = issueLocalTestPushGrant(revokedStore);
    revoked.revoked = true;
    const revokedResult = await runIsolatedTestPushAttempt({
      store: revokedStore,
      grantId: revoked.id,
      requestId: "req-3c2-revoked",
    });
    expect(revokedResult.reason).toMatch(/撤銷/);

    const crossStore = createTestPushStore();
    const cross = issueLocalTestPushGrant(crossStore);
    const crossResult = await runIsolatedTestPushAttempt({
      store: crossStore,
      grantId: cross.id,
      requestId: "req-3c2-cross",
      organizationId: "org-the-enjoye",
    });
    expect(crossResult.reason).toMatch(/跨店/);

    const channelStore = createTestPushStore();
    const channelGrant = issueLocalTestPushGrant(channelStore);
    const wrongChannel = claimPersistentTestPushGrant(channelStore, {
      grantId: channelGrant.id,
      requestId: "req-3c2-channel",
      organizationId: TEST_PUSH_PREP_ORG_ID,
      channelId: "2000000000",
      recipientHint: channelGrant.recipientHint,
      nowMs: Date.now(),
    });
    expect(wrongChannel).toMatchObject({ ok: false, reason: "send_closed" });

    const recipientStore = createTestPushStore();
    const recipientGrant = issueLocalTestPushGrant(recipientStore);
    const wrongRecipient = claimPersistentTestPushGrant(recipientStore, {
      grantId: recipientGrant.id,
      requestId: "req-3c2-recipient",
      organizationId: TEST_PUSH_PREP_ORG_ID,
      channelId: TEST_PUSH_PREP_CHANNEL_ID,
      recipientHint: "••••zzzz",
      nowMs: Date.now(),
    });
    expect(wrongRecipient).toMatchObject({ ok: false, reason: "send_closed" });
  });

  it("marks timeout, 5xx, and unknown delivery pending_confirmation and never retries", async () => {
    expect(shouldRetryTestPush("failed")).toBe(false);
    expect(shouldRetryTestPush("blocked")).toBe(false);
    expect(shouldRetryTestPush("accepted")).toBe(false);
    expect(shouldRetryTestPush("pending_confirmation")).toBe(false);

    expect(
      interpretLineTestPushApiOutcome({ timedOut: true, httpOk: false, httpStatus: null }),
    ).toMatchObject({ apiResult: "pending_confirmation", errorClass: "timeout" });
    expect(
      interpretLineTestPushApiOutcome({ timedOut: false, httpOk: false, httpStatus: 503 }),
    ).toMatchObject({ apiResult: "pending_confirmation", errorClass: "unknown" });
    expect(
      interpretLineTestPushApiOutcome({ timedOut: false, httpOk: false, httpStatus: null }),
    ).toMatchObject({ apiResult: "pending_confirmation", errorClass: "unknown" });
    expect(
      interpretLineTestPushApiOutcome({ timedOut: false, httpOk: false, httpStatus: 401 }),
    ).toMatchObject({ apiResult: "failed", errorClass: "unauthorized" });

    const store = createTestPushStore();
    const grant = issueLocalTestPushGrant(store);
    const unknown = await runIsolatedTestPushAttempt({
      store,
      grantId: grant.id,
      requestId: "req-3c2-5xx",
      http: { httpOk: false, httpStatus: 500 },
    });
    expect(unknown.status).toBe("pending_confirmation");
    expect(shouldRetryTestPush(unknown.status)).toBe(false);
    const replay = await runIsolatedTestPushAttempt({
      store,
      grantId: grant.id,
      requestId: "req-3c2-5xx-retry",
    });
    expect(replay.status).toBe("blocked");
  });

  it("keeps send switches closed and does not fetch LINE", async () => {
    let fetched = 0;
    const closed = await executeLineTestPushHttp({
      accessToken: "must-not-be-used",
      lineUserId: "U00000000000000000000000000000001",
      textBody: TEST_PUSH_PREVIEW_TEXT,
      requestId: "req-3c2-adapter",
      testPushOpen: false,
      fetchImpl: async () => {
        fetched += 1;
        return new Response("{}", { status: 200 });
      },
    });
    expect(fetched).toBe(0);
    expect(closed.httpOk).toBe(false);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_TEST_PUSH_OPEN).toBe(false);
    expect(remainingFirstSendBlockers().length).toBeGreaterThanOrEqual(5);
    expect(nextOwnerApprovedMinimumAction()).toMatch(/不要套用 SQL/);
    expect(source("lib/line/automations/test-push-oneshot-attempt.ts")).not.toMatch(
      /claimedRequestIds|inflightRequestIds/,
    );
    expect(source("lib/line/automations/test-push-oneshot-prep.ts")).toMatch(/claimPersistentTestPushGrant/);
    expect(source("app/api/line/webhook/[organizationId]/[publicToken]/route.ts")).not.toMatch(
      /test-push-oneshot-acceptance|runIsolatedTestPushAttempt/,
    );
    expect(source("lib/line/line-oneshot-authorized-send.ts")).toMatch(/executeLineBroadcastHttp/);
    expect(source("lib/line/line-flag.ts")).toMatch(/LINE_BROADCAST_SEND_OPEN = false/);
  });
});
