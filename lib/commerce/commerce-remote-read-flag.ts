/**
 * Preview-only Commerce remote identity / readiness flag.
 *
 * Server Components must import this file — not commerce-remote-read-pilot.ts.
 * The pilot module pulls the adapter / identity catalog graph.
 *
 * Production is always off, even if the env is present.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE
 * and of Customer / Appointment / Treatment / Staff pilots.
 *
 * This flag does not enable remote CheckoutDraft persist, settle, or
 * Transaction writes.
 */

export const COMMERCE_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_COMMERCE_REMOTE_READ_PILOT";

export function isCommerceRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  return env[COMMERCE_REMOTE_READ_PILOT_ENV] === "1";
}
