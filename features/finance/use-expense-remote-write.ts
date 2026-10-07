"use client";

import {
  EXPENSE_REMOTE_WRITE_PILOT_ENV,
  runAuthenticatedExpenseCreate,
  type ExpenseRemoteCreateInput,
  type ExpenseWriteClient,
} from "@/lib/finance/expense-remote-write-pilot";
import { FINANCE_REMOTE_READ_PILOT_ENV } from "@/lib/finance/finance-remote-read-flag";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

function writeClient(): ExpenseWriteClient | null {
  return createBrowserClientOrNull() as ExpenseWriteClient | null;
}

export async function submitExpenseRemoteCreate(input: ExpenseRemoteCreateInput) {
  const client = writeClient();
  if (!client) {
    throw new Error("Authenticated Supabase client is unavailable");
  }
  return runAuthenticatedExpenseCreate(client, input, {
    ...process.env,
    [EXPENSE_REMOTE_WRITE_PILOT_ENV]: "1",
    [FINANCE_REMOTE_READ_PILOT_ENV]: "1",
  });
}
