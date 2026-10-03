/**
 * Preview-only Appointment remote write flag.
 *
 * Server Components must import this file — not appointment-remote-write-pilot.ts.
 * The write factory pulls the adapter / table-store graph; sharing that graph
 * with the Calendar RSC page would recreate the 1C-5C client global-error.
 *
 * Design only for Phase 1C-6B.1. Do not set the env.
 * Production is always off, even if the env is present.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Requires the Calendar remote-read foundation (intended create surface).
 */

import { isCalendarRemoteReadPilotEnabled } from "./calendar-remote-read-flag";

export const APPOINTMENT_REMOTE_WRITE_PILOT_ENV =
  "BEAUTY_OS_APPOINTMENT_REMOTE_WRITE_PILOT";

export function isAppointmentRemoteWritePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  if (env[APPOINTMENT_REMOTE_WRITE_PILOT_ENV] !== "1") {
    return false;
  }
  return isCalendarRemoteReadPilotEnabled(env);
}
