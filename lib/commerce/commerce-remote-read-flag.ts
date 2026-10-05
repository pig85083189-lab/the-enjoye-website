/**
 * Commerce remote identity / readiness flag.
 *
 * Server Components must import this file — not commerce-remote-read-pilot.ts.
 * The pilot module pulls the adapter / identity catalog graph.
 *
 * Enabled only when the env is explicitly "1". Production default is off.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE
 * and of Customer / Appointment / Treatment / Staff pilots.
 *
 * This flag does not enable remote CheckoutDraft persist, settle, or
 * Transaction writes.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";

export const COMMERCE_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_COMMERCE_REMOTE_READ_PILOT";

export function isCommerceRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return isExplicitRemotePilotEnabled(COMMERCE_REMOTE_READ_PILOT_ENV, env);
}
