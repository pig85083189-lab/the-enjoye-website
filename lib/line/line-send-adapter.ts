/**
 * Server-only LINE broadcast adapter.
 * Phase 1B still defaults closed. Timeout path must not retry.
 */

import {
  LINE_API_ORIGIN,
  LINE_BROADCAST_PATH,
  interpretLineBroadcastApiOutcome,
} from "@/lib/line/line-command";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";

export type LineBroadcastHttpResult = {
  timedOut: boolean;
  httpOk: boolean;
  lineRequestId: string | null;
  httpStatus: number | null;
};

function closedResult(): LineBroadcastHttpResult {
  return { timedOut: false, httpOk: false, lineRequestId: null, httpStatus: null };
}

export async function executeLineBroadcastHttp(input: {
  accessToken: string;
  textBody: string;
  requestId: string;
  sendOpen?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<LineBroadcastHttpResult> {
  if (typeof window !== "undefined") {
    throw new Error("LINE send adapter cannot run in the browser");
  }
  if (!(input.sendOpen ?? LINE_BROADCAST_SEND_OPEN)) {
    return closedResult();
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(`${LINE_API_ORIGIN}${LINE_BROADCAST_PATH}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        "X-Line-Retry-Key": input.requestId,
      },
      body: JSON.stringify({
        messages: [{ type: "text", text: input.textBody }],
      }),
    });
    return {
      timedOut: false,
      httpOk: response.ok,
      lineRequestId: response.headers.get("x-line-request-id"),
      httpStatus: response.status,
    };
  } catch (error) {
    const timedOut =
      (error instanceof Error && error.name === "AbortError") ||
      /timeout|aborted/i.test(error instanceof Error ? error.message : "");
    return { timedOut, httpOk: false, lineRequestId: null, httpStatus: null };
  } finally {
    clearTimeout(timer);
  }
}

export function describeLineBroadcastHttp(result: LineBroadcastHttpResult) {
  return interpretLineBroadcastApiOutcome(result);
}
