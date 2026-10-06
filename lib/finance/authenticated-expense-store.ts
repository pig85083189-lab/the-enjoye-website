/**
 * Authenticated Expense table access for Finance V1A READ.
 * Writes are refused until BEAUTY_OS_EXPENSE_REMOTE_WRITE_PILOT.
 */

import type {
  IdentityQueryBuilder,
  IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import type { Expense } from "./domain";
import { expenseFromRemoteRow, REMOTE_EXPENSE_COLUMNS } from "./expense-mapping";

export const EXPENSE_REMOTE_READ_ONLY_MESSAGE =
  "Finance V1A Expense remote path is read-only";

export class ExpenseRemoteReadOnlyError extends Error {
  constructor(message = EXPENSE_REMOTE_READ_ONLY_MESSAGE) {
    super(message);
    this.name = "ExpenseRemoteReadOnlyError";
  }
}

const EXPENSE_SELECT = REMOTE_EXPENSE_COLUMNS.join(", ");

export class AuthenticatedExpenseReadStore {
  constructor(private readonly client: IdentitySupabaseClient) {}

  insertExpense(): never {
    throw new ExpenseRemoteReadOnlyError();
  }

  updateExpense(): never {
    throw new ExpenseRemoteReadOnlyError();
  }

  deleteExpense(): never {
    throw new ExpenseRemoteReadOnlyError();
  }

  async listExpenses(input: {
    organizationDbId: string;
    locationDbId: string;
    organizationAppId: string;
    locationAppId: string;
  }): Promise<Expense[]> {
    const result = await this.client
      .from("expenses")
      .select(EXPENSE_SELECT)
      .eq("organization_id", input.organizationDbId)
      .eq("location_id", input.locationDbId);
    if (result.error) {
      throw new Error(result.error.message);
    }
    return (result.data ?? []).map((row) =>
      expenseFromRemoteRow(row as Record<string, unknown>, {
        organizationId: input.organizationAppId,
        locationId: input.locationAppId,
      }),
    );
  }
}

export type { IdentityQueryBuilder };
