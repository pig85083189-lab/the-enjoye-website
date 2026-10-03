/**
 * Preview-only Today remote appointment read flag.
 *
 * Server Components must import this file — not today-remote-read-pilot.ts.
 * Independent of Customer, Appointment 360, and Calendar pilots.
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Production is always off, even if the env is present.
 */

export const TODAY_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_TODAY_REMOTE_READ_PILOT";

export function isTodayRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  return env[TODAY_REMOTE_READ_PILOT_ENV] === "1";
}
