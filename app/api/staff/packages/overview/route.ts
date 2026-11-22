import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";

/** Finance-backed package catalogue and balances. No writes or local data. */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers });
  const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim() ?? "";
  if (!organizationId || organizationId.length > 120) return fail(400, "無效的店家");
  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return fail(401, "請先登入");
  if (identity.status !== "ok" || !canCheckout(identity.membership)) return fail(403, "沒有查看套票的權限");
  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503, "正式資料庫未設定");
  const { data: org, error: orgError } = await db.from("organizations").select("id").eq("app_id", organizationId).limit(2);
  if (orgError || org?.length !== 1) return fail(404, "找不到店家");
  const orgId = org[0]!.id;
  const [{ data: definitions, error: definitionError }, { data: purchases, error: purchaseError }] = await Promise.all([
    db.from("package_definitions").select("id,name,description,included_services,session_count,price_minor,currency,validity_days,is_active").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(500),
    db.from("customer_packages").select("id,customer_id,package_definition_id,name_snapshot,session_count_snapshot,price_snapshot_minor,included_service_ids_snapshot,purchased_at,expires_at,status").eq("organization_id", orgId).order("purchased_at", { ascending: false }).limit(1000),
  ]);
  if (definitionError || purchaseError) return fail(503, "無法讀取正式套票");
  const ids = (purchases ?? []).map(row => row.id);
  let balances: Array<{ customer_package_id: string; ledger_balance: number }> = [];
  if (ids.length) {
    const { data, error } = await db.from("package_ledger_balances").select("customer_package_id,ledger_balance").eq("organization_id", orgId).in("customer_package_id", ids);
    if (error) return fail(503, "無法讀取套票堂數");
    balances = data ?? [];
  }
  return NextResponse.json({ definitions: definitions ?? [], purchases: purchases ?? [], balances }, { headers });
}
