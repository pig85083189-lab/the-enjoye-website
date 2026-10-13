import { hashLineUserId, isLineUserId, lineUserIdHint, normalizeLineBindCode } from "@/lib/line/line-bind";
import type { LineWebhookTextEvent } from "@/lib/line/line-bind";

export const CUSTOMER_CONSENT_PATTERN = /^(同意預約提醒|訂閱預約提醒|CONSENT|SUBSCRIBE)$/i;
export const CUSTOMER_UNSUBSCRIBE_PATTERN = /^(退訂|取消訂閱|UNSUBSCRIBE)$/i;
export const CUSTOMER_UNBIND_PATTERN = /^(解除綁定|UNBIND)$/i;

export function selectCustomerConsentEvent(events: LineWebhookTextEvent[]): {
  userId: string;
} | null {
  for (const event of events) {
    if (event.sourceType !== "user" || !isLineUserId(event.userId)) continue;
    if (event.text && CUSTOMER_CONSENT_PATTERN.test(event.text.trim())) {
      return { userId: event.userId! };
    }
  }
  return null;
}

export function selectCustomerUnsubscribeEvent(events: LineWebhookTextEvent[]): {
  userId: string;
} | null {
  for (const event of events) {
    if (event.sourceType !== "user" || !isLineUserId(event.userId)) continue;
    if (event.text && CUSTOMER_UNSUBSCRIBE_PATTERN.test(event.text.trim())) {
      return { userId: event.userId! };
    }
  }
  return null;
}

export function selectCustomerUnbindEvent(events: LineWebhookTextEvent[]): {
  userId: string;
} | null {
  for (const event of events) {
    if (event.sourceType !== "user" || !isLineUserId(event.userId)) continue;
    if (event.text && CUSTOMER_UNBIND_PATTERN.test(event.text.trim())) {
      return { userId: event.userId! };
    }
  }
  return null;
}

export function selectCustomerUnfollowEvent(events: LineWebhookTextEvent[]): {
  userId: string;
} | null {
  for (const event of events) {
    if (event.eventType !== "unfollow" && event.eventType !== "blocked") continue;
    if (event.sourceType !== "user" || !isLineUserId(event.userId)) continue;
    return { userId: event.userId! };
  }
  return null;
}

export function packCustomerBindIdentity(input: {
  organizationId: string;
  userId: string;
  cipher: string;
  keyId: string;
  env?: NodeJS.Dict<string>;
}): {
  organizationId: string;
  cipher: string;
  hash: string;
  hint: string;
  keyId: string;
} {
  return {
    organizationId: input.organizationId,
    cipher: input.cipher,
    hash: hashLineUserId(input.organizationId, input.userId, input.env),
    hint: lineUserIdHint(input.userId),
    keyId: input.keyId,
  };
}

export function evaluateCustomerBindCode(text: string | null | undefined): string | null {
  return normalizeLineBindCode(text);
}

export function interpretStartLineCustomerBindResult(input: {
  error: unknown;
  data: unknown;
}):
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; reason: "rate_limited" | "attempt_limited" | "error"; message: string } {
  const payload = input.data && typeof input.data === "object" ? (input.data as Record<string, unknown>) : {};
  const reason = String(payload.reason ?? "");
  if (reason === "rate_limited") {
    return { ok: false, reason: "rate_limited", message: "驗證碼產生過於頻繁，請稍後再試。" };
  }
  if (reason === "attempt_limited") {
    return {
      ok: false,
      reason: "attempt_limited",
      message: "驗證嘗試次數過多，已暫時鎖定。請稍後再試。",
    };
  }
  const code = String(payload.code ?? "");
  const expiresAt = String(payload.expires_at ?? "");
  if (input.error || !/^[0-9A-F]{8}$/.test(code)) {
    return { ok: false, reason: "error", message: "無法產生客人綁定驗證碼" };
  }
  return { ok: true, code, expiresAt };
}
