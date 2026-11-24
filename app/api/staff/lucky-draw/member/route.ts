import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { decideVerifiedLineSubject, type VerifiedLineBinding } from "@/lib/commerce/line-verified-booking-source";

export async function GET(request: Request) {
 const headers={"Cache-Control":"private, no-store"};
 const fail=(status:number,code:string)=>NextResponse.json({code},{status,headers});
 const params=new URL(request.url).searchParams;
 const organizationId=params.get("organizationId")?.trim();
 const customerId=params.get("customerId")?.trim();
 if(!organizationId||organizationId.length>120||!customerId||customerId.length>120)return fail(400,"INVALID_INPUT");
 const identity=await getAuthenticatedStaffMembership({organizationId});
 if(identity.status!=="ok"||!["OWNER","MANAGER"].includes(identity.membership.role))return fail(403,"FORBIDDEN");
 const db=createBeautyOsFinanceClient();
 if(!db)return fail(503,"CONFIG_MISSING");
 const org=await db.from("organizations").select("id").eq("app_id",organizationId).single();
 if(org.error||!org.data)return fail(503,"ORG_UNAVAILABLE");
 const customer=await db.from("customers").select("id,status").eq("organization_id",org.data.id).eq("app_id",customerId).maybeSingle();
 if(customer.error)return fail(503,"LOOKUP_FAILED");
 if(!customer.data)return fail(404,"CUSTOMER_NOT_FOUND");
 const [canonical,legacy]=await Promise.all([
 db.from("member_line_customer_links").select("line_subject_hash,verified_at").eq("organization_id",org.data.id).eq("customer_id",customer.data.id).limit(101),
 db.from("line_customer_bindings").select("line_user_id_hash,status,verified,confirmed_at,bound_at,unbound_at,blocked_at").eq("organization_id",organizationId).eq("customer_uuid",customer.data.id).limit(101)
 ]);
 if(canonical.error||legacy.error||(canonical.data?.length??0)>100||(legacy.data?.length??0)>100)return fail(503,"IDENTITY_LOOKUP_FAILED");
 const bindings:VerifiedLineBinding[]=[
 ...(canonical.data??[]).map(row=>({source:"member_link" as const,hash:row.line_subject_hash,verified:!!row.verified_at,status:row.verified_at?"active":"pending",confirmedAt:row.verified_at,boundAt:row.verified_at,unboundAt:null,blockedAt:null})),
 ...(legacy.data??[]).map(row=>({source:"binding" as const,hash:row.line_user_id_hash,verified:row.verified===true,status:String(row.status??""),confirmedAt:row.confirmed_at,boundAt:row.bound_at,unboundAt:row.unbound_at,blockedAt:row.blocked_at}))
 ];
 const decision=decideVerifiedLineSubject({organizationAppId:organizationId,customerOrganizationAppId:organizationId,customerStatus:customer.data.status,bindings});
 return NextResponse.json({lineVerified:decision.outcome==="hash",reason:decision.outcome==="review"?decision.reason:null,grantEnabled:false},{headers});
}
