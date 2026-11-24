"use client";

import { useEffect, useState } from "react";
import {
  getRemotePilotCustomer,
  listRemotePilotCustomers,
} from "@/lib/customers/customer-remote-read-pilot";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import type { Customer } from "@/types";
import type { Transaction } from "@/lib/commerce/domain";

export interface FinanceActivityRow { id: string; kind: string; label: string; amountMinor: number; occurredAt: string; transactionId?: string | null; sessionDelta?: number }

export type CustomerRemoteReadState<T> =
  | { status: "off" }
  | { status: "loading" }
  | { status: "data"; value: T; storedValueBalanceMinor?: number; financeTransactions?: Transaction[]; financeActivity?: FinanceActivityRow[] }
  | { status: "empty" }
  | { status: "error"; message: string };

type Settled<T> = Exclude<CustomerRemoteReadState<T>, { status: "off" } | { status: "loading" }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Remote customer read failed";
}

export function useCustomerRemoteList(
  organizationId: string,
  enabled: boolean,
): CustomerRemoteReadState<Customer[]> {
  const requestKey = `list:${organizationId}`;
  const [result, setResult] = useState<{
    key: string;
    state: Settled<Customer[]>;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    void (async () => {
      try {
        const client = createBrowserClientOrNull() as IdentitySupabaseClient | null;
        if (!client) {
          throw new Error("Authenticated Supabase client is unavailable");
        }
        const rows = await listRemotePilotCustomers(organizationId, client);
        if (cancelled) return;
        setResult({
          key: requestKey,
          state:
            rows.length === 0
              ? { status: "empty" }
              : { status: "data", value: rows },
        });
      } catch (error: unknown) {
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: { status: "error", message: errorMessage(error) },
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, organizationId, requestKey]);

  if (!enabled) return { status: "off" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}

export function useCustomerRemoteDetail(
  organizationId: string,
  customerId: string,
  enabled: boolean,
  source: "authenticated" | "stored-value" = "authenticated",
): CustomerRemoteReadState<Customer> {
  const requestKey = `detail:${source}:${organizationId}:${customerId}`;
  const [result, setResult] = useState<{
    key: string;
    state: Settled<Customer>;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    void (async () => {
      try {
        let row: Customer | undefined;
        let storedValueBalanceMinor: number | undefined;
        let financeTransactions: Transaction[] | undefined;
        let financeActivity: FinanceActivityRow[] | undefined;
        if (source === "stored-value") {
          const params = new URLSearchParams({ organizationId, customerId });
          const response = await fetch(`/api/staff/stored-value/customer-detail?${params}`, {
            credentials: "same-origin",
            cache: "no-store",
          });
          if (response.status === 404) {
            row = undefined;
          } else {
            if (!response.ok) throw new Error("Stored-value customer detail unavailable");
            const result = (await response.json()) as {
              customer?: Customer;
              storedValueBalanceMinor?: number;
              financeTransactions?: Transaction[];
              financeActivity?: FinanceActivityRow[];
            };
            if (!result.customer || result.customer.id !== customerId || result.customer.organizationId !== organizationId) {
              throw new Error("Stored-value customer identity mismatch");
            }
            if (!Number.isSafeInteger(result.storedValueBalanceMinor)) {
              throw new Error("Stored-value balance unavailable");
            }
            row = result.customer;
            storedValueBalanceMinor = result.storedValueBalanceMinor;
            financeTransactions = Array.isArray(result.financeTransactions) ? result.financeTransactions : [];
            financeActivity = Array.isArray(result.financeActivity) ? result.financeActivity : [];
          }
        } else {
          const client = createBrowserClientOrNull() as IdentitySupabaseClient | null;
          if (!client) {
            throw new Error("Authenticated Supabase client is unavailable");
          }
          row = await getRemotePilotCustomer(organizationId, customerId, client);
        }
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: row ? { status: "data", value: row, storedValueBalanceMinor, financeTransactions, financeActivity } : { status: "empty" },
        });
      } catch (error: unknown) {
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: { status: "error", message: errorMessage(error) },
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, organizationId, customerId, requestKey, source]);

  if (!enabled) return { status: "off" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}

export function customersFromRemoteListState(
  state: CustomerRemoteReadState<Customer[]>,
): Customer[] {
  return state.status === "data" ? state.value : [];
}
