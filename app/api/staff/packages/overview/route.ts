import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";

/** Finance-backed package catalogue and balances. No writes or local data. */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers });
  const params = new URL(request.url).searchParams;
  const organizationId = params.get("organizationId")?.trim() ?? "";
  const customerId = params.get("customerId")?.trim() ?? "";
  if (customerId.length > 120) return fail(400, "無效的顧客");
  if (!organizationId || organizationId.length > 120) return fail(400, "無效的店家");
  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return fail(401, "請先登入");
  if (identity.status !== "ok" || !canCheckout(identity.membership)) return fail(403, "沒有查看套票的權限");
  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503, "正式資料庫未設定");
  const { data: org, error: orgError } = await db.from("organizations").select("id").eq("app_id", organizationId).limit(2);
  if (orgError || org?.length !== 1) return fail(404, "找不到店家");
  const orgId = org[0]!.id;
  let financeCustomerId: string | null = null;
  if (customerId) {
    const { data: direct, error: directError } = await db.from("customers").select("id")
      .eq("organization_id", orgId).eq("app_id", customerId).limit(2);
    if (directError) return fail(503, "無法確認顧客");
    if (direct?.length === 1) financeCustomerId = direct[0]!.id;
    if (!financeCustomerId) {
      const { data: pairs, error: pairError } = await db.from("member_booking_finance_identity_links")
        .select("finance_customer_id,finance_confirmation_id")
        .eq("organization_id", orgId).eq("booking_customer_id", customerId)
        .is("revoked_at", null).limit(2);
      if (pairError) return fail(503, "無法確認會員身分");
      if (pairs?.length === 1) {
        const pair = pairs[0]!;
        const { data: confirmed, error: confirmError } = await db.from("member_finance_binding_challenges")
          .select("id").eq("organization_id", orgId).eq("id", pair.finance_confirmation_id)
          .eq("confirmed_customer_id", pair.finance_customer_id)
          .eq("status", "CONFIRMED").not("confirmed_at", "is", null).maybeSingle();
        if (confirmError) return fail(503, "無法驗證會員身分");
        if (confirmed) financeCustomerId = pair.finance_customer_id;
      }
    }
    if (!financeCustomerId) {
      const { data: links, error: linkError } = await db.from("booking_source_customer_links")
        .select("finance_booking_customer_id").eq("organization_id", orgId)
        .eq("source_customer_key", customerId).eq("status", "ACTIVE")
        .eq("evidence_kind", "LINE_VERIFIED_SESSION").is("revoked_at", null).limit(2);
      if (linkError) return fail(503, "無法確認顧客對應");
      if (links?.length === 1) financeCustomerId = links[0]!.finance_booking_customer_id;
    }
    if (!financeCustomerId) return fail(404, "找不到已驗證顧客");
  }
  const [{ data: definitions, error: definitionError }, { data: purchases, error: purchaseError }] = await Promise.all([
    db.from("package_definitions").select("id,name,description,included_services,session_count,price_minor,currency,validity_days,is_active").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(500),
    db.from("customer_packages").select("id,customer_id,package_definition_id,name_snapshot,session_count_snapshot,price_snapshot_minor,included_service_ids_snapshot,purchased_at,expires_at,status").eq("organization_id", orgId).match(financeCustomerId ? { customer_id: financeCustomerId } : {}).order("purchased_at", { ascending: false }).limit(1000),
  ]);
  if (definitionError || purchaseError) return fail(503, "無法讀取正式套票");
  const ids = (purchases ?? []).map(row => row.id);
  let balances: Array<{ customer_package_id: string; ledger_balance: number }> = [];
  if (ids.length) {
    const { data, error } = await db.from("package_ledger_balances").select("customer_package_id,ledger_balance").eq("organization_id", orgId).in("customer_package_id", ids);
    if (error) return fail(503, "無法讀取套票堂數");
    balances = data ?? [];
  }
  const { data: services, error: serviceError } = await db.from("services")
    .select("id,app_id,name,is_active")
    .eq("organization_id", orgId)
    .order("name", { ascending: true }).limit(500);
  if (serviceError) return fail(503, "無法確認指定療程");
  return NextResponse.json({ definitions: definitions ?? [], purchases: purchases ?? [], balances, services: services ?? [] }, { headers });
}
