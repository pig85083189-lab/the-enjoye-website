/**
 * Commerce remote write flag.
 *
 * Server Components must import this file — not commerce-remote-write-pilot.ts.
 * The write factory pulls the adapter / identity catalog / RPC graph.
 *
 * Production default is off. Write requires the Commerce remote-read foundation.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE
 * and of Customer / Appointment / Treatment / Staff pilots.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";
import { isCommerceRemoteReadPilotEnabled } from "./commerce-remote-read-flag";

export const COMMERCE_REMOTE_WRITE_PILOT_ENV =
  "BEAUTY_OS_COMMERCE_REMOTE_WRITE_PILOT";

export function isCommerceRemoteWritePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isExplicitRemotePilotEnabled(COMMERCE_REMOTE_WRITE_PILOT_ENV, env)) {
    return false;
  }
  return isCommerceRemoteReadPilotEnabled(env);
}
