"use client";

import { useEffect, useState } from "react";
import {
  getRemoteCommerceCheckoutCandidate,
  listRemoteCommerceCheckoutCandidates,
} from "@/lib/commerce/commerce-remote-read-pilot";
import { COMMERCE_REMOTE_READ_PILOT_ENV } from "@/lib/commerce/commerce-remote-read-flag";
import type { CommerceCheckoutCandidate } from "@/lib/commerce/commerce-remote-identity";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import type { CapabilityActor } from "@/lib/staff-auth/operational-capabilities";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

function commerceReadPilotEnv(): NodeJS.Dict<string> {
  return {
    ...process.env,
    [COMMERCE_REMOTE_READ_PILOT_ENV]: "1",
  };
}

export type CommerceRemoteReadState<T> =
  | { status: "off" }
  | { status: "loading" }
  | { status: "data"; value: T }
  | { status: "empty" }
  | { status: "error"; message: string };

type Settled<T> = Exclude<CommerceRemoteReadState<T>, { status: "off" } | { status: "loading" }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "無法讀取待結帳資料";
}

function readClient(): IdentitySupabaseClient | null {
  return createBrowserClientOrNull() as IdentitySupabaseClient | null;
}

export function candidatesFromRemoteListState(
  state: CommerceRemoteReadState<CommerceCheckoutCandidate[]>,
): CommerceCheckoutCandidate[] {
  return state.status === "data" ? state.value : [];
}

export function useCommerceRemoteCheckoutCandidates(input: {
  organizationId: string;
  locationId?: string;
  actor: CapabilityActor;
  enabled: boolean;
}): CommerceRemoteReadState<CommerceCheckoutCandidate[]> {
  const requestKey = [
    "commerce-candidates",
    input.organizationId,
    input.locationId ?? "",
    input.actor?.role ?? "",
    String(input.actor?.isActive ?? false),
  ].join(":");
  const [result, setResult] = useState<{
    key: string;
    state: Settled<CommerceCheckoutCandidate[]>;
  } | null>(null);

  useEffect(() => {
    if (!input.enabled) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const client = readClient();
        if (!client) throw new Error("Authenticated Supabase client is unavailable");
        const rows = await listRemoteCommerceCheckoutCandidates(
          input.organizationId,
          { locationId: input.locationId, actor: input.actor },
          client,
          commerceReadPilotEnv(),
        );
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: rows.length === 0 ? { status: "empty" } : { status: "data", value: rows },
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
  }, [
    input.enabled,
    input.organizationId,
    input.locationId,
    input.actor,
    requestKey,
  ]);

  if (!input.enabled) return { status: "off" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}

export function useCommerceRemoteCheckoutCandidate(input: {
  organizationId: string;
  appointmentId: string | null;
  treatmentId?: string | null;
  actor: CapabilityActor;
  enabled: boolean;
}): CommerceRemoteReadState<CommerceCheckoutCandidate> {
  const requestKey = [
    "commerce-candidate",
    input.organizationId,
    input.appointmentId ?? "",
    input.treatmentId ?? "",
    input.actor?.role ?? "",
  ].join(":");
  const [result, setResult] = useState<{
    key: string;
    state: Settled<CommerceCheckoutCandidate>;
  } | null>(null);

  useEffect(() => {
    if (!input.enabled || !input.appointmentId) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const client = readClient();
        if (!client) throw new Error("Authenticated Supabase client is unavailable");
        const row = await getRemoteCommerceCheckoutCandidate(
          input.organizationId,
          input.appointmentId!,
          {
            actor: input.actor,
            treatmentId: input.treatmentId ?? undefined,
          },
          client,
          commerceReadPilotEnv(),
        );
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
  }, [
    input.enabled,
    input.organizationId,
    input.appointmentId,
    input.treatmentId,
    input.actor,
    requestKey,
  ]);

  if (!input.enabled) return { status: "off" };
  if (!input.appointmentId) return { status: "empty" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}
