import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { decideVerifiedLineSubject, type VerifiedLineBinding } from "@/lib/commerce/line-verified-booking-source";

export async function GET(request:Request){return handle(request);}
export async function POST(request:Request){
 if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({code:"INVALID_ORIGIN"},{status:403});
 return handle(request);
}
async function handle(request: Request) {
 const headers={"Cache-Control":"private, no-store"};
 const fail=(status:number,code:string)=>NextResponse.json({code},{status,headers});
 const params=new URL(request.url).searchParams;
 let body:Record<string,unknown>|null=null;
 if(request.method==="POST"){
  try{body=await request.json();if(!body||typeof body!=="object")return fail(400,"INVALID_INPUT");}catch{return fail(400,"INVALID_INPUT");}
 }
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
 if(decision.outcome==="review")return NextResponse.json({lineVerified:false,reason:decision.reason,grantEnabled:false},{headers});
 // Fail closed even for historical duplicate ownership until reconciled.
 const [owners,oldOwners]=await Promise.all([
 db.from("member_line_customer_links").select("customer_id").eq("organization_id",org.data.id).ilike("line_subject_hash",decision.hash).limit(101),
 db.from("line_customer_bindings").select("customer_uuid").eq("organization_id",organizationId).ilike("line_user_id_hash",decision.hash).limit(101)
 ]);
 if(owners.error||oldOwners.error||(owners.data?.length??0)>100||(oldOwners.data?.length??0)>100)return fail(503,"IDENTITY_LOOKUP_FAILED");
 if((owners.data??[]).some(row=>row.customer_id!==customer.data.id)||(oldOwners.data??[]).some(row=>row.customer_uuid!==customer.data.id))return NextResponse.json({lineVerified:false,reason:"MULTIPLE_FINANCE_CUSTOMERS",grantEnabled:false},{headers});
 const campaign=await db.from("lucky_draw_campaigns").select("id,status,starts_on,ends_on,rules").eq("organization_id",org.data.id).in("status",["active","paused"]).maybeSingle();
 if(campaign.error)return fail(503,"CAMPAIGN_UNAVAILABLE");
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const c=campaign.data;
 const enabled=!!c&&c.status==="active"&&today>=c.starts_on&&today<=c.ends_on&&c.rules?.manual?.enabled===true&&process.env.LUCKY_DRAW_MANUAL_ENABLED==="true";
 if(body){
  if(!enabled||!c)return fail(409,"GRANT_DISABLED");
  const {quantity,reason,requestId,campaignId}=body;
  if(campaignId!==c.id||typeof quantity!=="number"||!Number.isInteger(quantity)||quantity<1||quantity>100||typeof reason!=="string"||!reason.trim()||reason.trim().length>300||typeof requestId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))return fail(400,"INVALID_GRANT");
  const actor=await getServerStaffAuthUser();if(!actor)return fail(403,"FORBIDDEN");
  // Keep release gate closed until transactional identity recheck is implemented.
  return fail(503,"GRANT_RPC_NOT_ENABLED");
 }
 let balance=0;
 if(c){
  const account=await db.from("lucky_draw_chance_accounts").select("balance").eq("organization_id",org.data.id).eq("customer_id",customer.data.id).eq("campaign_id",c.id).maybeSingle();
  if(account.error)return fail(503,"BALANCE_UNAVAILABLE");
  balance=Number(account.data?.balance??0);
 }
 return NextResponse.json({lineVerified:true,reason:null,grantEnabled:false,campaignId:c?.id??null,balance},{headers});
}
