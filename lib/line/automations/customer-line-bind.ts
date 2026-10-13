import { hashLineUserId, isLineUserId, lineUserIdHint, normalizeLineBindCode } from "@/lib/line/line-bind";
import type { LineWebhookTextEvent } from "@/lib/line/line-bind";

export const CUSTOMER_UNSUBSCRIBE_PATTERN = /^(退訂|取消訂閱|UNSUBSCRIBE)$/i;
export const CUSTOMER_UNBIND_PATTERN = /^(解除綁定|UNBIND)$/i;

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
    hash: hashLineUserId(input.organizationId, input.userId),
    hint: lineUserIdHint(input.userId),
    keyId: input.keyId,
  };
}

export function evaluateCustomerBindCode(text: string | null | undefined): string | null {
  return normalizeLineBindCode(text);
}
