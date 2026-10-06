/**
 * Phase Finance V1B/C Expense WRITE factory — closed in V1A.
 * Server Components must use expense-remote-write-flag.ts.
 */

import { isExpenseRemoteWritePilotEnabled } from "./expense-remote-write-flag";

export {
  EXPENSE_REMOTE_WRITE_PILOT_ENV,
  isExpenseRemoteWritePilotEnabled,
} from "./expense-remote-write-flag";

export const EXPENSE_REMOTE_WRITE_PILOT_OFF_MESSAGE =
  "Expense remote write pilot is off";

export class ExpenseWritePilotDeniedError extends Error {
  constructor(message = EXPENSE_REMOTE_WRITE_PILOT_OFF_MESSAGE) {
    super(message);
    this.name = "ExpenseWritePilotDeniedError";
  }
}

export function assertExpenseWritePilot(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): void {
  if (!isExpenseRemoteWritePilotEnabled(env)) {
    throw new ExpenseWritePilotDeniedError();
  }
}

export function createAuthenticatedExpenseWrite(): never {
  throw new ExpenseWritePilotDeniedError();
}
