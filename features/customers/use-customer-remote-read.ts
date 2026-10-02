"use client";

import { useEffect, useState } from "react";
import {
  getRemotePilotCustomer,
  listRemotePilotCustomers,
} from "@/lib/customers/customer-remote-read-pilot";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import type { Customer } from "@/types";

export type CustomerRemoteReadState<T> =
  | { status: "off" }
  | { status: "loading" }
  | { status: "data"; value: T }
  | { status: "empty" }
  | { status: "error"; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Remote customer read failed";
}

export function useCustomerRemoteList(
  organizationId: string,
  enabled: boolean,
): CustomerRemoteReadState<Customer[]> {
  const [state, setState] = useState<CustomerRemoteReadState<Customer[]>>(
    enabled ? { status: "loading" } : { status: "off" },
  );

  useEffect(() => {
    if (!enabled) {
      setState({ status: "off" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });
    const client = createBrowserClientOrNull();
    if (!client) {
      setState({
        status: "error",
        message: "Authenticated Supabase client is unavailable",
      });
      return;
    }

    void listRemotePilotCustomers(organizationId, client)
      .then((rows) => {
        if (cancelled) return;
        setState(rows.length === 0 ? { status: "empty" } : { status: "data", value: rows });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: errorMessage(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, organizationId]);

  return state;
}

export function useCustomerRemoteDetail(
  organizationId: string,
  customerId: string,
  enabled: boolean,
): CustomerRemoteReadState<Customer> {
  const [state, setState] = useState<CustomerRemoteReadState<Customer>>(
    enabled ? { status: "loading" } : { status: "off" },
  );

  useEffect(() => {
    if (!enabled) {
      setState({ status: "off" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });
    const client = createBrowserClientOrNull();
    if (!client) {
      setState({
        status: "error",
        message: "Authenticated Supabase client is unavailable",
      });
      return;
    }

    void getRemotePilotCustomer(organizationId, customerId, client)
      .then((row) => {
        if (cancelled) return;
        setState(row ? { status: "data", value: row } : { status: "empty" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: errorMessage(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, organizationId, customerId]);

  return state;
}

export function customersFromRemoteListState(
  state: CustomerRemoteReadState<Customer[]>,
): Customer[] {
  return state.status === "data" ? state.value : [];
}
