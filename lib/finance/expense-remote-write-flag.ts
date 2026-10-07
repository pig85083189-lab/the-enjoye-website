/**
 * Expense remote WRITE flag.
 *
 * Server Components must import this file — not expense-remote-write-pilot.ts.
 * Production default is off. WRITE requires Finance remote READ.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Does not enable Stored Value WRITE.
 */

import { isExplicitRemotePilotEnabled } from "@/lib/flags/remote-pilot-flag";
import { isFinanceRemoteReadPilotEnabled } from "./finance-remote-read-flag";

export const EXPENSE_REMOTE_WRITE_PILOT_ENV = "BEAUTY_OS_EXPENSE_REMOTE_WRITE_PILOT";

export function isExpenseRemoteWritePilotEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isExplicitRemotePilotEnabled(EXPENSE_REMOTE_WRITE_PILOT_ENV, env)) {
    return false;
  }
  return isFinanceRemoteReadPilotEnabled(env);
}
