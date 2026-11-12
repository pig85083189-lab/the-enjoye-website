import { LINE_BIND_MAX_ATTEMPTS } from "@/lib/line/line-flag";

export type LineBindAttemptReason = "expired" | "invalid_input" | "attempt_limited";

export function evaluateLineBindAttempt(input: {
  nowMs: number;
  expiresAtMs: number;
  failedAttempts: number;
  codeHash: string;
  providedHash: string;
  maxAttempts?: number;
}):
  | { ok: true }
  | { ok: false; reason: LineBindAttemptReason; nextAttempts: number; burn: boolean } {
  const maxAttempts = input.maxAttempts ?? LINE_BIND_MAX_ATTEMPTS;
  if (input.expiresAtMs <= input.nowMs) {
    return { ok: false, reason: "expired", nextAttempts: input.failedAttempts, burn: true };
  }
  if (input.codeHash === input.providedHash) {
    return { ok: true };
  }
  const nextAttempts = input.failedAttempts + 1;
  if (nextAttempts >= maxAttempts) {
    return { ok: false, reason: "attempt_limited", nextAttempts, burn: true };
  }
  return { ok: false, reason: "invalid_input", nextAttempts, burn: false };
}

export function evaluateLineWebhookEventClaim(input: {
  seenEventIds: ReadonlySet<string>;
  eventId: string | null | undefined;
}): { accept: boolean; duplicate: boolean } {
  const eventId = input.eventId?.trim() ?? "";
  if (!eventId) return { accept: true, duplicate: false };
  if (input.seenEventIds.has(eventId)) {
    return { accept: false, duplicate: true };
  }
  return { accept: true, duplicate: false };
}
