/**
 * Finance remote identity / READ flag.
 *
 * Server Components must import this file — not finance-remote-read-pilot.ts.
 * Enabled only when the env is explicitly "1". Production default is off.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Does not enable Expense WRITE or Stored Value WRITE.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";

export const FINANCE_REMOTE_READ_PILOT_ENV = "BEAUTY_OS_FINANCE_REMOTE_READ_PILOT";

export function isFinanceRemoteReadPilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return isExplicitRemotePilotEnabled(FINANCE_REMOTE_READ_PILOT_ENV, env);
}
