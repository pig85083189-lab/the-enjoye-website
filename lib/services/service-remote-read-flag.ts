/**
 * Service remote read flag.
 *
 * Server Components must import this file — not service-remote-read-pilot.ts —
 * when they only need the boolean. The pilot module pulls the adapter graph.
 *
 * Enabled only when the env is explicitly "1". Production default is off.
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Live Service Catalog stays on seed + localStorage until this flag is on.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";

export const SERVICE_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_SERVICE_REMOTE_READ_PILOT";

export function isServiceRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return isExplicitRemotePilotEnabled(SERVICE_REMOTE_READ_PILOT_ENV, env);
}
