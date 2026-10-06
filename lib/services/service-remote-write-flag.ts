/**
 * Service remote write flag.
 *
 * Server Components must import this file — not service-remote-write-pilot.ts.
 * The write factory pulls the adapter / table-store graph.
 *
 * Explicit authenticated create. Production default is off.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Requires the Service remote-read foundation.
 * Create-only: EDIT / ACTIVE toggle stay off on this flag.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";
import { isServiceRemoteReadPilotEnabled } from "./service-remote-read-flag";

export const SERVICE_REMOTE_WRITE_PILOT_ENV = "BEAUTY_OS_SERVICE_REMOTE_WRITE_PILOT";

export function isServiceRemoteWritePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isExplicitRemotePilotEnabled(SERVICE_REMOTE_WRITE_PILOT_ENV, env)) {
    return false;
  }
  return isServiceRemoteReadPilotEnabled(env);
}
