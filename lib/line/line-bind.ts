import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { tokenHintFromAccessToken } from "@/lib/line/line-crypto";

export const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/i;
export const LINE_CUSTOMER_BIND_PROOF_PREFIX = "line-customer-bind-v1";
export const LINE_CUSTOMER_BIND_HMAC_PREFIX = "line-customer-bind-hmac";

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

export function hashLineUserId(userId: string): string {
  return createHash("sha256").update(userId.trim(), "utf8").digest("hex");
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

export function deriveLineCustomerBindHmacKey(
  channelSecret: string,
  organizationId: string,
): string {
  return createHash("sha256")
    .update(`${LINE_CUSTOMER_BIND_HMAC_PREFIX}:${channelSecret}:${organizationId}`, "utf8")
    .digest("hex");
}

export function lineCustomerBindProofCanonical(input: {
  organizationId: string;
  publicToken: string;
  eventId: string;
  code: string;
  userIdHash: string;
  cipher: string;
  hint: string;
  keyId: string;
  issuedAtUnix: number;
}): string {
  return [
    LINE_CUSTOMER_BIND_PROOF_PREFIX,
    input.organizationId,
    input.publicToken,
    input.eventId,
    input.code.trim().toUpperCase(),
    input.userIdHash,
    input.cipher,
    input.hint,
    input.keyId,
    String(input.issuedAtUnix),
  ].join("\n");
}

export function createLineCustomerBindServerProof(input: {
  channelSecret: string;
  organizationId: string;
  publicToken: string;
  eventId: string;
  code: string;
  userIdHash: string;
  cipher: string;
  hint: string;
  keyId: string;
  issuedAt: Date;
}): { keyHex: string; proofHex: string; issuedAtUnix: number } {
  const issuedAtUnix = Math.floor(input.issuedAt.getTime() / 1000);
  const keyHex = deriveLineCustomerBindHmacKey(input.channelSecret, input.organizationId);
  const canonical = lineCustomerBindProofCanonical({
    organizationId: input.organizationId,
    publicToken: input.publicToken,
    eventId: input.eventId,
    code: input.code,
    userIdHash: input.userIdHash,
    cipher: input.cipher,
    hint: input.hint,
    keyId: input.keyId,
    issuedAtUnix,
  });
  return {
    keyHex,
    issuedAtUnix,
    proofHex: createHmac("sha256", Buffer.from(keyHex, "hex")).update(canonical, "utf8").digest("hex"),
  };
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
    };
  });
}

export function selectLineWebhookBindCandidate(events: LineWebhookTextEvent[]): {
  userId: string;
  code: string;
  eventId: string | null;
} | null {
  for (const event of events) {
    if (event.sourceType !== "user") continue;
    if (!isLineUserId(event.userId)) continue;
    const code = normalizeLineBindCode(event.text);
    if (!code) continue;
    return { userId: event.userId!, code, eventId: event.eventId?.trim() || null };
  }
  return null;
}
