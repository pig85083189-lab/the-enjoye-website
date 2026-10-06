/**
 * Authenticated Expense table access for Finance V1B.
 * listExpenses + createExpense only. UPDATE / DELETE stay closed.
 * Never uses a service-role client.
 */

import type {
  IdentityQueryBuilder,
  IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import { refuseExpenseWriteMutation } from "./expense-write-guard";
import type { Expense } from "./domain";
import {
  expenseFromRemoteRow,
  remoteExpensePayload,
  REMOTE_EXPENSE_COLUMNS,
  type RemoteExpenseInsert,
} from "./expense-mapping";

export const EXPENSE_REMOTE_READ_ONLY_MESSAGE =
  "Finance V1A Expense remote path is read-only";

export class ExpenseRemoteReadOnlyError extends Error {
  constructor(message = EXPENSE_REMOTE_READ_ONLY_MESSAGE) {
    super(message);
    this.name = "ExpenseRemoteReadOnlyError";
  }
}

export class ExpenseSchemaUnavailableError extends Error {
  readonly code = "EXPENSE_SCHEMA_UNAVAILABLE";
  constructor(message = "Expense schema is not available") {
    super(message);
    this.name = "ExpenseSchemaUnavailableError";
  }
}

export function isExpenseSchemaUnavailableError(error: unknown): boolean {
  if (error instanceof ExpenseSchemaUnavailableError) return true;
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  if (code === "PGRST205" || code === "42P01") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /expenses/i.test(message) &&
    /(does not exist|schema cache|could not find the table)/i.test(message)
  );
}

export function isExpenseUniqueViolation(error: unknown): boolean {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  if (code === "23505") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /duplicate key|unique constraint|expenses_app_id_unique/i.test(message);
}

const EXPENSE_SELECT = REMOTE_EXPENSE_COLUMNS.join(", ");

export type ExpenseWriteQueryResult<T = unknown> = {
  data: T | null;
  error: { message: string; code?: string } | null;
};

export interface AuthenticatedExpenseWriteClient {
  auth: IdentitySupabaseClient["auth"];
  from(table: string): {
    select(columns: string): IdentityQueryBuilder;
    insert(payload: Record<string, unknown>): {
      select(columns: string): PromiseLike<ExpenseWriteQueryResult>;
    };
  };
}

function requireRows<T>(result: ExpenseWriteQueryResult<T>, action: string): T {
  if (result.error) {
    if (isExpenseSchemaUnavailableError(result.error)) {
      throw new ExpenseSchemaUnavailableError(result.error.message);
    }
    throw Object.assign(new Error(`${action}: ${result.error.message}`), {
      code: result.error.code,
    });
  }
  if (result.data == null) {
    throw new Error(`${action}: empty response`);
  }
  return result.data;
}

function mapRows(
  rows: Record<string, unknown>[],
  ids: { organizationId: string; locationId: string },
): Expense[] {
  return rows.map((row) => expenseFromRemoteRow(row, ids));
}

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
      if (isExpenseSchemaUnavailableError(result.error)) {
        throw new ExpenseSchemaUnavailableError(result.error.message);
      }
      throw new Error(result.error.message);
    }
    return (result.data ?? []).map((row) =>
      expenseFromRemoteRow(row as Record<string, unknown>, {
        organizationId: input.organizationAppId,
        locationId: input.locationAppId,
      }),
    );
  }

  async getExpenseByAppId(input: {
    organizationDbId: string;
    locationDbId: string;
    organizationAppId: string;
    locationAppId: string;
    appId: string;
  }): Promise<Expense | undefined> {
    const listed = await this.listExpenses(input);
    return listed.find((row) => row.appId === input.appId);
  }
}

export class AuthenticatedExpenseStore {
  private readonly reads: AuthenticatedExpenseReadStore;

  constructor(private readonly client: AuthenticatedExpenseWriteClient) {
    this.reads = new AuthenticatedExpenseReadStore(client as IdentitySupabaseClient);
  }

  listExpenses = (input: Parameters<AuthenticatedExpenseReadStore["listExpenses"]>[0]) =>
    this.reads.listExpenses(input);

  getExpenseByAppId = (input: Parameters<AuthenticatedExpenseReadStore["getExpenseByAppId"]>[0]) =>
    this.reads.getExpenseByAppId(input);

  updateExpense(): never {
    return refuseExpenseWriteMutation("update");
  }

  deleteExpense(): never {
    return refuseExpenseWriteMutation("delete");
  }

  async createExpense(input: {
    row: RemoteExpenseInsert;
    organizationAppId: string;
    locationAppId: string;
  }): Promise<Expense> {
    const existing = await this.reads.getExpenseByAppId({
      organizationDbId: input.row.organization_id,
      locationDbId: input.row.location_id,
      organizationAppId: input.organizationAppId,
      locationAppId: input.locationAppId,
      appId: input.row.app_id,
    });
    if (existing) return existing;

    const payload = remoteExpensePayload(input.row);
    const result = await this.client.from("expenses").insert(payload).select(EXPENSE_SELECT);
    if (result.error && isExpenseUniqueViolation(result.error)) {
      const replay = await this.reads.getExpenseByAppId({
        organizationDbId: input.row.organization_id,
        locationDbId: input.row.location_id,
        organizationAppId: input.organizationAppId,
        locationAppId: input.locationAppId,
        appId: input.row.app_id,
      });
      if (replay) return replay;
    }
    const rows = requireRows(result, "insert expense");
    const list = Array.isArray(rows) ? rows : [rows];
    const mapped = mapRows(list as Record<string, unknown>[], {
      organizationId: input.organizationAppId,
      locationId: input.locationAppId,
    });
    const created = mapped[0];
    if (!created) throw new Error("insert expense: empty response");
    return created;
  }
}

export type { IdentityQueryBuilder };
