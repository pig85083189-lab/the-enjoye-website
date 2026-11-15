import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";

export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  const headers = { "Cache-Control": "private, no-store" };
  if (!organizationId || organizationId.length > 120) {
    return NextResponse.json({ error: "無效的組織" }, { status: 400, headers });
  }
  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") {
    return NextResponse.json({ error: "請先登入員工帳號" }, { status: 401, headers });
  }
  if (identity.status !== "ok" || !canCheckout(identity.membership)) {
    return NextResponse.json({ error: "沒有儲值權限" }, { status: 403, headers });
  }
  const db = createBeautyOsFinanceClient();
  if (!db) { console.error("[stored-value/eligible-customers] config_missing"); return NextResponse.json({ error: "資料庫未設定", code: "CONFIG_MISSING" }, { status: 503, headers }); }
  const { data: org, error: orgError } = await db.from("organizations")
    .select("id").eq("app_id", organizationId).maybeSingle();
  if (orgError || !org?.id) return NextResponse.json({ error: "無法確認組織" }, { status: 409, headers });

  // Accept the canonical, server-verified LINE member link, plus legacy confirmed bindings.
  // Never infer membership from a matching name or phone.
  const { data: memberLinks, error: memberError } = await db.from("member_line_customer_links")
    .select("customer_id").eq("organization_id", org.id);
  if (memberError) { console.error("[stored-value/eligible-customers] canonical_links_failed", { code: memberError.code }); return NextResponse.json({ error: "無法查詢 LINE 會員資格", code: "CANONICAL_LINKS_FAILED" }, { status: 503, headers }); }
  const { data: bindings, error: bindingError } = await db.from("line_customer_bindings")
    .select("customer_uuid")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .eq("verified", true)
    .not("confirmed_at", "is", null)
    .not("bound_at", "is", null)
    .is("unbound_at", null)
    .is("blocked_at", null)
    .not("line_user_id_hash", "is", null);
  if (bindingError) { console.error("[stored-value/eligible-customers] legacy_bindings_failed", { code: bindingError.code, message: bindingError.message }); return NextResponse.json({ error: "無法查詢 LINE 會員資格", code: "LEGACY_BINDINGS_FAILED" }, { status: 503, headers }); }
  const ids = Array.from(new Set([...(memberLinks ?? []).map(b => b.customer_id), ...(bindings ?? []).map(b => b.customer_uuid)].filter((id): id is string => typeof id === "string")));
  if (ids.length === 0) return NextResponse.json({ customerIds: [], eligibleCustomers: [] }, { headers });
  const { data: customers, error: customerError } = await db.from("customers")
    .select("app_id,full_name,phone").eq("organization_id", org.id).eq("status", "ACTIVE").in("id", ids);
  if (customerError) { console.error("[stored-value/eligible-customers] customers_failed", { code: customerError.code }); return NextResponse.json({ error: "無法確認會員顧客資料", code: "CUSTOMERS_FAILED" }, { status: 503, headers }); }
  return NextResponse.json({ customerIds: (customers ?? []).map(c => c.app_id).filter(Boolean), eligibleCustomers: (customers ?? []).filter(c => c.app_id).map(c => ({ id: c.app_id, name: c.full_name ?? "", phone: c.phone ?? "" })) }, { headers });
}
