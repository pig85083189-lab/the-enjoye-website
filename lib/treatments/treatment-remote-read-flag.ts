/**
 * Treatment remote read flag.
 *
 * Server Components must import this file — not treatment-remote-read-pilot.ts.
 * The pilot module pulls the adapter / identity catalog graph.
 *
 * Enabled only when the env is explicitly "1". Production default is off.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE
 * and of Customer / Appointment / Staff pilots.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";

export const TREATMENT_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_TREATMENT_REMOTE_READ_PILOT";

export function isTreatmentRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return isExplicitRemotePilotEnabled(TREATMENT_REMOTE_READ_PILOT_ENV, env);
}
