import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";

/** Read-only preflight for a specified-treatment package redemption.
 * This is NOT a redemption or payment authorization. The eventual debit must
 * recheck all conditions atomically inside the database transaction.
 */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers });
  const p = new URL(request.url).searchParams;
  const organizationId = p.get("organizationId")?.trim() ?? "";
  const customerPackageId = p.get("customerPackageId")?.trim() ?? "";
  const serviceId = p.get("serviceId")?.trim() ?? "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!organizationId || organizationId.length > 120 || !uuid.test(customerPackageId) || !uuid.test(serviceId)) {
    return fail(400, "套票或療程資料不正確");
  }
  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return fail(401, "請先登入");
  if (identity.status !== "ok" || !canCheckout(identity.membership)) return fail(403, "沒有套票操作權限");
  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503, "正式資料庫未設定");
  const { data: org, error: orgError } = await db.from("organizations").select("id")
    .eq("app_id", organizationId).limit(2);
  if (orgError || org?.length !== 1) return fail(404, "找不到店家");
  const orgId = org[0]!.id;
  const [{ data: pkg, error: pkgError }, { data: service, error: serviceError }] = await Promise.all([
    db.from("customer_packages").select("id,status,expires_at,included_service_ids_snapshot")
      .eq("organization_id", orgId).eq("id", customerPackageId).maybeSingle(),
    db.from("services").select("id,is_active").eq("organization_id", orgId)
      .eq("id", serviceId).maybeSingle(),
  ]);
  if (pkgError || serviceError) return fail(503, "無法驗證套票資格");
  if (!pkg) return fail(404, "找不到套票");
  const { data: balance, error: balanceError } = await db.from("package_ledger_balances")
    .select("ledger_balance").eq("organization_id", orgId)
    .eq("customer_package_id", customerPackageId).maybeSingle();
  if (balanceError) return fail(503, "無法確認剩餘堂數");
  const remaining = balance?.ledger_balance ?? 0;
  let reason: string | null = null;
  if (pkg.status === "VOIDED") reason = "套票已作廢";
  else if (pkg.status === "EXPIRED") reason = "套票已過期";
  else if (pkg.status === "EXHAUSTED") reason = "套票堂數已用完";
  else if (pkg.status !== "ACTIVE") reason = "套票目前不可使用";
  else if (pkg.expires_at && Date.parse(pkg.expires_at) <= Date.now()) reason = "套票已過期";
  else if (remaining <= 0) reason = "套票剩餘堂數不足";
  else if (!service?.is_active) reason = "療程不存在或已停用";
  else if (!Array.isArray(pkg.included_service_ids_snapshot) ||
    !pkg.included_service_ids_snapshot.includes(serviceId)) reason = "此套票不包含指定療程";
  return NextResponse.json({ eligible: reason === null, reason, remaining }, { headers });
}
