"use client";

import { useEffect, useState } from "react";
import {
  getServiceRemoteWriteRevision,
  subscribeServiceRemoteWriteRefresh,
} from "@/lib/services/service-write-refresh";
import {
  getRemotePilotService,
  listRemotePilotServices,
} from "@/lib/services/service-remote-read-pilot";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import type { Service } from "@/types";

export type ServiceRemoteReadState<T> =
  | { status: "off" }
  | { status: "loading" }
  | { status: "data"; value: T }
  | { status: "empty" }
  | { status: "error"; message: string };

type Settled<T> = Exclude<ServiceRemoteReadState<T>, { status: "off" } | { status: "loading" }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Remote service read failed";
}

export function useServiceRemoteList(
  organizationId: string,
  enabled: boolean,
): ServiceRemoteReadState<Service[]> {
  const [revision, setRevision] = useState(getServiceRemoteWriteRevision);
  const requestKey = `list:${organizationId}:${revision}`;
  const [result, setResult] = useState<{
    key: string;
    state: Settled<Service[]>;
  } | null>(null);

  useEffect(() => subscribeServiceRemoteWriteRefresh(() => {
    setRevision(getServiceRemoteWriteRevision());
  }), []);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    void (async () => {
      try {
        const client = createBrowserClientOrNull() as IdentitySupabaseClient | null;
        if (!client) {
          throw new Error("Authenticated Supabase client is unavailable");
        }
        const rows = await listRemotePilotServices(organizationId, client);
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

export function useServiceRemoteDetail(
  organizationId: string,
  serviceId: string,
  enabled: boolean,
): ServiceRemoteReadState<Service> {
  const [revision, setRevision] = useState(getServiceRemoteWriteRevision);
  const requestKey = `detail:${organizationId}:${serviceId}:${revision}`;
  const [result, setResult] = useState<{
    key: string;
    state: Settled<Service>;
  } | null>(null);

  useEffect(() => subscribeServiceRemoteWriteRefresh(() => {
    setRevision(getServiceRemoteWriteRevision());
  }), []);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    void (async () => {
      try {
        const client = createBrowserClientOrNull() as IdentitySupabaseClient | null;
        if (!client) {
          throw new Error("Authenticated Supabase client is unavailable");
        }
        const row = await getRemotePilotService(organizationId, serviceId, client);
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
  }, [enabled, organizationId, serviceId, requestKey]);

  if (!enabled) return { status: "off" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}

export function servicesFromRemoteListState(
  state: ServiceRemoteReadState<Service[]>,
): Service[] {
  return state.status === "data" ? state.value : [];
}
