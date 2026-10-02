"use client";

import { useEffect, useState } from "react";
import {
  getRemotePilotCustomer,
  listRemotePilotCustomers,
} from "@/lib/customers/customer-remote-read-pilot";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import type { Customer } from "@/types";

export type CustomerRemoteReadState<T> =
  | { status: "off" }
  | { status: "loading" }
  | { status: "data"; value: T }
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
): CustomerRemoteReadState<Customer> {
  const requestKey = `detail:${organizationId}:${customerId}`;
  const [result, setResult] = useState<{
    key: string;
    state: Settled<Customer>;
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
        const row = await getRemotePilotCustomer(organizationId, customerId, client);
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: row ? { status: "data", value: row } : { status: "empty" },
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
  }, [enabled, organizationId, customerId, requestKey]);

  if (!enabled) return { status: "off" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}

export function customersFromRemoteListState(
  state: CustomerRemoteReadState<Customer[]>,
): Customer[] {
  return state.status === "data" ? state.value : [];
}
