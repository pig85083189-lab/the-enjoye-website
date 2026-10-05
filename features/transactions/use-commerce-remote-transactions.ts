"use client";

import { useEffect, useState } from "react";
import { listRemoteCommerceTransactions } from "@/lib/commerce/commerce-remote-read-pilot";
import { COMMERCE_REMOTE_READ_PILOT_ENV } from "@/lib/commerce/commerce-remote-read-flag";
import type { Transaction } from "@/lib/commerce/domain";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

function commerceReadPilotEnv(): NodeJS.Dict<string> {
  return {
    ...process.env,
    [COMMERCE_REMOTE_READ_PILOT_ENV]: "1",
  };
}

export type CommerceRemoteTransactionState =
  | { status: "off" }
  | { status: "loading" }
  | {
      status: "data";
      transactions: Transaction[];
      customers: Array<{ id: string; name: string; phone: string }>;
    }
  | { status: "empty" }
  | { status: "error"; message: string };

export function useCommerceRemoteTransactions(input: {
  organizationId: string;
  enabled: boolean;
}): CommerceRemoteTransactionState {
  const [result, setResult] = useState<{
    key: string;
    state: Exclude<CommerceRemoteTransactionState, { status: "off" } | { status: "loading" }>;
  } | null>(null);

  useEffect(() => {
    if (!input.enabled) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const client = createBrowserClientOrNull() as IdentitySupabaseClient | null;
        if (!client) throw new Error("目前無法讀取交易紀錄");
        const rows = await listRemoteCommerceTransactions(
          input.organizationId,
          client,
          commerceReadPilotEnv(),
        );
        if (cancelled) return;
        setResult({
          key: input.organizationId,
          state:
            rows.transactions.length === 0
              ? { status: "empty" }
              : {
                  status: "data",
                  transactions: rows.transactions,
                  customers: rows.customers,
                },
        });
      } catch (error: unknown) {
        if (cancelled) return;
        setResult({
          key: input.organizationId,
          state: {
            status: "error",
            message: error instanceof Error ? error.message : "目前無法讀取交易紀錄",
          },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input.enabled, input.organizationId]);

  if (!input.enabled) return { status: "off" };
  if (!result || result.key !== input.organizationId) return { status: "loading" };
  return result.state;
}
