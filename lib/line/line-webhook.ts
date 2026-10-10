/**
 * Server-only LINE webhook bind processor.
 * Verifies Channel Secret signature, then binds the messaging user.
 * Never accepts a client-supplied User ID. Never Push / Broadcast.
 */

import {
  extractLineWebhookTextEvents,
  lineUserIdHint,
  selectLineWebhookBindCandidate,
  verifyLineWebhookSignature,
} from "@/lib/line/line-bind";

export type LineWebhookBindResult =
  | { ok: true; bound: boolean; hint?: string }
  | { ok: false; reason: "unauthorized" | "invalid_input" | "error"; message: string };

export async function processLineWebhookBind(input: {
  organizationId: string;
  rawBody: string;
  signature: string | null;
  channelSecret: string | null;
  encryptUserId: (userId: string) => { cipher: string; keyId: string } | null;
  consume: (input: {
    organizationId: string;
    code: string;
    cipher: string;
    hint: string;
    keyId: string;
  }) => Promise<{ bound: boolean }>;
}): Promise<LineWebhookBindResult> {
  if (typeof window !== "undefined") {
    throw new Error("LINE webhook cannot run in the browser");
  }
  if (!input.organizationId.startsWith("org-")) {
    return { ok: false, reason: "unauthorized", message: "店家識別不合法" };
  }
  if (!input.channelSecret) {
    return { ok: false, reason: "unauthorized", message: "找不到可驗證的 Channel Secret" };
  }
  if (
    !verifyLineWebhookSignature({
      rawBody: input.rawBody,
      channelSecret: input.channelSecret,
      signature: input.signature,
    })
  ) {
    return { ok: false, reason: "unauthorized", message: "LINE 簽章驗證失敗" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody) as unknown;
  } catch {
    return { ok: false, reason: "invalid_input", message: "Webhook 內容無法解析" };
  }
  const candidate = selectLineWebhookBindCandidate(extractLineWebhookTextEvents(payload));
  if (!candidate) {
    return { ok: true, bound: false };
  }
  const packed = input.encryptUserId(candidate.userId);
  if (!packed) {
    return { ok: false, reason: "error", message: "無法加密收件者識別" };
  }
  const consumed = await input.consume({
    organizationId: input.organizationId,
    code: candidate.code,
    cipher: packed.cipher,
    hint: lineUserIdHint(candidate.userId),
    keyId: packed.keyId,
  });
  return { ok: true, bound: consumed.bound, hint: lineUserIdHint(candidate.userId) };
}
