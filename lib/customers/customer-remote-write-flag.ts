/**
 * Customer remote write flag.
 *
 * Server Components must import this file — not customer-remote-write-pilot.ts.
 * The write factory pulls the adapter / table-store graph.
 *
 * Explicit authenticated create. Production default is off.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Requires the Customer remote-read foundation.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";
import { isCustomerRemoteReadPilotEnabled } from "./customer-remote-read-flag";

export const CUSTOMER_REMOTE_WRITE_PILOT_ENV = "BEAUTY_OS_CUSTOMER_REMOTE_WRITE_PILOT";

export function isCustomerRemoteWritePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isExplicitRemotePilotEnabled(CUSTOMER_REMOTE_WRITE_PILOT_ENV, env)) {
    return false;
  }
  return isCustomerRemoteReadPilotEnabled(env);
}
