/**
 * Appointment remote write flag.
 *
 * Server Components must import this file — not appointment-remote-write-pilot.ts.
 * The write factory pulls the adapter / table-store graph; sharing that graph
 * with the Calendar RSC page would recreate the 1C-5C client global-error.
 *
 * Explicit Owner Calendar create. Production default is off.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Requires the Calendar remote-read foundation.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/persistence/remote-pilot-flag";
import { isCalendarRemoteReadPilotEnabled } from "./calendar-remote-read-flag";

export const APPOINTMENT_REMOTE_WRITE_PILOT_ENV =
  "BEAUTY_OS_APPOINTMENT_REMOTE_WRITE_PILOT";

export function isAppointmentRemoteWritePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isExplicitRemotePilotEnabled(APPOINTMENT_REMOTE_WRITE_PILOT_ENV, env)) {
    return false;
  }
  return isCalendarRemoteReadPilotEnabled(env);
}
