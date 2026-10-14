/**
 * LINE Official Account / broadcast flags.
 *
 * Server Components must import this file — not send adapters.
 * Broadcast send stays hardcoded closed. Test Push may open only via a
 * Preview-only org allowlist; the hardcoded constant must stay false.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";
import { ORG_BEAUTY_OS_TEST_ID } from "@/lib/tenant/constants";

export const LINE_CREDENTIAL_KEY_ENV = "BEAUTY_OS_LINE_CREDENTIAL_KEY";
export const LINE_CONNECTION_PILOT_ENV = "BEAUTY_OS_LINE_CONNECTION_PILOT";
export const LINE_WEBHOOK_HOST_ENV = "BEAUTY_OS_LINE_WEBHOOK_HOST";
export const LINE_WEBHOOK_BASE_URL_ENV = "BEAUTY_OS_LINE_WEBHOOK_BASE_URL";
export const LINE_TEST_PUSH_OPEN_ENV = "BEAUTY_OS_LINE_TEST_PUSH_OPEN";
export const LINE_TEST_PUSH_ORG_ENV = "BEAUTY_OS_LINE_TEST_PUSH_ORG";
export const LINE_BROADCAST_FORMAL_OPEN_ENV = "BEAUTY_OS_LINE_BROADCAST_FORMAL_OPEN";
export const LINE_BROADCAST_FORMAL_ORG_ENV = "BEAUTY_OS_LINE_BROADCAST_FORMAL_ORG";

/** Phase 1B: real send stays hardcoded closed. Do not add an env bypass. */
export const LINE_BROADCAST_SEND_OPEN = false;

/** Fail-closed marker. Do not flip. Formal send uses a separate env allowlist. */
export const LINE_BROADCAST_FORMAL_OPEN = false;

/** Fail-closed marker. Do not flip. The only open path is the Preview allowlist. */
export const LINE_TEST_PUSH_OPEN = false;

/** Preview-only one-shot Broadcast. Never an env bypass for the global flag. */
export const LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID = ORG_BEAUTY_OS_TEST_ID;
export const LINE_BROADCAST_ONESHOT_CHANNEL_ID = "2009219238";
export const LINE_BROADCAST_ONESHOT_BOT_DISPLAY_NAME = "ai";
export const LINE_BROADCAST_ONESHOT_BOT_BASIC_ID = "@357gospk";
export const LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST =
  "bfzquejrtgqzzarhkiya.supabase.co";
export const LINE_BROADCAST_FORMAL_PRODUCTION_SUPABASE_HOST =
  "knccefcxncglgpmvgqlp.supabase.co";
export const LINE_BROADCAST_ONESHOT_TEXT =
  "【LINE 群發功能測試】\n這是一則系統功能測試訊息，無需回覆，謝謝。";
export const LINE_BROADCAST_ONESHOT_TEXT_SHA256 =
  "68ca91c946ed5b09a90884943fc96c653e7b5ad05d55dcdd7dece071e4a6315e";

export const LINE_BROADCAST_DAILY_LIMIT = 3;
export const LINE_TEST_PUSH_DAILY_LIMIT = 3;
export const LINE_BROADCAST_TEXT_MAX = 5000;
export const LINE_CREDENTIAL_KEY_ID = "line-cred-v1";
export const LINE_BIND_CODE_TTL_MINUTES = 10;
export const LINE_BIND_MAX_ATTEMPTS = 5;
export const LINE_TEST_PUSH_ALLOWED_ORG_ID = ORG_BEAUTY_OS_TEST_ID;

export function isLineConnectionPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isExplicitRemotePilotEnabled(LINE_CONNECTION_PILOT_ENV, env)) {
    return false;
  }
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const publishable = (
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  ).trim();
  return Boolean(url && publishable);
}

export function isLineBroadcastSendOpen(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return isLineConnectionPilotEnabled(env) && LINE_BROADCAST_SEND_OPEN;
}

function lineSupabaseHostname(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): string | null {
  const raw = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

export function isLineBroadcastFormalEnvironmentOpen(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim();
  const hostname = lineSupabaseHostname(env);
  if (!hostname) return false;
  if (vercelEnv === "preview") {
    return hostname === LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST;
  }
  if (vercelEnv === "production") {
    return hostname === LINE_BROADCAST_FORMAL_PRODUCTION_SUPABASE_HOST;
  }
  return false;
}

/** Env allowlist only. Never opens via LINE_BROADCAST_SEND_OPEN. TEST stays oneshot-only. */
export function isLineBroadcastFormalOpen(
  input: {
    organizationId?: string | null;
    env?: NodeJS.Dict<string>;
  } = {},
): boolean {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  if (!isLineConnectionPilotEnabled(env)) {
    return false;
  }
  if (!isLineBroadcastFormalEnvironmentOpen(env)) {
    return false;
  }
  if (!isExplicitRemotePilotEnabled(LINE_BROADCAST_FORMAL_OPEN_ENV, env)) {
    return false;
  }
  const organizationId = (input.organizationId ?? "").trim();
  if (!organizationId || organizationId === LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID) {
    return false;
  }
  return (env[LINE_BROADCAST_FORMAL_ORG_ENV] ?? "").trim() === organizationId;
}

export function isLineBroadcastOneshotEnvironmentOpen(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if ((env.VERCEL_ENV ?? "").trim() !== "preview") {
    return false;
  }
  const raw = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!raw) return false;
  try {
    return new URL(raw).hostname === LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST;
  } catch {
    return false;
  }
}

export function isLineTestPushOpen(
  input: {
    organizationId?: string | null;
    env?: NodeJS.Dict<string>;
  } = {},
): boolean {
  const env =
    input.env ?? (typeof process !== "undefined" ? process.env : {});
  if (!isLineConnectionPilotEnabled(env)) {
    return false;
  }
  if ((env.VERCEL_ENV ?? "").trim() === "production") {
    return false;
  }
  if (!isExplicitRemotePilotEnabled(LINE_TEST_PUSH_OPEN_ENV, env)) {
    return false;
  }
  const allowedOrg = (env[LINE_TEST_PUSH_ORG_ENV] ?? "").trim();
  const organizationId = (input.organizationId ?? "").trim();
  if (allowedOrg !== LINE_TEST_PUSH_ALLOWED_ORG_ID) {
    return false;
  }
  if (organizationId !== LINE_TEST_PUSH_ALLOWED_ORG_ID) {
    return false;
  }
  return true;
}

export function resolveLineTestPushTransport(
  input: {
    organizationId?: string | null;
    env?: NodeJS.Dict<string>;
  } = {},
): { open: true; organizationId: string } | { open: false } {
  const organizationId = (input.organizationId ?? "").trim();
  if (!isLineTestPushOpen({ organizationId, env: input.env })) {
    return { open: false };
  }
  return { open: true, organizationId };
}

export function hasLineCredentialKey(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return Boolean((env[LINE_CREDENTIAL_KEY_ENV] ?? "").trim());
}
