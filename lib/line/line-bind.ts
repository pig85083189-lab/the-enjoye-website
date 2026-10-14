import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { tokenHintFromAccessToken } from "@/lib/line/line-crypto";
import { LINE_CREDENTIAL_KEY_ENV } from "@/lib/line/line-flag";

export const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/i;

export function isLineUserId(value: string | null | undefined): boolean {
  return Boolean(value && LINE_USER_ID_PATTERN.test(value.trim()));
}

export function lineUserIdHint(userId: string): string {
  return tokenHintFromAccessToken(userId);
}

export function hashLineBindCode(organizationId: string, code: string): string {
  return createHash("sha256")
    .update(`${organizationId}:${code.trim().toUpperCase()}`, "utf8")
    .digest("hex");
}

function readLineUserIdHmacKey(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Buffer | null {
  const raw = (env[LINE_CREDENTIAL_KEY_ENV] ?? "").trim();
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

/**
 * Org-scoped LINE userId identifier. HMAC-SHA256 with the server credential key.
 * Never send this hash to the browser. Fail-closed empty string if the key is missing.
 */
export function hashLineUserId(
  organizationId: string,
  userId: string,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): string {
  if (typeof window !== "undefined") {
    throw new Error("LINE userId hash cannot run in the browser");
  }
  const key = readLineUserIdHmacKey(env);
  if (!key) return "";
  return createHmac("sha256", key)
    .update(`${organizationId}:${userId.trim()}`, "utf8")
    .digest("hex");
}

export function hashLineWebhookPublicToken(organizationId: string, token: string): string {
  return createHash("sha256")
    .update(`${organizationId}:${token.trim()}`, "utf8")
    .digest("hex");
}

export function isLineWebhookPublicToken(value: string | null | undefined): boolean {
  return Boolean(value && /^[A-Za-z0-9_-]{32,128}$/.test(value.trim()));
}

export function normalizeLineBindCode(text: string | null | undefined): string | null {
  const compact = (text ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(compact)) return null;
  return compact;
}

export function verifyLineWebhookSignature(input: {
  rawBody: string;
  channelSecret: string;
  signature: string | null | undefined;
}): boolean {
  if (typeof window !== "undefined") {
    throw new Error("LINE webhook verify cannot run in the browser");
  }
  const provided = (input.signature ?? "").trim();
  if (!provided || !input.channelSecret) return false;
  const expected = createHmac("sha256", input.channelSecret).update(input.rawBody).digest("base64");
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type LineWebhookTextEvent = {
  eventId?: string | null;
  isRedelivery?: boolean;
  sourceType: string | null;
  userId: string | null;
  text: string | null;
  eventType?: string | null;
};

export function extractLineWebhookTextEvents(payload: unknown): LineWebhookTextEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  return events.map((event) => {
    const row = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
    const source = row.source && typeof row.source === "object" ? (row.source as Record<string, unknown>) : {};
    const message = row.message && typeof row.message === "object" ? (row.message as Record<string, unknown>) : {};
    const delivery =
      row.deliveryContext && typeof row.deliveryContext === "object"
        ? (row.deliveryContext as Record<string, unknown>)
        : {};
    return {
      eventId: typeof row.webhookEventId === "string" ? row.webhookEventId : null,
      isRedelivery: delivery.isRedelivery === true,
      sourceType: typeof source.type === "string" ? source.type : null,
      userId: typeof source.userId === "string" ? source.userId : null,
      text: typeof message.text === "string" ? message.text : null,
      eventType: typeof row.type === "string" ? row.type : null,
    };
  });
}

export function selectLineWebhookBindCandidate(events: LineWebhookTextEvent[]): {
  userId: string;
  code: string;
} | null {
  for (const event of events) {
    if (event.sourceType !== "user") continue;
    if (!isLineUserId(event.userId)) continue;
    const code = normalizeLineBindCode(event.text);
    if (!code) continue;
    return { userId: event.userId!, code };
  }
  return null;
}
