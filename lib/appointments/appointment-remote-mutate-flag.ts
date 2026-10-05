/**
 * Appointment remote mutate flag.
 *
 * Server Components must import this file — not appointment-remote-mutate-pilot.ts.
 * The mutate factory pulls the adapter / table-store graph; sharing that graph
 * with a Calendar RSC page would recreate the 1C-5C client global-error.
 *
 * Production default is off. Requires Calendar remote-read and the existing
 * Appointment remote-write/create pilot. Independent of
 * BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/persistence/remote-pilot-flag";
import { isAppointmentRemoteWritePilotEnabled } from "./appointment-remote-write-flag";
import { isCalendarRemoteReadPilotEnabled } from "./calendar-remote-read-flag";

export const APPOINTMENT_REMOTE_MUTATE_PILOT_ENV =
  "BEAUTY_OS_APPOINTMENT_REMOTE_MUTATE_PILOT";

export function isAppointmentRemoteMutatePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isExplicitRemotePilotEnabled(APPOINTMENT_REMOTE_MUTATE_PILOT_ENV, env)) {
    return false;
  }
  if (!isCalendarRemoteReadPilotEnabled(env)) {
    return false;
  }
  return isAppointmentRemoteWritePilotEnabled(env);
}
