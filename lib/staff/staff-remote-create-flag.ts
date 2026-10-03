/**
 * Preview-only Owner Staff remote create flag.
 *
 * Server Components must import this file — not staff-remote-create-pilot.ts.
 * Production is always off. Independent of BEAUTY_OS_PERSISTENCE /
 * BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE. Requires authenticated Supabase Staff Auth.
 */

export const STAFF_REMOTE_CREATE_PILOT_ENV = "BEAUTY_OS_STAFF_REMOTE_CREATE_PILOT";

export function isStaffRemoteCreatePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  if (env[STAFF_REMOTE_CREATE_PILOT_ENV] !== "1") {
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
