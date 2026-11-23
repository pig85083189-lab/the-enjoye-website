import { NextResponse } from "next/server";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers });
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128 &&
  /^[a-zA-Z0-9:_-]+$/.test(value);

/**
 * Fail-closed settlement for an ALREADY PREPARED zero-value service checkout.
 * No creation or mutation of drafts is permitted here.
 * Requires a separately reviewed finance RPC and an explicit feature flag.
 */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail(403,"無效請求來源");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return fail(415,"請使用 JSON");
  if (process.env.BEAUTY_OS_PACKAGE_REDEMPTION_ENABLED !== "1") return fail(503,"套票扣堂尚未開放");
  let input: Record<string,unknown>;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400,"資料格式不正確");
    input = body as Record<string,unknown>;
  } catch { return fail(400,"資料格式不正確"); }
  const allowed = ["organizationId","checkoutAppId","expectedUpdatedAt","customerPackageAppId","serviceAppId","appointmentAppId"];
  if (Object.keys(input).some(k=>!allowed.includes(k)) ||
      ![input.organizationId,input.checkoutAppId,input.customerPackageAppId,input.serviceAppId,input.appointmentAppId].every(id) ||
      !/^redemption:[a-zA-Z0-9_-]{12,90}$/.test(input.checkoutAppId as string) ||
      typeof input.expectedUpdatedAt !== "string" ||
      !Number.isFinite(Date.parse(input.expectedUpdatedAt))) return fail(400,"套票核銷資料不完整");
  const organizationId = input.organizationId as string;
  const auth = await getAuthenticatedStaffMembership({ organizationId });
  if (auth.status === "unauthenticated") return fail(401,"請先登入");
  if (auth.status !== "ok" || !canCheckout(auth.membership) || !["OWNER","MANAGER","STAFF"].includes(auth.membership.role)) return fail(403,"沒有套票核銷權限");
  const actor = await getServerStaffAuthUser();
  if (!actor || actor.id !== auth.membership.authUserId) return fail(403,"沒有結帳權限");
  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503,"財務資料庫未設定");
  const {data:orgs,error:orgError} = await db.from("organizations").select("id").eq("app_id",organizationId).limit(2);
  if (orgError || orgs?.length !== 1) return fail(404,"找不到店家");
  const orgDbId = orgs[0]!.id;
  const {data:drafts,error:draftError} = await db.from("checkout_drafts")
    .select("id,organization_id,customer_id,status,total_minor,subtotal_minor,discount_total_minor,package_redemption,updated_at")
    .eq("organization_id",orgDbId).eq("app_id",input.checkoutAppId).limit(2);
  if (draftError || drafts?.length !== 1) return fail(404,"找不到正式結帳單");
  const draft = drafts[0]!;
  if (!["OPEN","READY"].includes(draft.status) ||
      draft.updated_at !== input.expectedUpdatedAt ||
      draft.total_minor !== 0 || draft.subtotal_minor !== 0 || draft.discount_total_minor !== 0)
    return fail(409,"結帳單不是可核銷的零元交易");
  const [{data:packages,error:packageError},{data:services,error:serviceError},{data:items,error:itemError},
    {data:payments,error:paymentError},{data:discounts,error:discountError}] = await Promise.all([
    db.from("customer_packages").select("id,app_id,status,expires_at,included_service_ids_snapshot")
      .eq("organization_id",orgDbId).eq("customer_id",draft.customer_id)
      .eq("app_id",input.customerPackageAppId).limit(2),
    db.from("services").select("id,app_id,is_active").eq("organization_id",orgDbId)
      .eq("app_id",input.serviceAppId).limit(2),
    db.from("checkout_items").select("type,reference_id,quantity,unit_price_minor,line_total_minor,line_subtotal_minor,discount_amount_minor")
      .eq("checkout_draft_id",draft.id).limit(2),
    db.from("checkout_payments").select("id").eq("checkout_draft_id",draft.id).limit(1),
    db.from("checkout_discounts").select("id").eq("checkout_draft_id",draft.id).limit(1),
  ]);
  if (packageError || serviceError || itemError || paymentError || discountError) return fail(503,"無法驗證核銷資格");
  if (packages?.length !== 1 || services?.length !== 1 || items?.length !== 1 ||
      (payments?.length ?? 0)>0 || (discounts?.length ?? 0)>0) return fail(409,"套票核銷資料不一致");
  const pkg = packages[0]!, service = services[0]!, line = items[0]!;
  if (pkg.status !== "ACTIVE" || (pkg.expires_at && Date.parse(pkg.expires_at)<=Date.now()) ||
      !service.is_active || !(pkg.included_service_ids_snapshot?.includes(service.app_id) || pkg.included_service_ids_snapshot?.includes(service.id)) ||
      line.type !== "SERVICE" || line.reference_id !== service.app_id || line.quantity !== 1 ||
      line.unit_price_minor !== 0 || line.line_total_minor !== 0 ||
      line.line_subtotal_minor !== 0 || line.discount_amount_minor !== 0 ||
      draft.package_redemption?.customerPackageId !== pkg.app_id ||
      draft.package_redemption?.serviceId !== service.app_id ||
      draft.package_redemption?.sessions !== 1) return fail(409,"套票或零元療程不符合核銷條件");
  const {data:entries,error:ledgerError} = await db.from("package_ledger_entries")
    .select("session_delta").eq("organization_id",orgDbId).eq("customer_package_id",pkg.id);
  if (ledgerError || (entries??[]).reduce((sum,e)=>sum+Number(e.session_delta),0)<1)
    return fail(409,"套票剩餘堂數不足");
  // Validate the actual booking source identity, never infer an appointment by name/time.
  const booking = createServiceRoleClient();
  if (!booking) return fail(503,"預約資料庫未設定");
  const {data:bookingRows,error:bookingError} = await booking.from("appointments")
    .select("id,organization_id,location_id,customer_id,service_id")
    .eq("app_id",input.appointmentAppId).limit(2);
  if (bookingError || bookingRows?.length !== 1) return fail(409,"找不到對應的預約");
  const booked = bookingRows[0]!;
  const [{data:bookingOrgs,error:bookingOrgError},{data:bookingLocations,error:bookingLocError},
    {data:customerLinks,error:customerLinkError}] = await Promise.all([
    booking.from("organizations").select("app_id").eq("id",booked.organization_id).limit(1),
    booking.from("locations").select("app_id").eq("id",booked.location_id).limit(1),
    db.from("booking_source_customer_links").select("source_customer_key")
      .eq("organization_id",orgDbId).eq("finance_booking_customer_id",draft.customer_id)
      .eq("source_customer_key",booked.customer_id).eq("status","ACTIVE").limit(2),
  ]);
  const {data:draftLocations,error:draftLocationError} = await db.from("checkout_drafts")
    .select("location_id").eq("id",draft.id).limit(1);
  const {data:financeLocations,error:financeLocationError} = draftLocations?.length===1
    ? await db.from("locations").select("app_id").eq("id",draftLocations[0]!.location_id).limit(1)
    : {data:null,error:null};
  if (bookingOrgError || bookingLocError || customerLinkError || draftLocationError || financeLocationError ||
      bookingOrgs?.[0]?.app_id !== organizationId ||
      !bookingLocations?.[0]?.app_id || bookingLocations[0]!.app_id !== financeLocations?.[0]?.app_id ||
      customerLinks?.length !== 1 || booked.service_id !== service.id)
    return fail(409,"預約與套票核銷資料不符");
  // The RPC independently validates actor, branch, checkout, customer and
  // service and atomically settles and debits one session.
  const {data,error} = await db.rpc("finance_package_redemption_bridge",{
    p_actor_auth_user_id:actor.id,
    p_checkout_app_id:input.checkoutAppId,
    p_expected_updated_at:input.expectedUpdatedAt,
    p_customer_package_id:pkg.id,
    p_service_id:service.id,
  });
  if (error) {
    console.error("[package-redemption] rejected",{code:error.code});
    return fail(error.code==="PGRST202" ? 503 : 409,"核銷未完成，請重新整理並確認交易狀態");
  }
  // Link only the completed transaction created by this checkout; never settle again.
  const {data:completed,error:completedError} = await db.from("transactions")
    .select("id,package_redemption,status").eq("checkout_draft_id",draft.id).limit(2);
  if (completedError || completed?.length !== 1 || completed[0]!.status !== "COMPLETED" ||
      completed[0]!.package_redemption?.customerPackageId !== pkg.app_id) {
    console.error("[package-redemption] appointment link pending: transaction not found");
    return NextResponse.json({bundle:data,appointmentLinkPending:true},{headers});
  }
  const tx = completed[0]!;
  const existingLink = tx.package_redemption?.bookingAppointmentId;
  if (existingLink && existingLink !== input.appointmentAppId)
    return NextResponse.json({bundle:data,appointmentLinkPending:true},{headers});
  if (!existingLink) {
    const {error:linkError} = await db.from("transactions")
      .update({package_redemption:{...tx.package_redemption,bookingAppointmentId:input.appointmentAppId}})
      .eq("id",tx.id).eq("status","COMPLETED")
      .is("package_redemption->>bookingAppointmentId",null);
    if (linkError) {
      console.error("[package-redemption] appointment link pending",{code:linkError.code});
      return NextResponse.json({bundle:data,appointmentLinkPending:true},{headers});
    }
  }
  return NextResponse.json({bundle:data},{headers});
}
