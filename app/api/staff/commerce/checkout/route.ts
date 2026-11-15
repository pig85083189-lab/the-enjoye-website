import { NextResponse } from "next/server";
import { callBookingSourceCheckout, readBookingCheckoutSource } from "@/lib/commerce/booking-source-checkout-server";
import {
  COMMERCE_HYDRATE_RPC,
  COMMERCE_SAVE_RPC,
  COMMERCE_SETTLE_RPC,
} from "@/lib/commerce/commerce-remote-engine";
import { isCommerceRemoteWritePilotEnabled } from "@/lib/commerce/commerce-remote-write-flag";
import { toCommerceUserMessage } from "@/lib/commerce/commerce-remote-write-errors";
import { commerceBundleFromRemoteJson } from "@/lib/persistence/commerce-mapping";
import { identityRelationIsMissing } from "@/lib/commerce/stored-value-wallet-identity";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FORBIDDEN_FIELDS = ["financeCustomerId", "financeBookingCustomerId", "walletCustomerId", "customerId"];

type PaymentInput = { method?: unknown; amount?: unknown; id?: unknown; reference?: unknown; note?: unknown };

function fail(status: number, message: string) {
  return NextResponse.json({ message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function storedValueAmount(payments: PaymentInput[]): number | null {
  let total = 0;
  for (const payment of payments) {
    if (payment.method !== "STORED_VALUE") continue;
    if (!Number.isSafeInteger(payment.amount) || Number(payment.amount) <= 0) return null;
    total += Number(payment.amount);
  }
  return total;
}

async function proxyRpc(fn: string, args: Record<string, unknown>) {
  const user = await createClient();
  const result = await user.rpc(fn, args);
  if (result.error) throw new Error(result.error.message || "目前無法完成結帳，請稍後再試");
  return commerceBundleFromRemoteJson(result.data);
}

export async function POST(request: Request) {
  if (!isCommerceRemoteWritePilotEnabled()) return fail(403, "目前無法完成結帳，請稍後再試");
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "目前無法完成結帳，請稍後再試");
  }
  if (FORBIDDEN_FIELDS.some((field) => field in body)) return fail(400, "目前無法完成結帳，請稍後再試");
  const action = body.action;
  try {
    if (action === "hydrate") {
      const appointmentId = typeof body.appointmentId === "string" ? body.appointmentId.trim() : "";
      const treatmentId = typeof body.treatmentId === "string" ? body.treatmentId.trim() : "";
      if (!appointmentId || !treatmentId) return fail(400, "目前無法完成結帳，請稍後再試");
      const bundle = await proxyRpc(COMMERCE_HYDRATE_RPC, {
        p_appointment_app_id: appointmentId,
        p_treatment_app_id: treatmentId,
      });
      const actor = await getServerStaffAuthUser();
      const source = await readBookingCheckoutSource(bundle.draft.id);
      if (actor && source) {
        const identity = await getAuthenticatedStaffMembership({ organizationId: source.organizationAppId });
        if (identity.status === "ok" && canCheckout(identity.membership)) {
          try {
            await callBookingSourceCheckout("open_booking_source_checkout", {
              organizationAppId: source.organizationAppId,
              sourceCustomerKey: source.sourceCustomerKey,
              checkoutAppId: source.checkoutAppId,
              locationAppId: source.locationAppId,
              amount: bundle.draft.total,
              staffId: identity.membership.userId,
            });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "";
            if (!message.includes("必須先完成顧客身分對應") && !message.includes("顧客帳號無效")) {
              console.error("[commerce/checkout] source_draft_skipped", { message: message || "open_failed" });
            }
          }
        }
      }
      return NextResponse.json({ bundle }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const draftId = typeof body.draftId === "string" ? body.draftId.trim() : "";
    const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : "";
    if (!draftId || !expectedUpdatedAt) return fail(400, "目前無法完成結帳，請稍後再試");

    if (action === "save") {
      const payments = Array.isArray(body.payments) ? (body.payments as PaymentInput[]) : [];
      const discounts = Array.isArray(body.discounts) ? body.discounts : [];
      if (payments.some((payment) => payment.method === "PACKAGE")) return fail(409, "此付款方式目前尚未開放");
      const stored = storedValueAmount(payments);
      if (stored === null) return fail(400, "付款金額不可為 0");
      if (stored > 0) {
        const source = await readBookingCheckoutSource(draftId);
        if (!source) return fail(404, "找不到結帳資料");
        const identity = await getAuthenticatedStaffMembership({ organizationId: source.organizationAppId });
        if (identity.status === "unauthenticated") return fail(401, "沒有權限結帳");
        if (identity.status !== "ok" || !canCheckout(identity.membership)) return fail(403, "沒有權限結帳");
        const actor = await getServerStaffAuthUser();
        if (!actor || actor.id !== identity.membership.authUserId) return fail(403, "沒有權限結帳");
        await callBookingSourceCheckout("save_booking_source_checkout", {
          organizationAppId: source.organizationAppId,
          sourceCustomerKey: source.sourceCustomerKey,
          checkoutAppId: source.checkoutAppId,
          locationAppId: source.locationAppId,
          amount: stored,
          staffId: identity.membership.userId,
        });
      }
      // Four arguments keep the draft's package redemption. Stored value can
      // settle only after the finance debit posts a receipt.
      const bundle = await proxyRpc(COMMERCE_SAVE_RPC, {
        p_checkout_app_id: draftId,
        p_expected_updated_at: expectedUpdatedAt,
        p_payments: payments,
        p_discounts: discounts,
      });
      return NextResponse.json({ bundle }, { headers: { "Cache-Control": "private, no-store" } });
    }

    if (action === "settle") {
      const booking = await createClient();
      const draft = await booking.from("checkout_drafts").select("id").eq("app_id", draftId).maybeSingle();
      const payments = draft.data?.id
        ? await booking.from("checkout_payments").select("method, amount_minor").eq("checkout_draft_id", draft.data.id)
        : { data: null, error: draft.error };
      if (draft.error || payments.error || !draft.data?.id) {
        const bundle = await proxyRpc(COMMERCE_SETTLE_RPC, {
          p_checkout_app_id: draftId,
          p_expected_updated_at: expectedUpdatedAt,
        });
        return NextResponse.json({ bundle }, { headers: { "Cache-Control": "private, no-store" } });
      }
      const stored = storedValueAmount(
        (payments.data ?? []).map((row) => ({ method: row.method, amount: Number(row.amount_minor) })),
      );
      if (stored === null) return fail(400, "付款金額不可為 0");
      if ((payments.data ?? []).some((row) => row.method === "PACKAGE")) return fail(409, "此付款方式目前尚未開放");
      if (stored > 0) {
        const source = await readBookingCheckoutSource(draftId);
        if (!source) return fail(404, "找不到結帳資料");
        const identity = await getAuthenticatedStaffMembership({ organizationId: source.organizationAppId });
        if (identity.status === "unauthenticated") return fail(401, "沒有權限結帳");
        if (identity.status !== "ok" || !canCheckout(identity.membership)) return fail(403, "沒有權限結帳");
        const actor = await getServerStaffAuthUser();
        if (!actor || actor.id !== identity.membership.authUserId) return fail(403, "沒有權限結帳");
        const admin = createServiceRoleClient();
        if (!admin) return fail(503, "目前無法完成結帳，請稍後再試");
        const receiptProbe = await admin.from("stored_value_debit_receipts").select("checkout_app_id").limit(1);
        if (receiptProbe.error && identityRelationIsMissing(receiptProbe.error.code)) {
          return fail(409, "此付款方式目前尚未開放");
        }
        if (receiptProbe.error) return fail(503, "目前無法完成結帳，請稍後再試");
        const settled = await callBookingSourceCheckout("settle_booking_source_checkout", {
          organizationAppId: source.organizationAppId,
          sourceCustomerKey: source.sourceCustomerKey,
          checkoutAppId: source.checkoutAppId,
          locationAppId: source.locationAppId,
          amount: stored,
          staffId: identity.membership.userId,
        });
        const receipt = await admin.from("stored_value_debit_receipts").insert({
          organization_id: source.organizationId,
          checkout_app_id: source.checkoutAppId,
          source_customer_key: source.sourceCustomerKey,
          amount_minor: stored,
          effect_key: settled.effectKey ?? `booking-checkout:${source.checkoutAppId}`,
          status: "POSTED",
        });
        if (receipt.error && receipt.error.code !== "23505") {
          console.error("[commerce/checkout] receipt_insert_failed", { code: receipt.error.code });
          return fail(503, "目前無法完成結帳，請稍後再試");
        }
      }
      const bundle = await proxyRpc(COMMERCE_SETTLE_RPC, {
        p_checkout_app_id: draftId,
        p_expected_updated_at: expectedUpdatedAt,
      });
      return NextResponse.json({ bundle }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return fail(400, "目前無法完成結帳，請稍後再試");
  } catch (error: unknown) {
    const message = toCommerceUserMessage(error);
    const status = message === "沒有權限結帳" ? 403 : message === "找不到結帳資料" ? 404 : 409;
    return fail(status, message);
  }
}
