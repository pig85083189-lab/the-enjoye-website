/**
 * Preview-only Appointment remote mutate flag.
 *
 * Server Components must import this file — not appointment-remote-mutate-pilot.ts.
 * The mutate factory pulls the adapter / table-store graph; sharing that graph
 * with a Calendar RSC page would recreate the 1C-5C client global-error.
 *
 * Production is always off. Requires Calendar remote-read and the existing
 * Appointment remote-write/create pilot. Independent of
 * BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 *
 * Do not add the Vercel env in 1C-6D.1 — the flag stays off in the current
 * deployment until a later Preview-only enablement slice.
 */

import { isAppointmentRemoteWritePilotEnabled } from "./appointment-remote-write-flag";
import { isCalendarRemoteReadPilotEnabled } from "./calendar-remote-read-flag";

export const APPOINTMENT_REMOTE_MUTATE_PILOT_ENV =
  "BEAUTY_OS_APPOINTMENT_REMOTE_MUTATE_PILOT";

export function isAppointmentRemoteMutatePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  if (env[APPOINTMENT_REMOTE_MUTATE_PILOT_ENV] !== "1") {
    return false;
  }
  if (!isCalendarRemoteReadPilotEnabled(env)) {
    return false;
  }
  return isAppointmentRemoteWritePilotEnabled(env);
}
