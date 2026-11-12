/**
 * One-time walk-in booking (no customer row / no LINE claim).
 * Fail closed unless env is exactly "1". Enable on TEST first; Production stays off until verified.
 * Requires the appointment remote-write pilot (which already requires calendar remote-read).
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";
import { isAppointmentRemoteWritePilotEnabled } from "./appointment-remote-write-flag";

export const ONE_TIME_WALKIN_BOOKING_ENV = "BEAUTY_OS_ONE_TIME_WALKIN_BOOKING";

export function isOneTimeWalkinBookingEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isExplicitRemotePilotEnabled(ONE_TIME_WALKIN_BOOKING_ENV, env)) {
    return false;
  }
  return isAppointmentRemoteWritePilotEnabled(env);
}
