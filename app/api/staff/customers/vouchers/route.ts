import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { resolveVoucherCustomer } from "@/lib/commerce/resolve-voucher-customer-server";

export async function GET(request:Request){
 const headers={"Cache-Control":"private, no-store"};
 const fail=(status:number,code:string)=>NextResponse.json({code},{status,headers});
 const params=new URL(request.url).searchParams;
 const organizationId=params.get("organizationId"),customerId=params.get("customerId");
 if(!organizationId||!customerId||organizationId.length>120||customerId.length>120)return fail(400,"INVALID_INPUT");
 const identity=await getAuthenticatedStaffMembership({organizationId});
 if(identity.status!=="ok"||!canCheckout(identity.membership))return fail(403,"FORBIDDEN");
 const db=createBeautyOsFinanceClient();
 if(!db)return fail(503,"CONFIG_MISSING");
 const org=await db.from("organizations").select("id").eq("app_id",organizationId).maybeSingle();
 if(org.error||!org.data)return fail(409,"ORG_NOT_FOUND");
 const wallet=await resolveVoucherCustomer(organizationId,customerId,db,org.data);
 if(!wallet.ok)return fail(wallet.status,wallet.code);
 const [draw,points,audit]=await Promise.all([
 db.from("lucky_draw_results").select("id,prize_name,prize_tier,voucher_status,created_at,voucher_resolved_at").eq("organization_id",org.data.id).eq("customer_id",wallet.walletCustomerId).order("created_at",{ascending:false}),
 db.from("member_points_redemptions").select("id,gift_name,status,created_at,resolved_at").eq("organization_id",org.data.id).eq("customer_id",wallet.walletCustomerId).order("created_at",{ascending:false}),
 db.from("checkout_voucher_redemptions").select("source,voucher_id,checkout_app_id,redeemed_at").eq("organization_id",org.data.id).eq("customer_id",wallet.walletCustomerId)
 ]);
 if(draw.error||points.error||audit.error)return fail(503,"VOUCHER_LOOKUP_FAILED");
 const vouchers=[...(draw.data??[]).map(r=>({id:r.id,source:"draw",name:r.prize_name,tier:r.prize_tier,status:r.voucher_status,createdAt:r.created_at,resolvedAt:r.voucher_resolved_at})),...(points.data??[]).map(r=>({id:r.id,source:"points",name:r.gift_name,tier:null,status:r.status,createdAt:r.created_at,resolvedAt:r.resolved_at}))].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 return NextResponse.json({vouchers,redemptions:audit.data??[]},{headers});
}
