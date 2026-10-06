/**
 * Package remote write flag.
 *
 * Server Components must import this file — not a write-pilot factory.
 * Production default is off. Write requires the Package remote-read foundation.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 *
 * Opens Package Definition CREATE only.
 * Does not open Customer Package fulfillment, redemption, or ledger writes.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";
import { isPackageRemoteReadPilotEnabled } from "./package-remote-read-flag";

export const PACKAGE_REMOTE_WRITE_PILOT_ENV = "BEAUTY_OS_PACKAGE_REMOTE_WRITE_PILOT";

export function isPackageRemoteWritePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isExplicitRemotePilotEnabled(PACKAGE_REMOTE_WRITE_PILOT_ENV, env)) {
    return false;
  }
  return isPackageRemoteReadPilotEnabled(env);
}
