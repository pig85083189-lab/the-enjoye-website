/**
 * Preview-only Customer remote write flag.
 *
 * Server Components must import this file — not customer-remote-write-pilot.ts.
 * The write factory pulls the adapter / table-store graph.
 *
 * Preview-only authenticated create. Production is always off.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Requires the Customer remote-read foundation.
 */

import { isCustomerRemoteReadPilotEnabled } from "./customer-remote-read-flag";

export const CUSTOMER_REMOTE_WRITE_PILOT_ENV = "BEAUTY_OS_CUSTOMER_REMOTE_WRITE_PILOT";

export function isCustomerRemoteWritePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  if (env[CUSTOMER_REMOTE_WRITE_PILOT_ENV] !== "1") {
    return false;
  }
  return isCustomerRemoteReadPilotEnabled(env);
}
