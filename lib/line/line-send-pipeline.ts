/**
 * Claim-then-send orchestration. HTTP is invoked at most once.
 * Timeout / unknown results become pending_confirmation and are never retried.
 */

import { interpretLineBroadcastApiOutcome } from "@/lib/line/line-command";
import type { LineBroadcastHttpResult } from "@/lib/line/line-send-adapter";
import type { LineApiResult, LineBroadcastStatus, LineDecisionReason } from "@/lib/line/line-types";

export type LineSendClaimResult =
  | { ok: true; broadcastId: string; requestId: string }
  | { ok: false; reason: LineDecisionReason; message: string };

export type LineSendCompleteInput = {
  apiResult: LineApiResult;
  status: LineBroadcastStatus;
  message: string;
  lineRequestId: string | null;
  httpStatus: number | null;
};

export type LineClaimedSendResult =
  | { ok: true; message: string; apiResult: LineApiResult; status: LineBroadcastStatus }
  | { ok: false; reason: LineDecisionReason; message: string; apiResult?: LineApiResult };

export async function runClaimedLineBroadcastSend(input: {
  claim: () => Promise<LineSendClaimResult>;
  send: () => Promise<LineBroadcastHttpResult>;
  complete: (outcome: LineSendCompleteInput) => Promise<void>;
}): Promise<LineClaimedSendResult> {
  const claimed = await input.claim();
  if (!claimed.ok) return claimed;

  let http: LineBroadcastHttpResult;
  try {
    http = await input.send();
  } catch {
    http = {
      timedOut: true,
      httpOk: false,
      lineRequestId: null,
      httpStatus: null,
    };
  }

  const outcome = interpretLineBroadcastApiOutcome(http);
  await input.complete({
    ...outcome,
    lineRequestId: http.lineRequestId,
    httpStatus: http.httpStatus,
  });

  if (outcome.apiResult === "accepted") {
    return {
      ok: true,
      message: outcome.message,
      apiResult: outcome.apiResult,
      status: outcome.status,
    };
  }
  return {
    ok: false,
    reason: outcome.apiResult === "pending_confirmation" ? "pending_confirmation" : "error",
    message: outcome.message,
    apiResult: outcome.apiResult,
  };
}
