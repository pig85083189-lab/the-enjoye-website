"use client";

import { useEffect, useState } from "react";
import { toCommerceUserMessage } from "@/lib/commerce/commerce-remote-write-errors";
import type { CheckoutDiscount, CheckoutDraft, PaymentDraft, Transaction } from "@/lib/commerce/domain";

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
        const bundle = await postCommerceCheckout({
          action: "hydrate",
          appointmentId: input.appointmentId,
          treatmentId: input.treatmentId,
        });
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
  return postCommerceCheckout({
    action: "save",
    draftId: input.draftId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    payments: input.payments,
    discounts: input.discounts,
  });
}

export async function submitCommerceRemoteSettle(input: {
  draftId: string;
  expectedUpdatedAt: string;
}) {
  return postCommerceCheckout({
    action: "settle",
    draftId: input.draftId,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
}
