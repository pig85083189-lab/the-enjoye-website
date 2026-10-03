/**
 * Preview-only Appointment remote read flag.
 *
 * Server Components must import this file — not appointment-remote-read-pilot.ts.
 * The pilot module pulls the adapter / identity catalog graph; sharing that
 * graph between the RSC page and the Client hook crashed the Customer 360
 * page with Next.js client global-error ("This page couldn’t load").
 *
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Production is always off, even if the env is present.
 */

export const APPOINTMENT_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT";

export function isAppointmentRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  return env[APPOINTMENT_REMOTE_READ_PILOT_ENV] === "1";
}
