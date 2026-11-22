/**
 * Authenticated PostgREST / RPC commerce store.
 * Business writes go through settlement RPCs — never service-role.
 */

import {
  COMMERCE_HYDRATE_RPC,
  COMMERCE_SAVE_RPC,
  COMMERCE_SETTLE_RPC,
} from "@/lib/commerce/commerce-remote-engine";
import type { CheckoutDiscount, PaymentDraft } from "@/lib/commerce/domain";
import { commerceBundleFromRemoteJson, transactionFromRemoteJson } from "./commerce-mapping";
import type { IdentityQueryBuilder, IdentitySupabaseClient } from "./authenticated-identity-catalog";

export type CommerceRpcResult<T = unknown> = {
  data: T | null;
  error: { message: string } | null;
};

export interface CommerceSupabaseClient extends IdentitySupabaseClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<CommerceRpcResult>;
  from(table: string): {
    select(columns: string): IdentityQueryBuilder;
  };
}

async function requireRpc<T>(
  result: CommerceRpcResult<T>,
  action: string,
): Promise<T> {
  if (result.error) {
    throw new Error(result.error.message || action);
  }
  if (result.data == null) {
    throw new Error(`${action}: empty response`);
  }
  return result.data;
}

export class AuthenticatedCommerceStore {
  constructor(private readonly client: CommerceSupabaseClient) {}

  async hydrateFromTreatment(input: {
    appointmentAppId: string;
    treatmentAppId: string;
  }) {
    const result = await this.client.rpc(COMMERCE_HYDRATE_RPC, {
      p_appointment_app_id: input.appointmentAppId,
      p_treatment_app_id: input.treatmentAppId,
    });
    return commerceBundleFromRemoteJson(await requireRpc(result, "hydrate checkout"));
  }

  async saveDraft(input: {
    checkoutAppId: string;
    expectedUpdatedAt: string;
    payments: PaymentDraft[];
    discounts: CheckoutDiscount[];
  }) {
    const result = await this.client.rpc(COMMERCE_SAVE_RPC, {
      p_checkout_app_id: input.checkoutAppId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_payments: input.payments.map((payment) => ({
        id: payment.id,
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference ?? null,
        note: payment.note ?? null,
      })),
      p_discounts: input.discounts.map((discount) => ({
        id: discount.id,
        type: discount.type,
        value: discount.value,
        label: discount.label ?? null,
        reason: discount.reason ?? null,
      })),
    });
    return commerceBundleFromRemoteJson(await requireRpc(result, "save checkout"));
  }

  async settleDraft(input: { checkoutAppId: string; expectedUpdatedAt: string }) {
    const result = await this.client.rpc(COMMERCE_SETTLE_RPC, {
      p_checkout_app_id: input.checkoutAppId,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
    return commerceBundleFromRemoteJson(await requireRpc(result, "settle checkout"));
  }

  /** Opt-in only. Does not alter the existing settleDraft flow. */
  async settlePackagePurchase(input: {
    checkoutAppId: string;
    expectedUpdatedAt: string;
    packageDefinitionDbId: string;
  }) {
    const result = await this.client.rpc("settle_checkout_with_package_purchase", {
      p_checkout_app_id: input.checkoutAppId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_package_definition_id: input.packageDefinitionDbId,
    });
    const payload = await requireRpc(result, "settle package purchase");
    const bundle = commerceBundleFromRemoteJson(payload);
    const packageId = (payload as Record<string, unknown>).customerPackageDbId;
    if (typeof packageId !== "string") throw new Error("套票入帳結果缺少識別碼");
    return { ...bundle, customerPackageDbId: packageId };
  }

  /** Opt-in zero-value service redemption, never used for paid checkouts. */
  async settlePackageRedemption(input: {
    checkoutAppId: string;
    expectedUpdatedAt: string;
    customerPackageDbId: string;
    serviceDbId: string;
  }) {
    const result = await this.client.rpc("settle_checkout_with_package_redemption", {
      p_checkout_app_id: input.checkoutAppId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_customer_package_id: input.customerPackageDbId,
      p_service_id: input.serviceDbId,
    });
    const payload = await requireRpc(result, "redeem package session");
    const bundle = commerceBundleFromRemoteJson(payload);
    const entryId = (payload as Record<string, unknown>).packageRedemptionLedgerId;
    if (typeof entryId !== "string") throw new Error("套票扣堂結果缺少識別碼");
    return { ...bundle, packageRedemptionLedgerId: entryId };
  }

  /** Only zero-value package redemptions can be voided through this RPC. */
  async voidPackageRedemption(input: { transactionDbId: string; reason: string }) {
    const result = await this.client.rpc("void_package_redemption_checkout", {
      p_transaction_id: input.transactionDbId,
      p_reason: input.reason,
    });
    return requireRpc(result, "void package redemption");
  }

  async listTransactions() {
    const result = await this.client.rpc("commerce_list_transactions");
    const rows = await requireRpc(result, "list transactions");
    const list = Array.isArray(rows) ? rows : [];
    return list.map((row) => transactionFromRemoteJson(row as Record<string, unknown>));
  }
}
