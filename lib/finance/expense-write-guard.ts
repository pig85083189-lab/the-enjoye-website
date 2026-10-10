/**
 * Application-layer guard for the Expense remote-create pilot.
 * Create-only. UPDATE / DELETE stay closed. RLS still enforces OWNER / MANAGER.
 */

export const EXPENSE_WRITE_CREATE_ONLY_MESSAGE =
  "Expense remote write pilot is create-only";

export const EXPENSE_WRITE_PILOT_OFF_MESSAGE = "Expense remote write pilot is off";

export const EXPENSE_WRITE_UNAUTHORIZED_MESSAGE = "Unauthorized to create expenses";

export class ExpenseWriteCreateOnlyError extends Error {
  constructor(message = EXPENSE_WRITE_CREATE_ONLY_MESSAGE) {
    super(message);
    this.name = "ExpenseWriteCreateOnlyError";
  }
}

export class ExpenseWritePilotOffError extends Error {
  constructor(message = EXPENSE_WRITE_PILOT_OFF_MESSAGE) {
    super(message);
    this.name = "ExpenseWritePilotOffError";
  }
}

export class ExpenseWriteUnauthorizedError extends Error {
  constructor(message = EXPENSE_WRITE_UNAUTHORIZED_MESSAGE) {
    super(message);
    this.name = "ExpenseWriteUnauthorizedError";
  }
}

export function refuseExpenseWriteMutation(kind: string): never {
  throw new ExpenseWriteCreateOnlyError(`${EXPENSE_WRITE_CREATE_ONLY_MESSAGE} (${kind})`);
}
