/**
 * Authenticated PostgREST / RPC commerce store.
 * Business writes go through settlement RPCs — never service-role.
 */

import {
  COMMERCE_HYDRATE_RPC,
  COMMERCE_PACKAGE_HYDRATE_RPC,
  COMMERCE_SAVE_RPC,
  COMMERCE_SETTLE_RPC,
} from "@/lib/commerce/commerce-remote-engine";
import type {
  CheckoutDiscount,
  PackageRedemptionSelection,
  PaymentDraft,
} from "@/lib/commerce/domain";
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

  async hydrateFromPackage(input: {
    customerAppId: string;
    packageDefinitionAppId: string;
    locationAppId: string;
  }) {
    const result = await this.client.rpc(COMMERCE_PACKAGE_HYDRATE_RPC, {
      p_customer_app_id: input.customerAppId,
      p_package_definition_app_id: input.packageDefinitionAppId,
      p_location_app_id: input.locationAppId,
    });
    return commerceBundleFromRemoteJson(await requireRpc(result, "hydrate package checkout"));
  }

  async saveDraft(input: {
    checkoutAppId: string;
    expectedUpdatedAt: string;
    payments: PaymentDraft[];
    discounts: CheckoutDiscount[];
    packageRedemption?: PackageRedemptionSelection | null;
  }) {
    const args: Record<string, unknown> = {
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
    };
    if (input.packageRedemption !== undefined) {
      args.p_package_redemption = input.packageRedemption
        ? {
            customerPackageId: input.packageRedemption.customerPackageId,
            serviceId: input.packageRedemption.serviceId,
            sessions: 1,
          }
        : null;
    }
    const result = await this.client.rpc(COMMERCE_SAVE_RPC, args);
    return commerceBundleFromRemoteJson(await requireRpc(result, "save checkout"));
  }

  async repairPackageFulfillment(transactionAppId: string) {
    const result = await this.client.rpc("repair_package_fulfillment", {
      p_transaction_app_id: transactionAppId,
    });
    return requireRpc(result, "repair package fulfillment");
  }

  async settleDraft(input: { checkoutAppId: string; expectedUpdatedAt: string }) {
    const result = await this.client.rpc(COMMERCE_SETTLE_RPC, {
      p_checkout_app_id: input.checkoutAppId,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
    return commerceBundleFromRemoteJson(await requireRpc(result, "settle checkout"));
  }

  async getCustomerDisplay(customerAppId: string): Promise<{
    id: string;
    name: string;
    phone: string;
  } | null> {
    const result = await this.client
      .from("customers")
      .select("app_id, full_name, phone")
      .eq("app_id", customerAppId);
    if (result.error) {
      throw new Error(result.error.message);
    }
    const row = result.data?.[0] as
      | { app_id?: string; full_name?: string; phone?: string }
      | undefined;
    if (!row) return null;
    return {
      id: row.app_id || customerAppId,
      name: row.full_name ?? "",
      phone: row.phone ?? "",
    };
  }

  async listTransactions() {
    const result = await this.client.rpc("commerce_list_transactions");
    const rows = await requireRpc(result, "list transactions");
    const list = Array.isArray(rows) ? rows : [];
    return list.map((row) => transactionFromRemoteJson(row as Record<string, unknown>));
  }
}
