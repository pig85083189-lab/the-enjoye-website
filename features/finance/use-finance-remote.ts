"use client";

import { useEffect, useState } from "react";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import type { Transaction } from "@/lib/commerce/domain";
import type { Expense, FinanceCustomerHint } from "@/lib/finance/domain";
import {
  FINANCE_REMOTE_READ_PILOT_ENV,
  listRemoteFinanceSnapshot,
} from "@/lib/finance/finance-remote-read-pilot";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import type { CommerceSupabaseClient } from "@/lib/persistence/authenticated-commerce-store";

function financeReadEnv(): NodeJS.Dict<string> {
  return {
    ...process.env,
    [FINANCE_REMOTE_READ_PILOT_ENV]: "1",
  };
}

export type FinanceRemoteState =
  | { status: "off" }
  | { status: "loading" }
  | {
      status: "data";
      transactions: Transaction[];
      expenses: Expense[];
      customers: FinanceCustomerHint[];
    }
  | { status: "empty" }
  | { status: "error"; message: string };

export function useFinanceRemote(input: {
  organizationId: string;
  locationId: string;
  enabled: boolean;
}): FinanceRemoteState {
  const [result, setResult] = useState<{
    key: string;
    state: Exclude<FinanceRemoteState, { status: "off" } | { status: "loading" }>;
  } | null>(null);

  useEffect(() => {
    if (!input.enabled) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const client = createBrowserClientOrNull() as
          | (IdentitySupabaseClient & Partial<CommerceSupabaseClient>)
          | null;
        if (!client) throw new Error("目前無法讀取財務資料");
        const snapshot = await listRemoteFinanceSnapshot(
          input.organizationId,
          input.locationId,
          client,
          financeReadEnv(),
        );
        if (cancelled) return;
        const empty =
          snapshot.transactions.length === 0 && snapshot.expenses.length === 0;
        setResult({
          key: `${input.organizationId}:${input.locationId}`,
          state: empty
            ? { status: "empty" }
            : {
                status: "data",
                transactions: snapshot.transactions,
                expenses: snapshot.expenses,
                customers: snapshot.customers,
              },
        });
      } catch (error: unknown) {
        if (cancelled) return;
        setResult({
          key: `${input.organizationId}:${input.locationId}`,
          state: {
            status: "error",
            message: error instanceof Error ? error.message : "目前無法讀取財務資料",
          },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input.enabled, input.organizationId, input.locationId]);

  if (!input.enabled) return { status: "off" };
  if (!result || result.key !== `${input.organizationId}:${input.locationId}`) {
    return { status: "loading" };
  }
  return result.state;
}

export function financeRemoteRows(state: FinanceRemoteState): {
  transactions: Transaction[];
  expenses: Expense[];
  customers: FinanceCustomerHint[];
} {
  if (state.status === "data") {
    return {
      transactions: state.transactions,
      expenses: state.expenses,
      customers: state.customers,
    };
  }
  return { transactions: [], expenses: [], customers: [] };
}
