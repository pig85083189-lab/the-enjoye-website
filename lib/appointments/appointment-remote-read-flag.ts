/**
 * Appointment remote read flag.
 *
 * Server Components must import this file — not appointment-remote-read-pilot.ts.
 * The pilot module pulls the adapter / identity catalog graph; sharing that
 * graph between the RSC page and the Client hook crashed the Customer 360
 * page with Next.js client global-error ("This page couldn’t load").
 *
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Enabled only when the env is explicitly "1". Production default is off.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/persistence/remote-pilot-flag";

export const APPOINTMENT_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT";

export function isAppointmentRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return isExplicitRemotePilotEnabled(APPOINTMENT_REMOTE_READ_PILOT_ENV, env);
}
