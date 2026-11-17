import {NextRequest,NextResponse} from "next/server";
import {createHash} from "node:crypto";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
import {getAuthenticatedStaffMembership,getServerStaffAuthUser} from "@/lib/staff-auth/server";
export const dynamic="force-dynamic";
const ORG_APP="org-the-enjoye";
const ORG_ID="62bd49b6-a4c3-4da1-b53e-4746923685f1";
const headers={"Cache-Control":"private, no-store"};
const reply=(status:number,body:Record<string,unknown>)=>NextResponse.json(body,{status,headers});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function authorized(){
 const identity=await getAuthenticatedStaffMembership({organizationId:ORG_APP});
 if(identity.status!=="ok"||!identity.membership.isActive||
   !["OWNER","MANAGER"].includes(identity.membership.role))return null;
 const user=await getServerStaffAuthUser();
 return user?.id===identity.membership.authUserId?user:null;
}
export async function GET(request:NextRequest){
 if(!await authorized())return reply(403,{ok:false,code:"FORBIDDEN"});
 const q=(request.nextUrl.searchParams.get("q")??"").trim();
 if(q.length<2||q.length>40||/[%,()]/.test(q))return reply(400,{ok:false,code:"INVALID_QUERY"});
 const db=createBeautyOsFinanceClient();
 if(!db)return reply(503,{ok:false,code:"CONFIG_MISSING"});
 const query=db.from("customers").select("id,full_name,phone,customer_number")
   .eq("organization_id",ORG_ID).eq("status","ACTIVE").limit(10);
 const digits=q.replace(/\D/g,"");
 const result=digits.length>=4
  ?await query.ilike("phone",`%${digits}%`)
  :await query.ilike("full_name",`%${q}%`);
 if(result.error)return reply(503,{ok:false,code:"SEARCH_FAILED"});
 return reply(200,{ok:true,customers:result.data??[]});
}
export async function POST(request:NextRequest){
 if(request.headers.get("origin")!==request.nextUrl.origin)return reply(403,{ok:false,code:"ORIGIN_DENIED"});
 if(Number(request.headers.get("content-length")||"0")>512)return reply(413,{ok:false,code:"BODY_TOO_LARGE"});
 const actor=await authorized();
 if(!actor)return reply(403,{ok:false,code:"FORBIDDEN"});
 let raw:unknown;
 try{raw=await request.json()}catch{return reply(400,{ok:false,code:"INVALID_JSON"});}
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return reply(400,{ok:false,code:"INVALID_INPUT"});
 const body=raw as Record<string,unknown>;
 if(Object.keys(body).some(k=>!["code","customerId"].includes(k)))return reply(400,{ok:false,code:"INVALID_FIELDS"});
 const code=typeof body.code==="string"?body.code.trim().toUpperCase():"";
 const customerId=typeof body.customerId==="string"?body.customerId.trim():"";
 if(!/^[0-9A-F]{16}$/.test(code)||!UUID.test(customerId))return reply(400,{ok:false,code:"INVALID_INPUT"});
 const db=createBeautyOsFinanceClient();
 if(!db)return reply(503,{ok:false,code:"CONFIG_MISSING"});
 const hash=createHash("sha256").update(code).digest("hex");
 const {data,error}=await db.rpc("confirm_member_finance_line_binding",{
  p_code_hash:hash,p_customer_id:customerId,p_actor_auth_user_id:actor.id
 });
 if(error){console.error("LINE_FINANCE_BIND_CONFIRM_FAILED",{code:error.code});return reply(503,{ok:false,code:"CONFIRM_FAILED"});}
 const outcome=typeof data?.outcome==="string"?data.outcome:"UNKNOWN";
 return reply(outcome==="LINKED"?200:409,{ok:outcome==="LINKED",outcome});
}
