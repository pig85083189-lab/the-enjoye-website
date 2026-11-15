import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import {
  checkoutCustomerKeyIsDbId,
  chooseCheckoutCustomer,
  identityRelationIsMissing,
  resolveStoredValueWalletCustomer,
  type CheckoutCustomerRow,
} from "@/lib/commerce/stored-value-wallet-identity";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const organizationId = params.get("organizationId");
  const customerId = params.get("customerId");
  const headers = { "Cache-Control": "private, no-store" };
  const fail = (status: number, code: string) =>
    NextResponse.json({ error: "無法查詢正式儲值帳戶", code }, { status, headers });
  if (!organizationId || organizationId.length > 120 || !customerId || customerId.length > 120) return fail(400, "INVALID_INPUT");
  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return fail(401, "UNAUTHENTICATED");
  if (identity.status !== "ok" || !canCheckout(identity.membership)) return fail(403, "FORBIDDEN");
  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503, "CONFIG_MISSING");
  const { data: org, error: orgError } = await db.from("organizations").select("id").eq("app_id", organizationId).maybeSingle();
  if (orgError || !org?.id) return fail(409, "ORG_NOT_FOUND");
  const toCustomerRow = (row: { id?: string; app_id?: string | null; status?: string }): CheckoutCustomerRow | null =>
    row.id && row.status ? { id: row.id, appId: row.app_id ?? null, status: row.status } : null;
  const { data: appRows, error: appError } = await db.from("customers")
    .select("id, app_id, status").eq("organization_id", org.id).eq("app_id", customerId).limit(2);
  if (appError) return fail(404, "CUSTOMER_NOT_FOUND");
  const appIdMatches = (appRows ?? []).map(toCustomerRow).filter((row): row is CheckoutCustomerRow => Boolean(row));
  let idMatches: CheckoutCustomerRow[] = [];
  if (appIdMatches.length === 0 && checkoutCustomerKeyIsDbId(customerId)) {
    const { data: idRows, error: idError } = await db.from("customers")
      .select("id, app_id, status").eq("organization_id", org.id).eq("id", customerId).limit(2);
    if (idError) return fail(404, "CUSTOMER_NOT_FOUND");
    idMatches = (idRows ?? []).map(toCustomerRow).filter((row): row is CheckoutCustomerRow => Boolean(row));
  }
  const customer = chooseCheckoutCustomer({ checkoutCustomerKey: customerId, appIdMatches, idMatches });
  if (!customer) return fail(404, "CUSTOMER_NOT_FOUND");

  const lineBound = async (customerUuid: string) => {
    const { data: canonical, error: canonicalError } = await db.from("member_line_customer_links")
      .select("customer_id").eq("organization_id", org.id).eq("customer_id", customerUuid).not("verified_at", "is", null).limit(1);
    if (canonicalError) return { bound: false, failed: true as const };
    const { data: legacy, error: legacyError } = await db.from("line_customer_bindings")
      .select("customer_uuid").eq("organization_id", organizationId).eq("customer_uuid", customerUuid)
      .eq("status", "active").eq("verified", true)
      .not("confirmed_at", "is", null).not("bound_at", "is", null)
      .is("unbound_at", null).is("blocked_at", null)
      .not("line_user_id_hash", "is", null).limit(1);
    if (legacyError) return { bound: false, failed: true as const };
    return { bound: Boolean(canonical?.length || legacy?.length), failed: false as const };
  };

  const bookingLine = await lineBound(customer.id);
  if (bookingLine.failed) return fail(503, "LINK_LOOKUP_FAILED");

  // Only an authorized identity row can point this booking customer at another wallet.
  const { data: walletIdentity, error: identityError } = await db.from("customer_wallet_identities")
    .select("wallet_customer_id")
    .eq("organization_id", org.id)
    .eq("booking_customer_id", customer.id)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (identityError && identityRelationIsMissing(identityError.code)) {
    console.error("[stored-value/balance] identity_table_unavailable", { code: identityError.code });
  } else if (identityError) {
    console.error("[stored-value/balance] identity_lookup_failed", { code: identityError.code });
    return fail(503, "IDENTITY_LOOKUP_FAILED");
  }

  let link: { walletCustomerId: string; walletActive: boolean; walletLineBound: boolean } | null = null;
  if (walletIdentity?.wallet_customer_id) {
    const { data: walletCustomer, error: walletCustomerError } = await db.from("customers")
      .select("id,status").eq("organization_id", org.id).eq("id", walletIdentity.wallet_customer_id).maybeSingle();
    if (walletCustomerError) {
      console.error("[stored-value/balance] wallet_customer_lookup_failed", { code: walletCustomerError.code });
      return fail(503, "WALLET_CUSTOMER_LOOKUP_FAILED");
    }
    const walletLine = walletCustomer ? await lineBound(walletCustomer.id) : { bound: false, failed: false as const };
    if (walletLine.failed) return fail(503, "LINK_LOOKUP_FAILED");
    link = {
      walletCustomerId: walletIdentity.wallet_customer_id,
      walletActive: walletCustomer?.status === "ACTIVE",
      walletLineBound: walletLine.bound,
    };
  }

  const decision = resolveStoredValueWalletCustomer({
    bookingCustomerId: customer.id,
    bookingLineBound: bookingLine.bound,
    link,
  });
  if (!decision.ok) {
    return fail(decision.code === "LINE_LINK_REQUIRED" ? 403 : 409, decision.code);
  }

  const { data: account, error: accountError } = await db.from("stored_value_accounts")
    .select("id,status,currency").eq("organization_id", org.id).eq("customer_id", decision.walletCustomerId).maybeSingle();
  if (accountError) {
    console.error("[stored-value/balance] account_lookup_failed", { code: accountError.code });
    return fail(503, "ACCOUNT_LOOKUP_FAILED");
  }
  if (!account) return NextResponse.json({ status: "not_created", balanceMinor: null }, { headers });
  if (account.status !== "ACTIVE" || account.currency !== "TWD") return fail(409, "ACCOUNT_UNAVAILABLE");
  const { data: balance, error: balanceError } = await db.from("stored_value_ledger_balances")
    .select("ledger_balance_minor").eq("organization_id", org.id).eq("customer_id", decision.walletCustomerId)
    .eq("account_id", account.id).maybeSingle();
  if (balanceError || !balance || !Number.isSafeInteger(Number(balance.ledger_balance_minor))) {
    console.error("[stored-value/balance] balance_unavailable", { code: balanceError?.code ?? "INVALID_BALANCE" });
    return fail(503, "BALANCE_UNAVAILABLE");
  }
  return NextResponse.json({ status: "active", balanceMinor: Number(balance.ledger_balance_minor) }, { headers });
}
