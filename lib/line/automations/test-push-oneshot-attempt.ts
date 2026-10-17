/**
 * Isolated one-shot TEST push attempt. Server/tests only.
 * Reuses claim pipeline + push adapter. Never opens SEND.
 */
import { interpretLineBroadcastApiOutcome } from "@/lib/line/line-command";
import { executeLineTestPushHttp } from "@/lib/line/line-push-adapter";
import { runClaimedLineBroadcastSend } from "@/lib/line/line-send-pipeline";
import {
  TEST_PUSH_PREVIEW_TEXT,
  type TestPushAttemptStatus,
  type TestPushStore,
} from "@/lib/line/automations/test-push-oneshot-prep";

export function shouldRetryTestPush(status: TestPushAttemptStatus): boolean {
  return status !== "accepted" && status !== "pending_confirmation";
}

function claimLocalGrant(
  store: TestPushStore,
  grantId: string,
  requestId: string,
  nowMs: number,
): { ok: true; broadcastId: string; requestId: string } | { ok: false; reason: "duplicate" | "send_closed"; message: string } {
  if (store.claimedRequestIds.has(requestId) || store.inflightRequestIds.has(requestId)) {
    return { ok: false, reason: "duplicate", message: "同一請求不可重複送出" };
  }
  const grant = store.grants.find((row) => row.id === grantId);
  if (!grant || grant.revoked) {
    return { ok: false, reason: "send_closed", message: "測試授權已撤銷" };
  }
  if (grant.expiresAtMs <= nowMs) {
    return { ok: false, reason: "send_closed", message: "測試授權已過期" };
  }
  if (grant.consumed) {
    return { ok: false, reason: "duplicate", message: "單次授權已經使用" };
  }
  store.inflightRequestIds.add(requestId);
  grant.consumed = true;
  store.claimedRequestIds.add(requestId);
  return { ok: true, broadcastId: `lts-${grantId}`, requestId };
}

export async function runIsolatedTestPushAttempt(input: {
  store: TestPushStore;
  grantId: string;
  requestId: string;
  nowMs?: number;
  http?: { timedOut?: boolean; httpOk?: boolean; httpStatus?: number | null };
}): Promise<{ status: TestPushAttemptStatus; reason: string; sentLine: false; retried: false }> {
  const nowMs = input.nowMs ?? Date.now();
  const pipeline = await runClaimedLineBroadcastSend({
    claim: async () => claimLocalGrant(input.store, input.grantId, input.requestId, nowMs),
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
      input.store.inflightRequestIds.delete(input.requestId);
      const status: TestPushAttemptStatus =
        outcome.apiResult === "accepted"
          ? "accepted"
          : outcome.apiResult === "pending_confirmation"
            ? "pending_confirmation"
            : "failed";
      input.store.events.push({
        requestId: input.requestId,
        grantId: input.grantId,
        status,
        reason: outcome.message,
        sentLine: false,
      });
    },
    interpret: interpretLineBroadcastApiOutcome,
  });
  input.store.inflightRequestIds.delete(input.requestId);
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
