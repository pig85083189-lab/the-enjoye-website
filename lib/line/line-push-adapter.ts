/**
 * Server-only LINE Push adapter for Owner self-test.
 * Independent of Broadcast. Defaults closed. Timeout must not retry.
 * Keep only status and LINE request id. Never consume the response body.
 */

import { LINE_API_ORIGIN, LINE_PUSH_PATH } from "@/lib/line/line-command";
import { LINE_BROADCAST_TEXT_MAX, LINE_TEST_PUSH_OPEN } from "@/lib/line/line-flag";
import { isLineUserId } from "@/lib/line/line-bind";
import {
  isLineRetryKey,
  lineRetryKeyFromRequestId,
} from "@/lib/line/line-retry-key";
import type { LineBroadcastHttpResult } from "@/lib/line/line-send-adapter";
import type { LineHttpErrorClass } from "@/lib/line/line-types";

function closedResult(): LineBroadcastHttpResult {
  return { timedOut: false, httpOk: false, lineRequestId: null, httpStatus: null };
}

function localRefuse(errorClass: LineHttpErrorClass): LineBroadcastHttpResult {
  return {
    timedOut: false,
    httpOk: false,
    lineRequestId: null,
    httpStatus: null,
    localErrorClass: errorClass,
  };
}

export type LineTestPushHttpInspection = {
  method: string | undefined;
  path: string;
  contentType: string | undefined;
  authorizationScheme: "Bearer" | "missing";
  retryKeyIsUuid: boolean;
  retryKeyUsesInternalPrefix: boolean;
  hasTo: boolean;
  toIsLineUserId: boolean;
  messageCount: number;
  firstMessageType: string | null;
  textLength: number;
};

export function inspectLineTestPushHttpRequest(
  url: string,
  init?: RequestInit,
): LineTestPushHttpInspection {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const retryKey = headers["X-Line-Retry-Key"] ?? "";
  let body: { to?: unknown; messages?: Array<{ type?: unknown; text?: unknown }> } = {};
  try {
    body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as typeof body;
  } catch {
    body = {};
  }
  const first = Array.isArray(body.messages) ? body.messages[0] : undefined;
  const to = typeof body.to === "string" ? body.to : "";
  return {
    method: init?.method,
    path: url,
    contentType: headers["Content-Type"],
    authorizationScheme: headers.Authorization?.startsWith("Bearer ") ? "Bearer" : "missing",
    retryKeyIsUuid: isLineRetryKey(retryKey),
    retryKeyUsesInternalPrefix: /^(ltsq-|lbrq-)/.test(retryKey),
    hasTo: to.length > 0,
    toIsLineUserId: isLineUserId(to),
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    firstMessageType: typeof first?.type === "string" ? first.type : null,
    textLength: typeof first?.text === "string" ? first.text.length : 0,
  };
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
  const text = input.textBody ?? "";
  if (!text.trim() || text.length > LINE_BROADCAST_TEXT_MAX) {
    return localRefuse("invalid_message");
  }
  if (!isLineUserId(input.lineUserId)) {
    return localRefuse("invalid_recipient");
  }
  const retryKey = lineRetryKeyFromRequestId(input.requestId);
  if (!isLineRetryKey(retryKey) || /^(ltsq-|lbrq-)/.test(retryKey)) {
    return localRefuse("invalid_retry_key");
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
        "X-Line-Retry-Key": retryKey,
      },
      body: JSON.stringify({
        to: input.lineUserId,
        messages: [{ type: "text", text }],
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
