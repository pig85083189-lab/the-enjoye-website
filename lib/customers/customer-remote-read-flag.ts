/**
 * Customer remote read flag.
 *
 * Server Components must import this file — not customer-remote-read-pilot.ts —
 * when they only need the boolean. The pilot module pulls the adapter graph.
 *
 * Enabled only when the env is explicitly "1". Production default is off.
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/persistence/remote-pilot-flag";

export const CUSTOMER_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT";

export function isCustomerRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return isExplicitRemotePilotEnabled(CUSTOMER_REMOTE_READ_PILOT_ENV, env);
}
