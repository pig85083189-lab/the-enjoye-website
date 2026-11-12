/**
 * Staff login-invite pilot flag.
 *
 * Server Components must import this file — not invite adapters.
 * Default is off. Independent of BEAUTY_OS_STAFF_REMOTE_WRITE_PILOT
 * and BEAUTY_OS_STAFF_REMOTE_CREATE_PILOT (createUser + password stays closed).
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";

export const STAFF_INVITE_PILOT_ENV = "BEAUTY_OS_STAFF_INVITE_PILOT";

/** Explicit server-side opt-in. Defaults off; never exposed as NEXT_PUBLIC. */
export const STAFF_INVITE_SEND_ENV = "BEAUTY_OS_STAFF_INVITE_SEND_ENABLED";
export const STAFF_INVITE_SEND_OPEN = false;

export function isStaffInvitePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isExplicitRemotePilotEnabled(STAFF_INVITE_PILOT_ENV, env)) {
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

export function isStaffInviteSendOpen(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return isStaffInvitePilotEnabled(env) && isExplicitRemotePilotEnabled(STAFF_INVITE_SEND_ENV, env);
}
