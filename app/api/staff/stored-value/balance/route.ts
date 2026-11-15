import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
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
  const { data: customer, error: customerError } = await db.from("customers")
    .select("id").eq("organization_id", org.id).eq("app_id", customerId).eq("status", "ACTIVE").maybeSingle();
  if (customerError || !customer?.id) return fail(404, "CUSTOMER_NOT_FOUND");

  // Revalidate LINE ownership server-side; never trust the picker or client-supplied customer ID.
  const { data: canonical, error: canonicalError } = await db.from("member_line_customer_links")
    .select("customer_id").eq("organization_id", org.id).eq("customer_id", customer.id).limit(1);
  if (canonicalError) return fail(503, "LINK_LOOKUP_FAILED");
  const { data: legacy, error: legacyError } = await db.from("line_customer_bindings")
    .select("customer_uuid").eq("organization_id", organizationId).eq("customer_uuid", customer.id)
    .eq("status", "active").eq("verified", true)
    .not("confirmed_at", "is", null).not("bound_at", "is", null)
    .is("unbound_at", null).is("blocked_at", null)
    .not("line_user_id_hash", "is", null).limit(1);
  if (legacyError) return fail(503, "LINK_LOOKUP_FAILED");
  if (!canonical?.length && !legacy?.length) return fail(403, "LINE_LINK_REQUIRED");

  const { data: account, error: accountError } = await db.from("stored_value_accounts")
    .select("id,status,currency").eq("organization_id", org.id).eq("customer_id", customer.id).maybeSingle();
  if (accountError) return fail(503, "ACCOUNT_LOOKUP_FAILED");
  if (!account) return NextResponse.json({ status: "not_created", balanceMinor: null }, { headers });
  if (account.status !== "ACTIVE" || account.currency !== "TWD") return fail(409, "ACCOUNT_UNAVAILABLE");
  const { data: balance, error: balanceError } = await db.from("stored_value_ledger_balances")
    .select("ledger_balance_minor").eq("organization_id", org.id).eq("customer_id", customer.id)
    .eq("account_id", account.id).maybeSingle();
  if (balanceError || !balance || !Number.isSafeInteger(Number(balance.ledger_balance_minor))) return fail(503, "BALANCE_UNAVAILABLE");
  return NextResponse.json({ status: "active", balanceMinor: Number(balance.ledger_balance_minor) }, { headers });
}
