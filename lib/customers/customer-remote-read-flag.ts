/**
 * Preview-only Customer remote read flag.
 *
 * Server Components must import this file — not customer-remote-read-pilot.ts —
 * when they only need the boolean. The pilot module pulls the adapter graph.
 *
 * Production is always off, even if the env is present.
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 */

export const CUSTOMER_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT";

export function isCustomerRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  return env[CUSTOMER_REMOTE_READ_PILOT_ENV] === "1";
}
