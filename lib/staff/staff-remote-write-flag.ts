/**
 * Staff operational CREATE flag (no Auth provisioning).
 *
 * Server Components must import this file — not staff-remote-write-pilot.ts.
 * Production default is off. Independent of BEAUTY_OS_PERSISTENCE /
 * BEAUTY_OS_STAFF_REMOTE_CREATE_PILOT (Auth + password path stays closed).
 * Requires authenticated Supabase Staff Auth.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";

export const STAFF_REMOTE_WRITE_PILOT_ENV = "BEAUTY_OS_STAFF_REMOTE_WRITE_PILOT";

export function isStaffRemoteWritePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isExplicitRemotePilotEnabled(STAFF_REMOTE_WRITE_PILOT_ENV, env)) {
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

/**
 * Client submit env. Next.js only inlines NEXT_PUBLIC_* on static property
 * access. Spreading `process.env` in the browser drops those keys and
 * fail-closes the write runner before create_operational_staff is called.
 */
export function staffRemoteWriteBrowserEnv(
  override?: NodeJS.Dict<string>,
): NodeJS.Dict<string> {
  return {
    [STAFF_REMOTE_WRITE_PILOT_ENV]: "1",
    NEXT_PUBLIC_SUPABASE_URL:
      override?.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      override?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      override?.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}
