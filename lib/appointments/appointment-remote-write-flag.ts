/**
 * Preview-only Appointment remote write flag.
 *
 * Server Components must import this file — not appointment-remote-write-pilot.ts.
 * The write factory pulls the adapter / table-store graph; sharing that graph
 * with the Calendar RSC page would recreate the 1C-5C client global-error.
 *
 * Preview-only Owner Calendar create. Production is always off.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Requires the Calendar remote-read foundation.
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
