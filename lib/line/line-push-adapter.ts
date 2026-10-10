/**
 * Server-only LINE Push adapter for Owner self-test.
 * Independent of Broadcast. Defaults closed. Timeout must not retry.
 */

import { LINE_API_ORIGIN, LINE_PUSH_PATH } from "@/lib/line/line-command";
import { LINE_TEST_PUSH_OPEN } from "@/lib/line/line-flag";
import type { LineBroadcastHttpResult } from "@/lib/line/line-send-adapter";

function closedResult(): LineBroadcastHttpResult {
  return { timedOut: false, httpOk: false, lineRequestId: null, httpStatus: null };
}

export async function executeLineTestPushHttp(input: {
  accessToken: string;
  lineUserId: string;
  textBody: string;
  requestId: string;
  testPushOpen?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<LineBroadcastHttpResult> {
  if (typeof window !== "undefined") {
    throw new Error("LINE push adapter cannot run in the browser");
  }
  if (!(input.testPushOpen ?? LINE_TEST_PUSH_OPEN)) {
    return closedResult();
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(`${LINE_API_ORIGIN}${LINE_PUSH_PATH}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        "X-Line-Retry-Key": input.requestId,
      },
      body: JSON.stringify({
        to: input.lineUserId,
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
