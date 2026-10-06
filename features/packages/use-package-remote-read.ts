"use client";

import { useEffect, useState } from "react";
import {
  listRemotePilotCustomerPackages,
  listRemotePilotPackageDefinitions,
  listRemotePilotPackageLedger,
} from "@/lib/packages/package-remote-read-pilot";
import type { CustomerPackage, PackageDefinition, PackageLedgerEntry } from "@/lib/packages/domain";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

export type PackageRemoteReadState<T> =
  | { status: "off" }
  | { status: "loading" }
  | { status: "data"; value: T }
  | { status: "empty" }
  | { status: "error"; message: string };

type Settled<T> = Exclude<PackageRemoteReadState<T>, { status: "off" } | { status: "loading" }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Remote package read failed";
}

function usePackageRemoteQuery<T>(
  enabled: boolean,
  requestKey: string,
  load: (client: IdentitySupabaseClient) => Promise<T[]>,
): PackageRemoteReadState<T[]> {
  const [result, setResult] = useState<{
    key: string;
    state: Settled<T[]>;
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
        const rows = await load(client);
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
    // requestKey encodes the query identity; load closes over the same values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, requestKey]);

  if (!enabled) return { status: "off" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}

export function usePackageRemoteDefinitions(
  organizationId: string,
  enabled: boolean,
): PackageRemoteReadState<PackageDefinition[]> {
  return usePackageRemoteQuery(enabled, `definitions:${organizationId}`, (client) =>
    listRemotePilotPackageDefinitions(organizationId, client, { activeOnly: true }),
  );
}

export function usePackageRemoteCustomerPackages(
  organizationId: string,
  enabled: boolean,
  customerId?: string,
): PackageRemoteReadState<CustomerPackage[]> {
  return usePackageRemoteQuery(
    enabled,
    `packages:${organizationId}:${customerId ?? ""}`,
    (client) =>
      listRemotePilotCustomerPackages(organizationId, client, {
        customerId,
      }),
  );
}

export function usePackageRemoteLedger(
  organizationId: string,
  enabled: boolean,
  customerId?: string,
): PackageRemoteReadState<PackageLedgerEntry[]> {
  return usePackageRemoteQuery(
    enabled,
    `ledger:${organizationId}:${customerId ?? ""}`,
    (client) =>
      listRemotePilotPackageLedger(organizationId, client, {
        customerId,
      }),
  );
}

export function rowsFromPackageRemoteState<T>(
  state: PackageRemoteReadState<T[]>,
): T[] {
  return state.status === "data" ? state.value : [];
}
