/**
 * Phase Finance V1A authenticated Finance remote READ.
 *
 * Client / test import only. Server Components must use
 * finance-remote-read-flag.ts so the adapter graph stays out of RSC.
 *
 * Income = canonical public.transactions via commerce_list_transactions.
 * Expense = public.expenses SELECT.
 * No localStorage fallback. No Expense WRITE. No Stored Value WRITE.
 * No service role.
 */

import type { Transaction } from "@/lib/commerce/domain";
import {
  AuthenticatedCommerceStore,
  type CommerceSupabaseClient,
} from "@/lib/persistence/authenticated-commerce-store";
import { AuthenticatedCustomerReadStore } from "@/lib/persistence/authenticated-customer-read-store";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import { AuthenticatedExpenseReadStore, isExpenseSchemaUnavailableError } from "./authenticated-expense-store";
import type { Expense, ExpenseRemoteAvailability, FinanceCustomerHint } from "./domain";
import { isFinanceRemoteReadPilotEnabled } from "./finance-remote-read-flag";

export {
  FINANCE_REMOTE_READ_PILOT_ENV,
  isFinanceRemoteReadPilotEnabled,
} from "./finance-remote-read-flag";

export const FINANCE_REMOTE_READ_PILOT_OFF_MESSAGE =
  "Finance remote read pilot is off";

export type FinanceRemoteSnapshot = {
  transactions: Transaction[];
  expenses: Expense[];
  expenseAvailability: ExpenseRemoteAvailability;
  customers: FinanceCustomerHint[];
};

export async function readExpenseLedger(input: {
  store: Pick<AuthenticatedExpenseReadStore, "listExpenses">;
  organizationDbId: string;
  locationDbId: string;
  organizationAppId: string;
  locationAppId: string;
}): Promise<{ expenses: Expense[]; availability: ExpenseRemoteAvailability }> {
  try {
    const expenses = await input.store.listExpenses({
      organizationDbId: input.organizationDbId,
      locationDbId: input.locationDbId,
      organizationAppId: input.organizationAppId,
      locationAppId: input.locationAppId,
    });
    return { expenses, availability: "ready" };
  } catch (error) {
    if (isExpenseSchemaUnavailableError(error)) {
      return { expenses: [], availability: "unavailable" };
    }
    throw error;
  }
}

function requirePilot(env: NodeJS.Dict<string>): void {
  if (!isFinanceRemoteReadPilotEnabled(env)) {
    throw new Error(FINANCE_REMOTE_READ_PILOT_OFF_MESSAGE);
  }
}

export async function listRemoteFinanceSnapshot(
  organizationId: string,
  locationId: string,
  client: IdentitySupabaseClient & Partial<CommerceSupabaseClient>,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<FinanceRemoteSnapshot> {
  requirePilot(env);
  const identity = await loadAuthenticatedIdentityCatalog(client, organizationId);
  const organizationDbId = identity.mapper.resolveOrganizationDbId(organizationId);
  const locationDbId = identity.mapper.resolveLocationDbId(organizationId, locationId);

  const expenseStore = new AuthenticatedExpenseReadStore(client);
  const customerStore = new AuthenticatedCustomerReadStore(client);
  const [expenseLedger, dbCustomers] = await Promise.all([
    readExpenseLedger({
      store: expenseStore,
      organizationDbId,
      locationDbId,
      organizationAppId: organizationId,
      locationAppId: locationId,
    }),
    customerStore.listCustomers(organizationDbId),
  ]);
  const expenses = expenseLedger.expenses;
  const expenseAvailability = expenseLedger.availability;
  const customers: FinanceCustomerHint[] = dbCustomers.map((row) => ({
    id: row.app_id,
    name: row.full_name,
    phone: row.phone ?? "",
  }));

  if (typeof client.rpc !== "function") {
    return { transactions: [], expenses, expenseAvailability, customers };
  }
  const commerce = new AuthenticatedCommerceStore(client as CommerceSupabaseClient);
  const listed = await commerce.listTransactions();
  const transactions = listed.filter(
    (row) => row.organizationId === organizationId && row.locationId === locationId,
  );
  return { transactions, expenses, expenseAvailability, customers };
}
