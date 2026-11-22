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

  /** Read-only identity catalog; never seed package definitions in production. */
  async listPackageDefinitionsForCheckout(): Promise<Array<{
    organizationDbId: string;
    packageDefinitionDbId: string;
    packageDefinitionAppId: string | null;
    name: string;
    sessionCount: number;
    priceMinor: number;
    includedServices: unknown;
  }>> {
    const result = await this.client.rpc("commerce_package_catalog");
    const rows = await requireRpc(result, "load package catalog");
    if (!Array.isArray(rows)) throw new Error("套票方案資料格式不正確");
    return rows.map((row: unknown) => {
      if (!row || typeof row !== "object") throw new Error("套票方案資料格式不正確");
      const item = row as Record<string, unknown>;
      if (typeof item.organizationDbId !== "string" ||
          typeof item.packageDefinitionDbId !== "string" ||
          typeof item.name !== "string" ||
          typeof item.sessionCount !== "number" ||
          typeof item.priceMinor !== "number") {
        throw new Error("套票方案缺少必要欄位");
      }
      return {
        organizationDbId: item.organizationDbId,
        packageDefinitionDbId: item.packageDefinitionDbId,
        packageDefinitionAppId: typeof item.packageDefinitionAppId === "string" ? item.packageDefinitionAppId : null,
        name: item.name,
        sessionCount: item.sessionCount,
        priceMinor: item.priceMinor,
        includedServices: item.includedServices,
      };
    });
  }

  /** Read-only balances for one verified database customer UUID. */
  async listCustomerPackagesForCheckout(customerDbId: string): Promise<Array<{
    customerPackageDbId: string;
    customerPackageAppId: string | null;
    customerDbId: string;
    packageDefinitionDbId: string;
    name: string;
    status: string;
    expiresAt: string | null;
    remainingSessions: number;
    includedServiceAppIds: string[];
  }>> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerDbId)) {
      throw new Error("顧客資料庫識別碼不正確");
    }
    const result = await this.client.rpc("commerce_customer_package_catalog", {
      p_customer_id: customerDbId,
    });
    const rows = await requireRpc(result, "load customer packages");
    if (!Array.isArray(rows)) throw new Error("顧客套票資料格式不正確");
    return rows.map((row: unknown) => {
      if (!row || typeof row !== "object") throw new Error("顧客套票資料格式不正確");
      const item = row as Record<string, unknown>;
      if (typeof item.customerPackageDbId !== "string" ||
          typeof item.customerDbId !== "string" ||
          typeof item.packageDefinitionDbId !== "string" ||
          typeof item.name !== "string" ||
          typeof item.status !== "string" ||
          typeof item.remainingSessions !== "number" ||
          !Array.isArray(item.includedServiceAppIds) ||
          !item.includedServiceAppIds.every((id) => typeof id === "string")) {
        throw new Error("顧客套票缺少必要欄位");
      }
      return {
        customerPackageDbId: item.customerPackageDbId,
        customerPackageAppId: typeof item.customerPackageAppId === "string" ? item.customerPackageAppId : null,
        customerDbId: item.customerDbId,
        packageDefinitionDbId: item.packageDefinitionDbId,
        name: item.name,
        status: item.status,
        expiresAt: typeof item.expiresAt === "string" ? item.expiresAt : null,
        remainingSessions: item.remainingSessions,
        includedServiceAppIds: item.includedServiceAppIds as string[],
      };
    });
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
