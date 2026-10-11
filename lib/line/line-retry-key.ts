/**
 * LINE X-Line-Retry-Key must be a hexadecimal UUID.
 * Internal ltsq-/lbrq- request IDs are never sent as the Retry-Key.
 */

import { createHash } from "node:crypto";

export const LINE_RETRY_KEY_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable namespace for deriving a UUID v5 from our request id. Not a secret. */
export const LINE_RETRY_KEY_NAMESPACE = "3c1a6d2e-7b54-4a91-9f0c-2d8e4b17a6f3";

export function isLineRetryKey(value: string | null | undefined): boolean {
  return Boolean(value && LINE_RETRY_KEY_UUID_PATTERN.test(value.trim()));
}

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

export function lineRetryKeyFromRequestId(requestId: string): string {
  const hash = createHash("sha1")
    .update(uuidToBytes(LINE_RETRY_KEY_NAMESPACE))
    .update(requestId.trim(), "utf8")
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
