/**
 * Temporary Preview-only Appointment remote-read diagnostic.
 * Production is always unavailable. Delete after Owner QA.
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 */

export const APPOINTMENT_READ_DIAGNOSTIC_ROUTE = "/staff/appointment-read-diagnostic";
export const CUSTOMER_PROFILE_ISOLATION_ROUTE = "/staff/customer-profile-isolation";

export function isAppointmentReadDiagnosticEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  const targetEnv = (env.VERCEL_TARGET_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production" || targetEnv === "production") {
    return false;
  }
  return env.BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT === "1";
}
