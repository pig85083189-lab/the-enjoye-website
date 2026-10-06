/**
 * Finance V1B Expense WRITE factory.
 * Server Components must use expense-remote-write-flag.ts.
 *
 * Create-only. No UPDATE / DELETE. No service role. No localStorage fallback.
 */

import { newId } from "@/lib/repositories/storage";
import {
  loadAuthenticatedIdentityCatalog,
  type LoadedAuthenticatedIdentity,
} from "@/lib/persistence/authenticated-identity-catalog";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { canCreateExpense } from "@/lib/staff-auth/operational-capabilities";
import { assertOperationalStaffId } from "@/lib/staff-auth/staff-id";
import type { StaffRole } from "@/types/saas";
import {
  AuthenticatedExpenseStore,
  type AuthenticatedExpenseWriteClient,
} from "./authenticated-expense-store";
import type { Expense, ExpenseCategory, ExpensePaymentMethod } from "./domain";
import { isExpenseCategory } from "./domain";
import { assertExpenseAmountMinor, isGeneratedExpenseAppId } from "./expense";
import { isExpenseRemoteWritePilotEnabled } from "./expense-remote-write-flag";
import {
  ExpenseWritePilotOffError,
  ExpenseWriteUnauthorizedError,
  refuseExpenseWriteMutation,
} from "./expense-write-guard";
import { parseYmd } from "./period";

export {
  EXPENSE_REMOTE_WRITE_PILOT_ENV,
  isExpenseRemoteWritePilotEnabled,
} from "./expense-remote-write-flag";

export {
  EXPENSE_WRITE_CREATE_ONLY_MESSAGE,
  EXPENSE_WRITE_PILOT_OFF_MESSAGE,
  EXPENSE_WRITE_UNAUTHORIZED_MESSAGE,
  ExpenseWriteCreateOnlyError,
  ExpenseWritePilotOffError,
  ExpenseWriteUnauthorizedError,
  refuseExpenseWriteMutation,
} from "./expense-write-guard";

export const EXPENSE_REMOTE_WRITE_PILOT_OFF_MESSAGE = "Expense remote write pilot is off";

export class ExpenseWritePilotDeniedError extends ExpenseWritePilotOffError {
  constructor(message = EXPENSE_REMOTE_WRITE_PILOT_OFF_MESSAGE) {
    super(message);
    this.name = "ExpenseWritePilotDeniedError";
  }
}

export type ExpenseWriteClient = AuthenticatedExpenseWriteClient;

export type ExpenseRemoteCreateInput = {
  organizationId: string;
  locationId: string;
  expenseDate: string;
  category: ExpenseCategory;
  name: string;
  amountMinor: number;
  paymentMethod?: ExpensePaymentMethod | null;
  vendor?: string | null;
  note?: string | null;
  appId?: string;
};

export interface AuthenticatedExpenseWritePersistence {
  identity: LoadedAuthenticatedIdentity;
  expenses: AuthenticatedExpenseStore;
  update(): never;
  delete(): never;
}

function assertExpenseWritePilot(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): void {
  if (!isExpenseRemoteWritePilotEnabled(env)) {
    throw new ExpenseWritePilotDeniedError();
  }
}

function assertOrganizationBoundary(
  identity: LoadedAuthenticatedIdentity,
  organizationId: string,
): void {
  if (organizationId !== identity.organizationAppId) {
    throw new UnmappedIdentityError("organization", identity.organizationAppId, organizationId);
  }
  identity.mapper.resolveOrganizationDbId(organizationId);
}

function assertCanCreateExpense(identity: LoadedAuthenticatedIdentity): void {
  const staffRow = identity.catalog.findStaffByAppId(
    identity.organizationDbId,
    identity.operationalStaffId,
  );
  if (
    !canCreateExpense({
      role: staffRow?.role as StaffRole | undefined,
      isActive: true,
    })
  ) {
    throw new ExpenseWriteUnauthorizedError();
  }
}

export function createAuthenticatedExpenseWrite(
  client?: ExpenseWriteClient,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): AuthenticatedExpenseStore {
  assertExpenseWritePilot(env);
  if (!client) {
    throw new ExpenseWritePilotDeniedError("Authenticated expense write client is required");
  }
  return new AuthenticatedExpenseStore(client);
}

export async function createAuthenticatedExpenseWritePersistence(
  client: ExpenseWriteClient,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<AuthenticatedExpenseWritePersistence> {
  assertExpenseWritePilot(env);
  const identity = await loadAuthenticatedIdentityCatalog(client);
  return {
    identity,
    expenses: new AuthenticatedExpenseStore(client),
    update: () => refuseExpenseWriteMutation("update"),
    delete: () => refuseExpenseWriteMutation("delete"),
  };
}

export async function runAuthenticatedExpenseCreate(
  client: ExpenseWriteClient,
  input: ExpenseRemoteCreateInput,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<Expense> {
  assertExpenseWritePilot(env);
  const persistence = await createAuthenticatedExpenseWritePersistence(client, env);
  assertOrganizationBoundary(persistence.identity, input.organizationId);
  assertCanCreateExpense(persistence.identity);
  assertOperationalStaffId(persistence.identity.operationalStaffId);
  persistence.identity.mapper.requireOperationalStaffId(
    persistence.identity.organizationAppId,
    persistence.identity.operationalStaffId,
  );
  const organizationDbId = persistence.identity.mapper.resolveOrganizationDbId(input.organizationId);
  const locationDbId = persistence.identity.mapper.resolveLocationDbId(
    input.organizationId,
    input.locationId,
  );
  parseYmd(input.expenseDate);
  if (!isExpenseCategory(input.category)) {
    throw new Error("expense category required");
  }
  const name = input.name.trim();
  if (!name) throw new Error("expense name required");
  const amountMinor = assertExpenseAmountMinor(input.amountMinor);
  const appId = input.appId ?? newId("exp");
  if (!isGeneratedExpenseAppId(appId)) {
    throw new Error('Expense app id must be generated via newId("exp")');
  }
  const vendor = input.vendor?.trim() ? input.vendor.trim() : null;
  const note = input.note?.trim() ? input.note.trim() : null;
  const paymentMethod = input.paymentMethod ?? null;

  return persistence.expenses.createExpense({
    organizationAppId: input.organizationId,
    locationAppId: input.locationId,
    row: {
      organization_id: organizationDbId,
      location_id: locationDbId,
      app_id: appId,
      expense_date: input.expenseDate,
      category: input.category,
      name,
      amount_minor: amountMinor,
      payment_method: paymentMethod,
      vendor,
      note,
      created_by_staff_id: persistence.identity.operationalStaffId,
    },
  });
}
