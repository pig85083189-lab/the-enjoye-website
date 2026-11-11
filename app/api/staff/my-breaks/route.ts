import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const headers = { "Cache-Control": "no-store" };
function fail(status: number, error: string) { return NextResponse.json({ error }, { status, headers }); }
function validDate(date: string) {
  const ms = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,10) !== date) return false;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year:"numeric",month:"2-digit",day:"2-digit" }).format(new Date());
  return ms >= Date.parse(today+"T00:00:00Z") && ms <= Date.parse(today+"T00:00:00Z")+180*86400000;
}
async function context(locationId: string) {
  const auth = await getAuthenticatedStaffMembership();
  if (auth.status !== "ok") return { error: fail(401,"UNAUTHORIZED") };
  if (!auth.membership.locationIds.includes(locationId)) return { error: fail(403,"LOCATION_NOT_AUTHORIZED") };
  const admin = createServiceRoleClient();
  if (!admin) return { error: fail(503,"DATABASE_UNAVAILABLE") };
  const { data, error } = await admin.from("booking_staff_working_hours").select("staff_id")
    .eq("organization_id",auth.membership.organizationId).eq("location_id",locationId)
    .eq("staff_id",auth.membership.userId).limit(1);
  if (error) return { error: fail(503,"SCHEDULE_UNAVAILABLE") };
  if (!data?.length) return { error: fail(403,"STAFF_SCHEDULE_NOT_FOUND") };
  return { admin, member: auth.membership };
}
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const locationId=params.get("locationId")??"",date=params.get("date")??"";
  if (!DATE.test(date) || !validDate(date)) return fail(400,"INVALID_DATE");
  const ctx=await context(locationId);if(ctx.error)return ctx.error;
  const start=date+"T00:00:00+08:00";
  const end=new Date(Date.parse(start)+86400000).toISOString();
  const {data,error}=await ctx.admin!.from("booking_staff_breaks").select("starts_at,ends_at")
    .eq("organization_id",ctx.member!.organizationId).eq("location_id",locationId)
    .eq("staff_id",ctx.member!.userId).gte("starts_at",start).lt("starts_at",end)
    .order("starts_at").limit(13);
  if(error||!data||data.length>12)return fail(503,"BREAK_READ_FAILED");
  const clock=(value:string)=>new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(value));
  return NextResponse.json({breaks:data.map(row=>({start:clock(row.starts_at),end:clock(row.ends_at)}))},{headers});
}
export async function POST(request:Request) {
  const origin=request.headers.get("origin"),host=request.headers.get("host");
  if(!origin||!host)return fail(403,"ORIGIN_REQUIRED");
  let url:URL;try{url=new URL(origin);}catch{return fail(403,"INVALID_ORIGIN");}
  if(url.host!==host||(url.protocol!=="https:"&&!(url.protocol==="http:"&&["localhost","127.0.0.1"].includes(url.hostname))))return fail(403,"CROSS_ORIGIN_FORBIDDEN");
  if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return fail(415,"JSON_REQUIRED");
  let body:unknown;try{body=await request.json();}catch{return fail(400,"INVALID_JSON");}
  if(!body||typeof body!=="object"||Array.isArray(body))return fail(400,"INVALID_BODY");
  const input=body as Record<string,unknown>;
  if(Object.keys(input).sort().join(",")!=="breaks,date,locationId"||typeof input.locationId!=="string"||typeof input.date!=="string"||!DATE.test(input.date)||!validDate(input.date)||!Array.isArray(input.breaks)||input.breaks.length>12)return fail(400,"INVALID_BREAK_DETAILS");
  const breaks:Array<{start:string;end:string}>=[];
  for(const item of input.breaks){
    if(!item||typeof item!=="object"||Array.isArray(item))return fail(400,"INVALID_BREAK_INTERVAL");
    const row=item as Record<string,unknown>;
    if(Object.keys(row).sort().join(",")!=="end,start"||typeof row.start!=="string"||typeof row.end!=="string"||!CLOCK.test(row.start)||!CLOCK.test(row.end)||row.start>=row.end)return fail(400,"INVALID_BREAK_INTERVAL");
    breaks.push({start:row.start,end:row.end});
  }
  breaks.sort((a,b)=>a.start.localeCompare(b.start));
  if(breaks.some((b,i)=>i>0&&breaks[i-1].end>b.start))return fail(409,"BREAK_OVERLAP");
  const ctx=await context(input.locationId);if(ctx.error)return ctx.error;
  const {data,error}=await ctx.admin!.rpc("staff_self_breaks_replace_day_v1",{
    p_membership_id:ctx.member!.id,p_location_id:input.locationId,p_date:input.date,p_breaks:breaks
  });
  if(error){
    const message=error.message??"";
    const known=["FULL_DAY_LEAVE_CONFLICT","APPOINTMENT_CONFLICT","BREAK_OVERLAP","INVALID_BREAK_DETAILS","STAFF_SCHEDULE_NOT_FOUND","DATE_OUT_OF_RANGE"].find(code=>message.includes(code));
    console.error("[staff-self-breaks] save failed",error.code);
    return fail(known==="FULL_DAY_LEAVE_CONFLICT"||known==="APPOINTMENT_CONFLICT"||known==="BREAK_OVERLAP"?409:503,known??"BREAK_SAVE_FAILED");
  }
  return NextResponse.json({ok:true,saved:data},{headers});
}
