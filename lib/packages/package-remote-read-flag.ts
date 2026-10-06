/**
 * Package remote read flag.
 *
 * Server Components must import this file — not package-remote-read-pilot.ts —
 * when they only need the boolean. The pilot module pulls the adapter graph.
 *
 * Enabled only when the env is explicitly "1". Production default is off.
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Live Package catalog / Customer Package wallet stay on localStorage until
 * this flag is on.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";

export const PACKAGE_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_PACKAGE_REMOTE_READ_PILOT";

export function isPackageRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return isExplicitRemotePilotEnabled(PACKAGE_REMOTE_READ_PILOT_ENV, env);
}
