/**
 * LINE Official Account / broadcast flags.
 *
 * Server Components must import this file — not send adapters.
 * Phase 1 send is hardcoded closed. Owner enable is a second gate only.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";

export const LINE_CREDENTIAL_KEY_ENV = "BEAUTY_OS_LINE_CREDENTIAL_KEY";
export const LINE_CONNECTION_PILOT_ENV = "BEAUTY_OS_LINE_CONNECTION_PILOT";
export const LINE_WEBHOOK_HOST_ENV = "BEAUTY_OS_LINE_WEBHOOK_HOST";
export const LINE_WEBHOOK_BASE_URL_ENV = "BEAUTY_OS_LINE_WEBHOOK_BASE_URL";

/** Phase 1B: real send stays hardcoded closed. Do not flip on Preview. */
export const LINE_BROADCAST_SEND_OPEN = false;

/** Phase 1C: Owner test Push stays independently closed. */
export const LINE_TEST_PUSH_OPEN = false;

export const LINE_BROADCAST_DAILY_LIMIT = 3;
export const LINE_TEST_PUSH_DAILY_LIMIT = 3;
export const LINE_BROADCAST_TEXT_MAX = 5000;
export const LINE_CREDENTIAL_KEY_ID = "line-cred-v1";
export const LINE_BIND_CODE_TTL_MINUTES = 10;
export const LINE_BIND_MAX_ATTEMPTS = 5;

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

export function isLineTestPushOpen(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return isLineConnectionPilotEnabled(env) && LINE_TEST_PUSH_OPEN;
}

export function hasLineCredentialKey(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return Boolean((env[LINE_CREDENTIAL_KEY_ENV] ?? "").trim());
}
