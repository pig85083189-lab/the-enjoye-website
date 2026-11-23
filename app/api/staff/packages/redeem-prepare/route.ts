import { NextResponse } from "next/server";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status:number,error:string)=>NextResponse.json({error},{status,headers});
const valid=(v:unknown):v is string=>typeof v==="string" && v.length>0 && v.length<=128 && /^[a-zA-Z0-9:_-]+$/.test(v);

export async function POST(request:Request) {
  if(request.headers.get("origin")!==new URL(request.url).origin)return fail(403,"無效請求來源");
  if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return fail(415,"請使用 JSON");
  if(process.env.BEAUTY_OS_PACKAGE_REDEMPTION_ENABLED!=="1")return fail(503,"正式套票核銷尚未開放");
  let body:Record<string,unknown>;
  try {const value:unknown=await request.json();if(!value||typeof value!=="object"||Array.isArray(value))return fail(400,"資料格式不正確");body=value as Record<string,unknown>;}
  catch{return fail(400,"資料格式不正確");}
  const allowed=["organizationId","locationId","customerId","customerPackageAppId","serviceAppId","checkoutAppId"];
  if(Object.keys(body).some(k=>!allowed.includes(k))||allowed.some(k=>!valid(body[k])) ||
     !/^redemption:[a-zA-Z0-9_-]{12,90}$/.test(body.checkoutAppId as string))return fail(400,"核銷資料不完整");
  const organizationId=body.organizationId as string;
  const identity=await getAuthenticatedStaffMembership({organizationId});
  if(identity.status==="unauthenticated")return fail(401,"請先登入");
  if(identity.status!=="ok"||!canCheckout(identity.membership)||!["OWNER","MANAGER","STAFF"].includes(identity.membership.role))return fail(403,"沒有套票核銷權限");
  const actor=await getServerStaffAuthUser();
  if(!actor||actor.id!==identity.membership.authUserId)return fail(403,"沒有結帳權限");
  const db=createBeautyOsFinanceClient();
  if(!db)return fail(503,"財務資料庫未設定");
  const {data:orgs,error:orgError}=await db.from("organizations").select("id").eq("app_id",organizationId).limit(2);
  if(orgError||orgs?.length!==1)return fail(404,"找不到店家");
  const orgDbId=orgs[0]!.id;
  const [{data:locs,error:locError},{data:services,error:serviceError},{data:packages,error:packageError},
    {data:customers,error:customerError}]=await Promise.all([
    db.from("locations").select("id").eq("organization_id",orgDbId).eq("app_id",body.locationId).limit(2),
    db.from("services").select("id").eq("organization_id",orgDbId).eq("app_id",body.serviceAppId).eq("is_active",true).limit(2),
    db.from("customer_packages").select("id,customer_id").eq("organization_id",orgDbId).eq("app_id",body.customerPackageAppId).eq("status","ACTIVE").limit(2),
    db.from("customers").select("id").eq("organization_id",orgDbId).eq("app_id",body.customerId).limit(2),
  ]);
  if(locError||serviceError||packageError||customerError)return fail(503,"無法驗證核銷資料");
  if(locs?.length!==1||services?.length!==1||packages?.length!==1)return fail(409,"套票或指定療程無效");
  let customerDbId=customers?.length===1?customers[0]!.id:null;
  if(!customerDbId&&typeof body.customerId==="string"){
    const {data:links,error:linkError}=await db.from("booking_source_customer_links")
      .select("finance_booking_customer_id").eq("organization_id",orgDbId)
      .eq("source_customer_key",body.customerId).eq("status","ACTIVE").limit(2);
    if(linkError)return fail(503,"顧客身分對應無法確認");
    if(links?.length===1)customerDbId=links[0]!.finance_booking_customer_id;
  }
  // Only a current verified booking-to-LINE identity can authorize using
  // packages owned by the LINE member. Names/phone numbers are not proof.
  if(typeof body.customerId==="string" && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(body.customerId)){
    const {data:verifiedLinks,error:verifiedError}=await db.from("member_booking_finance_identity_links")
      .select("finance_customer_id").eq("organization_id",orgDbId)
      .eq("booking_customer_id",body.customerId).not("verified_at","is",null)
      .is("revoked_at",null).limit(2);
    if(verifiedError)return fail(503,"無法確認 LINE 會員身分");
    if((verifiedLinks?.length??0)>1)return fail(409,"LINE 會員身分對應不唯一");
    if(verifiedLinks?.length===1)customerDbId=verifiedLinks[0]!.finance_customer_id;
  }
  if(!customerDbId||packages[0]!.customer_id!==customerDbId)return fail(409,"套票與顧客不符");
  const {data,error}=await db.rpc("finance_prepare_package_redemption_checkout",{
    p_actor_auth_user_id:actor.id,p_checkout_app_id:body.checkoutAppId,
    p_organization_app_id:organizationId,p_location_app_id:body.locationId,
    p_finance_customer_id:customerDbId,p_customer_package_id:packages[0]!.id,
    p_service_id:services[0]!.id,
  });
  if(error){console.error("[package-redemption] prepare rejected",{code:error.code});return fail(error.code==="PGRST202"?503:409,"核銷結帳單無法建立，請稍後重試");}
  return NextResponse.json({draft:data},{headers});
}
