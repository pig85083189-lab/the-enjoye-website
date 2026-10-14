/**
 * Server-only LINE credential encryption. AES-256-GCM.
 * Never import from Client Components.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { LINE_CREDENTIAL_KEY_ENV, LINE_CREDENTIAL_KEY_ID } from "@/lib/line/line-flag";

const PREFIX = "v1";

export function tokenHintFromAccessToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length < 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

export function fingerprintSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function readKey(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Buffer | null {
  if (typeof window !== "undefined") {
    throw new Error("LINE credential crypto cannot run in the browser");
  }
  const raw = (env[LINE_CREDENTIAL_KEY_ENV] ?? "").trim();
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function canEncryptLineCredentials(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  try {
    return Boolean(readKey(env));
  } catch {
    return false;
  }
}

export function encryptLineCredential(
  plaintext: string,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): { ok: true; cipher: string; keyId: string } | { ok: false; message: string } {
  const key = readKey(env);
  if (!key) {
    return { ok: false, message: "LINE 憑證加密金鑰尚未設定" };
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ok: true,
    keyId: LINE_CREDENTIAL_KEY_ID,
    cipher: [PREFIX, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(
      ".",
    ),
  };
}

export function decryptLineCredential(
  packed: string,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): { ok: true; plaintext: string } | { ok: false; message: string } {
  const key = readKey(env);
  if (!key) {
    return { ok: false, message: "LINE 憑證加密金鑰尚未設定" };
  }
  const parts = packed.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    return { ok: false, message: "憑證格式不正確" };
  }
  try {
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const data = Buffer.from(parts[3]!, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return { ok: true, plaintext };
  } catch {
    return { ok: false, message: "憑證解密失敗" };
  }
}
