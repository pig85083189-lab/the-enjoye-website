import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

/** Read-only: actual redemption requires a separate atomic settlement path. */
export async function GET(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get("organizationId")?.trim() ?? "";
  const customerId = request.nextUrl.searchParams.get("customerId")?.trim() ?? "";
  const serviceId = request.nextUrl.searchParams.get("serviceId")?.trim() ?? "";
  if (![organizationId, customerId, serviceId].every(v => v.length > 0 && v.length <= 128)) return fail(400, "資料格式不正確");
  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return fail(401, "請先登入");
  if (identity.status !== "ok" || !canCheckout(identity.membership)) return fail(403, "沒有結帳權限");
  const actor = await getServerStaffAuthUser();
  if (!actor || actor.id !== identity.membership.authUserId) return fail(403, "沒有結帳權限");
  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503, "正式財務資料庫未設定");
  const { data: orgs, error: orgError } = await db.from("organizations").select("id").eq("app_id", organizationId).limit(2);
  if (orgError || orgs?.length !== 1) return fail(404, "找不到店家");
  const orgDbId = orgs[0]!.id;
  const [{data: directStaff,error:staffError},{data:links,error:linksError}] = await Promise.all([
    db.from("staff_auth_memberships").select("id,user_id,role").eq("organization_id",organizationId).eq("auth_user_id",actor.id).eq("is_active",true).limit(2),
    db.from("finance_booking_actor_links").select("finance_membership_id").eq("booking_auth_user_id",actor.id).limit(2),
  ]);
  if (staffError || linksError) return fail(503,"無法確認員工授權");
  let staff = directStaff ?? [];
  if (staff.length === 0 && links?.length === 1) {
    const mapped = await db.from("staff_auth_memberships").select("id,user_id,role")
      .eq("id",links[0]!.finance_membership_id).eq("organization_id",organizationId).eq("is_active",true).limit(2);
    if (mapped.error) return fail(503,"無法確認員工授權");
    staff = mapped.data ?? [];
  }
  if (staff.length !== 1 || staff[0]!.user_id !== identity.membership.userId || staff[0]!.role !== identity.membership.role) return fail(403,"員工財務授權不符");
  const [{data:customers,error:customerError},{data:services,error:serviceError}] = await Promise.all([
    db.from("customers").select("id").eq("organization_id",orgDbId).eq("app_id",customerId).limit(2),
    db.from("services").select("id,app_id").eq("organization_id",orgDbId).eq("app_id",serviceId).eq("is_active",true).limit(2),
  ]);
  if (customerError || serviceError) return fail(503,"無法查詢套票");
  let financeCustomer = customers?.length === 1 ? customers[0] : null;
  if (!financeCustomer && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(customerId)) {
    const link = await db.from("booking_source_customer_links")
      .select("finance_booking_customer_id").eq("organization_id",orgDbId)
      .eq("source_customer_key",customerId).eq("status","ACTIVE").limit(2);
    if (link.error) return fail(503,"無法核對顧客身分對應");
    if (link.data?.length === 1) {
      const mapped = await db.from("customers").select("id").eq("id",link.data[0]!.finance_booking_customer_id)
        .eq("organization_id",orgDbId).limit(2);
      if (mapped.error) return fail(503,"無法核對顧客身分對應");
      if (mapped.data?.length === 1) financeCustomer = mapped.data[0]!;
    }
  }
  if (!financeCustomer || services?.length !== 1) return NextResponse.json({packages:[]},{headers:noStore});
  const {data:packages,error:packageError} = await db.from("customer_packages")
    .select("id,app_id,name_snapshot,status,expires_at,purchased_at,included_service_ids_snapshot")
    .eq("organization_id",orgDbId).eq("customer_id",financeCustomer.id).eq("status","ACTIVE")
    .order("purchased_at",{ascending:true}).order("id",{ascending:true});
  if (packageError) return fail(503,"無法查詢套票");
  const eligible = (packages ?? []).filter(p => (p.included_service_ids_snapshot?.includes(serviceId) || p.included_service_ids_snapshot?.includes(services[0]!.id)) &&
    (!p.expires_at || new Date(p.expires_at).getTime() > Date.now()));
  if (!eligible.length) return NextResponse.json({packages:[]},{headers:noStore});
  const {data:entries,error:ledgerError} = await db.from("package_ledger_entries")
    .select("customer_package_id,session_delta").eq("organization_id",orgDbId)
    .in("customer_package_id",eligible.map(p=>p.id));
  if (ledgerError) return fail(503,"無法查詢套票餘額");
  const balances = new Map<string,number>();
  for (const e of entries ?? []) balances.set(e.customer_package_id,(balances.get(e.customer_package_id)??0)+Number(e.session_delta));
  return NextResponse.json({packages:eligible.filter(p=>(balances.get(p.id)??0)>0).map(p=>({
    id:p.app_id ?? p.id,name:p.name_snapshot,remaining:balances.get(p.id)??0,
  }))},{headers:noStore});
}
