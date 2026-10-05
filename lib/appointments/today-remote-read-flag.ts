/**
 * Today remote appointment read flag.
 *
 * Server Components must import this file — not today-remote-read-pilot.ts.
 * Independent of Customer, Appointment 360, and Calendar pilots.
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Enabled only when the env is explicitly "1". Production default is off.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";

export const TODAY_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_TODAY_REMOTE_READ_PILOT";

export function isTodayRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return isExplicitRemotePilotEnabled(TODAY_REMOTE_READ_PILOT_ENV, env);
}
