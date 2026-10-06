"use client";

import { useEffect, useState } from "react";
import { COMMERCE_REMOTE_READ_PILOT_ENV } from "@/lib/commerce/commerce-remote-read-flag";
import { COMMERCE_REMOTE_WRITE_PILOT_ENV } from "@/lib/commerce/commerce-remote-write-flag";
import {
  runAuthenticatedCommerceHydrate,
  runAuthenticatedCommerceHydrateFromPackage,
  runAuthenticatedCommerceSaveDraft,
  runAuthenticatedCommerceSettle,
  type CommerceWriteClient,
} from "@/lib/commerce/commerce-remote-write-pilot";
import { toCommerceUserMessage } from "@/lib/commerce/commerce-remote-write-errors";
import type {
  CheckoutDiscount,
  CheckoutDraft,
  PackageRedemptionSelection,
  PaymentDraft,
  Transaction,
} from "@/lib/commerce/domain";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

export function commerceWritePilotEnv(): NodeJS.Dict<string> {
  return {
    ...process.env,
    [COMMERCE_REMOTE_READ_PILOT_ENV]: "1",
    [COMMERCE_REMOTE_WRITE_PILOT_ENV]: "1",
  };
}

function writeClient(): CommerceWriteClient | null {
  return createBrowserClientOrNull() as CommerceWriteClient | null;
}

function requireClient(): CommerceWriteClient {
  const client = writeClient();
  if (!client) {
    throw new Error("目前無法完成結帳，請稍後再試");
  }
  return client;
}

export type CommerceRemoteDraftState =
  | { status: "off" }
  | { status: "idle" }
  | { status: "loading" }
  | { status: "data"; draft: CheckoutDraft; transaction: Transaction | null }
  | { status: "error"; message: string };

export function useCommerceRemoteDraft(input: {
  appointmentId: string | null;
  treatmentId: string | null;
  enabled: boolean;
}): CommerceRemoteDraftState {
  const requestKey = `${input.appointmentId ?? ""}:${input.treatmentId ?? ""}`;
  const [result, setResult] = useState<{
    key: string;
    state: Exclude<CommerceRemoteDraftState, { status: "off" } | { status: "loading" }>;
  } | null>(null);

  useEffect(() => {
    if (!input.enabled || !input.appointmentId || !input.treatmentId) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const bundle = await runAuthenticatedCommerceHydrate(
          requireClient(),
          {
            appointmentId: input.appointmentId!,
            treatmentId: input.treatmentId!,
          },
          commerceWritePilotEnv(),
        );
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: { status: "data", draft: bundle.draft, transaction: bundle.transaction },
        });
      } catch (error: unknown) {
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: { status: "error", message: toCommerceUserMessage(error) },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input.enabled, input.appointmentId, input.treatmentId, requestKey]);

  if (!input.enabled) return { status: "off" };
  if (!input.appointmentId || !input.treatmentId) return { status: "idle" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}

export type CommerceRemotePackageDraftState =
  | { status: "off" }
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "data";
      draft: CheckoutDraft;
      transaction: Transaction | null;
      customer: { id: string; name: string; phone: string } | null;
    }
  | { status: "error"; message: string };

export function useCommerceRemotePackageDraft(input: {
  customerId: string | null;
  packageId: string | null;
  locationId: string | null;
  enabled: boolean;
}): CommerceRemotePackageDraftState {
  const requestKey = `${input.customerId ?? ""}:${input.packageId ?? ""}:${input.locationId ?? ""}`;
  const [result, setResult] = useState<{
    key: string;
    state: Exclude<CommerceRemotePackageDraftState, { status: "off" } | { status: "loading" }>;
  } | null>(null);

  useEffect(() => {
    if (!input.enabled || !input.customerId || !input.packageId || !input.locationId) {
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const bundle = await runAuthenticatedCommerceHydrateFromPackage(
          requireClient(),
          {
            customerId: input.customerId!,
            packageId: input.packageId!,
            locationId: input.locationId!,
          },
          commerceWritePilotEnv(),
        );
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: {
            status: "data",
            draft: bundle.draft,
            transaction: bundle.transaction,
            customer: bundle.customer ?? null,
          },
        });
      } catch (error: unknown) {
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: { status: "error", message: toCommerceUserMessage(error) },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input.enabled, input.customerId, input.packageId, input.locationId, requestKey]);

  if (!input.enabled) return { status: "off" };
  if (!input.customerId || !input.packageId || !input.locationId) return { status: "idle" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}

export async function submitCommerceRemoteSaveDraft(input: {
  draftId: string;
  expectedUpdatedAt: string;
  payments: PaymentDraft[];
  discounts: CheckoutDiscount[];
  packageRedemption?: PackageRedemptionSelection | null;
}) {
  return runAuthenticatedCommerceSaveDraft(requireClient(), input, commerceWritePilotEnv());
}

export async function submitCommerceRemoteSettle(input: {
  draftId: string;
  expectedUpdatedAt: string;
}) {
  return runAuthenticatedCommerceSettle(requireClient(), input, commerceWritePilotEnv());
}
