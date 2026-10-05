/**
 * Calendar remote appointment read flag.
 *
 * Server Components must import this file — not calendar-remote-read-pilot.ts.
 * The pilot module pulls the adapter / identity catalog graph; sharing that
 * graph with the RSC calendar page would recreate the Customer 360
 * global-error failure mode.
 *
 * Independent of BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT and
 * BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT.
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Enabled only when the env is explicitly "1". Production default is off.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/persistence/remote-pilot-flag";

export const CALENDAR_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_CALENDAR_REMOTE_READ_PILOT";

export function isCalendarRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return isExplicitRemotePilotEnabled(CALENDAR_REMOTE_READ_PILOT_ENV, env);
}
