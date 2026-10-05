/**
 * Preview-only Commerce remote write flag.
 *
 * Server Components must import this file — not commerce-remote-write-pilot.ts.
 * The write factory pulls the adapter / identity catalog / RPC graph.
 *
 * Production is always off. Write requires the Commerce remote-read foundation.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE
 * and of Customer / Appointment / Treatment / Staff pilots.
 */

import { isCommerceRemoteReadPilotEnabled } from "./commerce-remote-read-flag";

export const COMMERCE_REMOTE_WRITE_PILOT_ENV =
  "BEAUTY_OS_COMMERCE_REMOTE_WRITE_PILOT";

export function isCommerceRemoteWritePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  if (env[COMMERCE_REMOTE_WRITE_PILOT_ENV] !== "1") {
    return false;
  }
  return isCommerceRemoteReadPilotEnabled(env);
}
