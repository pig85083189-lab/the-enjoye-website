/**
 * Preview-only Calendar remote appointment read flag.
 *
 * Server Components must import this file — not calendar-remote-read-pilot.ts.
 * The pilot module pulls the adapter / identity catalog graph; sharing that
 * graph with the RSC calendar page would recreate the Customer 360
 * global-error failure mode.
 *
 * Independent of BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT and
 * BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT.
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Production is always off, even if the env is present.
 */

export const CALENDAR_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_CALENDAR_REMOTE_READ_PILOT";

export function isCalendarRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  return env[CALENDAR_REMOTE_READ_PILOT_ENV] === "1";
}
