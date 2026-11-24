"use client";

import { useEffect, useState } from "react";
import { COMMERCE_REMOTE_READ_PILOT_ENV } from "@/lib/commerce/commerce-remote-read-flag";
import { COMMERCE_REMOTE_WRITE_PILOT_ENV } from "@/lib/commerce/commerce-remote-write-flag";
import {
  runAuthenticatedPackagePurchaseSettle,
  runAuthenticatedPackageRedemptionSettle,
  runAuthenticatedPackageRedemptionVoid,
  runAuthenticatedPackageDefinitionCatalog,
  runAuthenticatedCustomerPackageCatalog,
  runAuthenticatedPackagePurchaseByAppId,
  runAuthenticatedPackageRedemptionByAppId,
  runAuthenticatedOpenPackagePurchaseDraft,
  runAuthenticatedGetPackagePurchaseDraft,
  type CommerceWriteClient,
} from "@/lib/commerce/commerce-remote-write-pilot";
import { toCommerceUserMessage } from "@/lib/commerce/commerce-remote-write-errors";
import type { CheckoutDiscount, CheckoutDraft, PaymentDraft, Transaction } from "@/lib/commerce/domain";
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

type CommerceBundle = { draft: CheckoutDraft; transaction: Transaction | null };

async function postCommerceCheckout(body: Record<string, unknown>): Promise<CommerceBundle> {
  const response = await fetch("/api/staff/commerce/checkout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { bundle?: CommerceBundle; message?: string };
  if (!response.ok || !payload.bundle) {
    throw new Error(payload.message || "目前無法完成結帳，請稍後再試");
  }
  return payload.bundle;
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
        const bundle = await postCommerceCheckout({action:"hydrate",appointmentId:input.appointmentId,treatmentId:input.treatmentId});
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

export async function submitCommerceRemoteSaveDraft(input: {
  draftId: string;
  expectedUpdatedAt: string;
  payments: PaymentDraft[];
  discounts: CheckoutDiscount[];
}) {
  return postCommerceCheckout({action:"save",...input});
}

export async function submitCommerceRemoteSettle(input: {
  draftId: string;
  expectedUpdatedAt: string;
}) {
  return postCommerceCheckout({action:"settle",...input});
}

/** Dedicated opt-in package checkout actions. Legacy settle is unchanged. */
export async function submitCommerceRemotePackagePurchase(input: {
  draftId: string;
  expectedUpdatedAt: string;
  packageDefinitionDbId: string;
}) {
  return runAuthenticatedPackagePurchaseSettle(requireClient(), input, commerceWritePilotEnv());
}

export async function submitCommerceRemotePackageRedemption(input: {
  draftId: string;
  expectedUpdatedAt: string;
  customerPackageDbId: string;
  serviceDbId: string;
}) {
  return runAuthenticatedPackageRedemptionSettle(requireClient(), input, commerceWritePilotEnv());
}

export async function submitCommerceRemotePackageVoid(input: {
  transactionDbId: string;
  reason: string;
}) {
  return runAuthenticatedPackageRedemptionVoid(requireClient(), input, commerceWritePilotEnv());
}

/** Load the real DB package catalog; never rely on localStorage definitions. */
export async function loadCommerceRemotePackageDefinitions() {
  return runAuthenticatedPackageDefinitionCatalog(requireClient(), commerceWritePilotEnv());
}

/** Customer ID must be a verified DB UUID, not an app/local ID. */
export async function loadCommerceRemoteCustomerPackages(customerDbId: string) {
  return runAuthenticatedCustomerPackageCatalog(requireClient(), customerDbId, commerceWritePilotEnv());
}

/** Resolve the selected package app ID to the database ID before settlement. */
export async function submitCommerceRemotePackagePurchaseByAppId(input: {
  draftId: string;
  expectedUpdatedAt: string;
  packageDefinitionAppId: string;
}) {
  const result = await runAuthenticatedPackagePurchaseByAppId(requireClient(), input, commerceWritePilotEnv());
  // Settlement remains authoritative; notification never retries payment.
  try {
    await fetch("/api/staff/lucky-draw/settled-checkout", {
      method:"POST", credentials:"same-origin", cache:"no-store",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({draftId:input.draftId}),
      signal:AbortSignal.timeout(5000),
    });
  } catch { console.warn("[lucky-draw] purchase_notification_pending"); }
  return result;
}

/** Never accept a customer/package UUID supplied by a local draft. */
export async function submitCommerceRemotePackageRedemptionByAppId(input: {
  draftId: string;
  expectedUpdatedAt: string;
  customerAppId: string;
  customerPackageAppId: string;
  serviceAppId: string;
}) {
  return runAuthenticatedPackageRedemptionByAppId(requireClient(), input, commerceWritePilotEnv());
}

/** Create a real Supabase checkout draft before navigating to payment. */
export async function openCommerceRemotePackagePurchaseDraft(input: {
  checkoutAppId: string;
  customerAppId: string;
  locationAppId: string;
  packageDefinitionAppId: string;
}) {
  return runAuthenticatedOpenPackagePurchaseDraft(requireClient(), input, commerceWritePilotEnv());
}

/** Read the canonical checkout draft after navigating from package sale. */
export async function getCommerceRemotePackagePurchaseDraft(checkoutAppId: string) {
  return runAuthenticatedGetPackagePurchaseDraft(requireClient(), checkoutAppId, commerceWritePilotEnv());
}

/**
 * Appointment-free package-sale checkout hydration.
 * Unlike useCommerceRemoteDraft, this works with a canonical checkout app ID.
 * Keeps the previous draft out of view when navigating between different IDs.
 */
export function useCommerceRemotePackagePurchaseDraft(input: {
  checkoutAppId: string | null;
  enabled: boolean;
}): CommerceRemoteDraftState {
  const [result, setResult] = useState<{
    key: string;
    state: { status: "data"; draft: CheckoutDraft; transaction: Transaction | null }
      | { status: "error"; message: string };
  } | null>(null);

  useEffect(() => {
    if (!input.enabled || !input.checkoutAppId) return;
    let cancelled = false;
    const checkoutAppId = input.checkoutAppId;
    void getCommerceRemotePackagePurchaseDraft(checkoutAppId).then(
      (bundle) => {
        if (cancelled) return;
        setResult({
          key: checkoutAppId,
          state: { status: "data", draft: bundle.draft, transaction: bundle.transaction },
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        setResult({
          key: checkoutAppId,
          state: { status: "error", message: toCommerceUserMessage(error) },
        });
      },
    );
    return () => { cancelled = true; };
  }, [input.enabled, input.checkoutAppId]);

  if (!input.enabled) return { status: "off" };
  if (!input.checkoutAppId) return { status: "idle" };
  if (!result || result.key !== input.checkoutAppId) return { status: "loading" };
  return result.state;
}
