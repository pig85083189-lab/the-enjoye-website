/**
 * Isolated one-shot TEST push attempt. Server/tests only.
 * Persistent claim binds grant + requestId + recipient + Channel.
 * Never opens SEND. Local store is not a remote guarantee.
 */
import { interpretLineTestPushApiOutcome } from "@/lib/line/line-http-error";
import { executeLineTestPushHttp } from "@/lib/line/line-push-adapter";
import { runClaimedLineBroadcastSend } from "@/lib/line/line-send-pipeline";
import {
  TEST_PUSH_PREP_CHANNEL_ID,
  TEST_PUSH_PREP_ORG_ID,
  TEST_PUSH_PREVIEW_TEXT,
  claimPersistentTestPushGrant,
  type TestPushAttemptStatus,
  type TestPushStore,
} from "@/lib/line/automations/test-push-oneshot-prep";

export function shouldRetryTestPush(_status: TestPushAttemptStatus): false {
  return false;
}

export async function runIsolatedTestPushAttempt(input: {
  store: TestPushStore;
  grantId: string;
  requestId: string;
  organizationId?: string;
  channelId?: string;
  recipientHint?: string;
  nowMs?: number;
  http?: { timedOut?: boolean; httpOk?: boolean; httpStatus?: number | null };
}): Promise<{ status: TestPushAttemptStatus; reason: string; sentLine: false; retried: false }> {
  const nowMs = input.nowMs ?? Date.now();
  const organizationId = (input.organizationId ?? TEST_PUSH_PREP_ORG_ID).trim();
  const channelId = (input.channelId ?? TEST_PUSH_PREP_CHANNEL_ID).trim();
  const grant = input.store.grants.find((row) => row.id === input.grantId);
  const recipientHint = (input.recipientHint ?? grant?.recipientHint ?? "").trim();
  const pipeline = await runClaimedLineBroadcastSend({
    claim: async () =>
      claimPersistentTestPushGrant(input.store, {
        grantId: input.grantId,
        requestId: input.requestId,
        organizationId,
        channelId,
        recipientHint,
        nowMs,
      }),
    send: async () => {
      if (input.http) {
        return {
          timedOut: input.http.timedOut === true,
          httpOk: input.http.httpOk === true,
          lineRequestId: null,
          httpStatus: input.http.httpStatus ?? null,
        };
      }
      return executeLineTestPushHttp({
        accessToken: "local-closed",
        lineUserId: "U00000000000000000000000000000001",
        textBody: TEST_PUSH_PREVIEW_TEXT,
        requestId: input.requestId,
        testPushOpen: false,
      });
    },
    complete: async (outcome) => {
      const claim = input.store.claims.find((row) => row.requestId === input.requestId);
      const status: TestPushAttemptStatus =
        outcome.apiResult === "accepted"
          ? "accepted"
          : outcome.apiResult === "pending_confirmation"
            ? "pending_confirmation"
            : "failed";
      if (claim) claim.status = status;
      input.store.events.push({
        requestId: input.requestId,
        grantId: input.grantId,
        claimKey: claim?.claimKey ?? "",
        status,
        reason: outcome.message,
        sentLine: false,
      });
    },
    interpret: interpretLineTestPushApiOutcome,
  });
  const status: TestPushAttemptStatus = pipeline.ok
    ? "accepted"
    : pipeline.reason === "pending_confirmation"
      ? "pending_confirmation"
      : pipeline.reason === "duplicate" || pipeline.reason === "send_closed"
        ? "blocked"
        : "failed";
  if (!input.store.events.some((row) => row.requestId === input.requestId)) {
    input.store.events.push({
      requestId: input.requestId,
      grantId: input.grantId,
      claimKey: input.store.claims.find((row) => row.requestId === input.requestId)?.claimKey ?? "",
      status,
      reason: pipeline.message,
      sentLine: false,
    });
  }
  return {
    status,
    reason: pipeline.message,
    sentLine: false,
    retried: false,
  };
}
