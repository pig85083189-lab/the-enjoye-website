/**
 * Server-only LINE Push adapter for customer appointment reminders.
 * Independent of Broadcast and Owner test-push. Defaults closed.
 * Never accepts Broadcast / Multicast paths. Timeout must not retry.
 * Keep only status and LINE request id. Never consume the response body.
 */

import { LINE_API_ORIGIN, LINE_PUSH_PATH } from "@/lib/line/line-command";
import { isLineUserId } from "@/lib/line/line-bind";
import {
  APPOINTMENT_REMINDER_TEXT_MAX,
  LINE_APPOINTMENT_REMINDER_SEND_OPEN,
} from "@/lib/line/automations/appointment-reminder-flag";
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

export type CustomerLinePushHttpResult = LineBroadcastHttpResult & {
  unknownDelivery?: boolean;
};

export type CustomerLinePushHttpInspection = {
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
  usesBroadcastPath: boolean;
  usesMulticastPath: boolean;
};

export function inspectCustomerLinePushHttpRequest(
  url: string,
  init?: RequestInit,
): CustomerLinePushHttpInspection {
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
    retryKeyUsesInternalPrefix: /^(ltsq-|lbrq-|larq-)/.test(retryKey),
    hasTo: to.length > 0,
    toIsLineUserId: isLineUserId(to),
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    firstMessageType: typeof first?.type === "string" ? first.type : null,
    textLength: typeof first?.text === "string" ? first.text.length : 0,
    usesBroadcastPath: url.includes("/v2/bot/message/broadcast"),
    usesMulticastPath: url.includes("/v2/bot/message/multicast"),
  };
}

export async function executeCustomerLinePushHttp(input: {
  accessToken: string;
  lineUserId: string;
  textBody: string;
  requestId: string;
  sendOpen?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<CustomerLinePushHttpResult> {
  if (typeof window !== "undefined") {
    throw new Error("LINE customer push adapter cannot run in the browser");
  }
  if (!(input.sendOpen ?? LINE_APPOINTMENT_REMINDER_SEND_OPEN)) {
    return closedResult();
  }
  const text = input.textBody ?? "";
  if (!text.trim() || text.length > APPOINTMENT_REMINDER_TEXT_MAX) {
    return localRefuse("invalid_message");
  }
  if (!isLineUserId(input.lineUserId)) {
    return localRefuse("invalid_recipient");
  }
  if (!input.requestId.startsWith("larq-")) {
    return localRefuse("invalid_request");
  }
  const retryKey = lineRetryKeyFromRequestId(input.requestId);
  if (!isLineRetryKey(retryKey) || /^(ltsq-|lbrq-|larq-)/.test(retryKey)) {
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
    return {
      timedOut,
      httpOk: false,
      lineRequestId: null,
      httpStatus: null,
      unknownDelivery: !timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}
