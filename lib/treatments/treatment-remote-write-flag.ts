/**
 * Preview-only Treatment remote write flag.
 *
 * Server Components must import this file — not treatment-remote-write-pilot.ts.
 * The write factory pulls the adapter / table-store graph.
 *
 * Production is always off. Write requires the Treatment remote-read foundation.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE
 * and of Customer / Appointment / Staff pilots.
 */

import { isTreatmentRemoteReadPilotEnabled } from "./treatment-remote-read-flag";

export const TREATMENT_REMOTE_WRITE_PILOT_ENV =
  "BEAUTY_OS_TREATMENT_REMOTE_WRITE_PILOT";

export function isTreatmentRemoteWritePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  if (env[TREATMENT_REMOTE_WRITE_PILOT_ENV] !== "1") {
    return false;
  }
  return isTreatmentRemoteReadPilotEnabled(env);
}
