/**
 * Safe LINE HTTP error classification.
 * Classify by HTTP status / timeout only. Never persist or parse response bodies.
 */

import type {
  LineApiResult,
  LineBroadcastStatus,
  LineHttpErrorClass,
} from "@/lib/line/line-types";
import { LINE_PERSISTED_HTTP_ERROR_CLASSES } from "@/lib/line/line-types";

export const LINE_HTTP_ERROR_CLASSES = [
  "unauthorized",
  "forbidden",
  "invalid_request",
  "invalid_recipient",
  "invalid_message",
  "invalid_retry_key",
  "quota_exceeded",
  "timeout",
  "unknown",
] as const satisfies readonly LineHttpErrorClass[];

export function isLineHttpErrorClass(
  value: string | null | undefined,
): value is LineHttpErrorClass {
  return (
    value === "unauthorized" ||
    value === "forbidden" ||
    value === "invalid_request" ||
    value === "invalid_recipient" ||
    value === "invalid_message" ||
    value === "invalid_retry_key" ||
    value === "quota_exceeded" ||
    value === "timeout" ||
    value === "unknown"
  );
}

export function persistableLineHttpErrorClass(
  value: string | null | undefined,
): (typeof LINE_PERSISTED_HTTP_ERROR_CLASSES)[number] | null {
  if (
    value === "unauthorized" ||
    value === "forbidden" ||
    value === "invalid_request" ||
    value === "quota_exceeded" ||
    value === "timeout" ||
    value === "unknown"
  ) {
    return value;
  }
  if (
    value === "invalid_recipient" ||
    value === "invalid_message" ||
    value === "invalid_retry_key"
  ) {
    return "invalid_request";
  }
  return null;
}

export function classifyLineHttpError(input: {
  timedOut?: boolean;
  httpStatus?: number | null;
}): LineHttpErrorClass {
  if (input.timedOut) return "timeout";
  switch (input.httpStatus) {
    case 400:
      return "invalid_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 429:
      return "quota_exceeded";
    default:
      return "unknown";
  }
}

export function lineTestPushFailureMessage(errorClass: LineHttpErrorClass): string {
  switch (errorClass) {
    case "invalid_request":
      return "LINE API 拒絕這則測試發送（請求不合法）。系統不會自動重送。";
    case "invalid_recipient":
      return "收件者識別格式不合法，系統沒有呼叫 LINE，也不會自動重送。";
    case "invalid_message":
      return "測試文字不合法，系統沒有呼叫 LINE，也不會自動重送。";
    case "invalid_retry_key":
      return "Retry Key 格式不合法，系統沒有呼叫 LINE，也不會自動重送。";
    case "unauthorized":
      return "LINE API 拒絕這則測試發送（未授權）。系統不會自動重送。";
    case "forbidden":
      return "LINE API 拒絕這則測試發送（禁止存取）。系統不會自動重送。";
    case "quota_exceeded":
      return "LINE API 拒絕這則測試發送（額度或頻率超限）。系統不會自動重送。";
    case "timeout":
      return "LINE API 逾時，系統已標記待確認，不會自動重送";
    case "unknown":
      return "LINE API 拒絕這則測試發送。系統不會自動重送。";
  }
}

export function interpretLineTestPushApiOutcome(input: {
  timedOut: boolean;
  httpOk: boolean;
  httpStatus?: number | null;
  lineRequestId?: string | null;
  localErrorClass?: LineHttpErrorClass | null;
}): {
  apiResult: LineApiResult;
  status: LineBroadcastStatus;
  message: string;
  errorClass: LineHttpErrorClass | null;
} {
  if (input.timedOut) {
    return {
      apiResult: "pending_confirmation",
      status: "pending_confirmation",
      message: lineTestPushFailureMessage("timeout"),
      errorClass: "timeout",
    };
  }
  if (input.httpOk) {
    return {
      apiResult: "accepted",
      status: "accepted",
      message: "LINE API 已接受。不代表店長已收到。",
      errorClass: null,
    };
  }
  if (input.localErrorClass && isLineHttpErrorClass(input.localErrorClass)) {
    return {
      apiResult: "failed",
      status: "failed",
      message: lineTestPushFailureMessage(input.localErrorClass),
      errorClass: input.localErrorClass,
    };
  }
  const errorClass = classifyLineHttpError({
    timedOut: false,
    httpStatus: input.httpStatus,
  });
  return {
    apiResult: "failed",
    status: "failed",
    message: lineTestPushFailureMessage(errorClass),
    errorClass,
  };
}

export function lineTestPushEventDetail(input: {
  message?: string | null;
  httpStatus?: number | null;
  errorClass?: string | null;
}): string {
  const parts: string[] = [];
  const message = input.message?.trim() ?? "";
  if (message) parts.push(message);
  if (typeof input.httpStatus === "number") parts.push(`http=${input.httpStatus}`);
  if (isLineHttpErrorClass(input.errorClass)) parts.push(`class=${input.errorClass}`);
  return parts.join(" ").slice(0, 200);
}
