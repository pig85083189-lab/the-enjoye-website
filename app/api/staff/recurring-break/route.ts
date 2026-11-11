import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
const clock=/^([01]\d|2[0-3]):[0-5]\d$/;
const fail=(status:number,error:string)=>NextResponse.json({error},{status,headers});
async function context(){
 const auth=await getAuthenticatedStaffMembership();
 if(auth.status!=="ok")return {error:fail(401,"UNAUTHORIZED")};
 const admin=createServiceRoleClient();
 if(!admin)return {error:fail(503,"DATABASE_UNAVAILABLE")};
 return {member:auth.membership,admin};
}
export async function GET(request:Request){
 const locationId=new URL(request.url).searchParams.get("locationId")??"";
 const ctx=await context();if(ctx.error)return ctx.error;
 if(!ctx.member!.locationIds.includes(locationId))return fail(403,"LOCATION_NOT_AUTHORIZED");
 const effectiveDate=new Date(Date.now()+8*3600000+86400000).toISOString().slice(0,10);
 const {data,error}=await ctx.admin!.from("booking_staff_recurring_breaks").select("start_time,end_time,effective_from")
 .eq("organization_id",ctx.member!.organizationId).eq("location_id",locationId).eq("staff_id",ctx.member!.userId).lte("effective_from",effectiveDate).or(`effective_to.is.null,effective_to.gte.${effectiveDate}`).limit(2);
 if(error||!data||data.length>1)return fail(503,"RECURRING_BREAK_READ_FAILED");
 const current=data[0];
 return NextResponse.json({break:current?{start:current.start_time.slice(0,5),end:current.end_time.slice(0,5),effectiveFrom:current.effective_from}:null},{headers});
}
export async function POST(request:Request){
 const origin=request.headers.get("origin"),host=request.headers.get("host");
 if(!origin||!host)return fail(403,"ORIGIN_REQUIRED");
 let url:URL;try{url=new URL(origin);}catch{return fail(403,"INVALID_ORIGIN");}
 if(url.host!==host||(url.protocol!=="https:"&&!(url.protocol==="http:"&&["localhost","127.0.0.1"].includes(url.hostname))))return fail(403,"CROSS_ORIGIN_FORBIDDEN");
 if(!request.headers.get("content-type")?.startsWith("application/json"))return fail(415,"JSON_REQUIRED");
 let body:unknown;try{body=await request.json();}catch{return fail(400,"INVALID_JSON");}
 if(!body||typeof body!=="object"||Array.isArray(body))return fail(400,"INVALID_BODY");
 const input=body as Record<string,unknown>;
 if(Object.keys(input).sort().join(",")!=="end,locationId,start"||typeof input.locationId!=="string")return fail(400,"INVALID_BODY");
 const empty=input.start===null&&input.end===null;
 if(!empty&&(typeof input.start!=="string"||typeof input.end!=="string"||!clock.test(input.start)||!clock.test(input.end)||input.start>=input.end))return fail(400,"INVALID_BREAK_INTERVAL");
 const ctx=await context();if(ctx.error)return ctx.error;
 if(!ctx.member!.locationIds.includes(input.locationId))return fail(403,"LOCATION_NOT_AUTHORIZED");
 const {data,error}=await ctx.admin!.rpc("staff_self_recurring_break_replace_v1",{
 p_membership_id:ctx.member!.id,p_location_id:input.locationId,p_start:input.start,p_end:input.end
 });
 if(error){
 const known=["APPOINTMENT_CONFLICT","INVALID_BREAK_DETAILS","STAFF_SCHEDULE_NOT_FOUND","MEMBERSHIP_OR_LOCATION_NOT_AUTHORIZED"].find(x=>error.message?.includes(x));
 return fail(known==="APPOINTMENT_CONFLICT"?409:503,known??"RECURRING_BREAK_SAVE_FAILED");
 }
 return NextResponse.json({ok:true,result:data},{headers});
}
