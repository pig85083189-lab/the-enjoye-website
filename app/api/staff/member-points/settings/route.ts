import {NextResponse} from "next/server";
import {getAuthenticatedStaffMembership} from "@/lib/staff-auth/server";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
import {readPointsSettings,savePointsSettings} from "@/lib/member-points/settings";
const headers={"Cache-Control":"private, no-store"};
const fail=(status:number,code:string)=>NextResponse.json({code},{status,headers});
async function scope(value:unknown){
 if(typeof value!=="string"||!value.trim()||value.length>120)return null;
 const identity=await getAuthenticatedStaffMembership({organizationId:value});
 if(identity.status!=="ok"||!["OWNER","MANAGER"].includes(identity.membership.role))return null;
 const db=createBeautyOsFinanceClient();
 if(!db)throw new Error("CONFIG");
 const org=await db.from("organizations").select("id").eq("app_id",value).single();
 if(org.error||!org.data)throw new Error("ORG");
 return org.data.id;
}
export async function GET(request:Request){
 try{
 const org=await scope(new URL(request.url).searchParams.get("organizationId"));
 if(!org)return fail(403,"FORBIDDEN");
 return NextResponse.json(await readPointsSettings(org),{headers});
 }catch{return fail(503,"POINTS_SETTINGS_UNAVAILABLE");}
}
export async function POST(request:Request){
 if(request.headers.get("origin")!==new URL(request.url).origin)return fail(403,"INVALID_ORIGIN");
 if(!request.headers.get("content-type")?.startsWith("application/json"))return fail(415,"INVALID_CONTENT_TYPE");
 let body;
 try{body=await request.json();}catch{return fail(400,"INVALID_INPUT");}
 if(!body||typeof body.enabled!=="boolean"||!Number.isSafeInteger(body.spendPerPoint)||body.spendPerPoint<1||body.spendPerPoint>1000000)return fail(400,"INVALID_INPUT");
 try{
 const org=await scope(body.organizationId);
 if(!org)return fail(403,"FORBIDDEN");
 return NextResponse.json(await savePointsSettings(org,{enabled:body.enabled,spendPerPoint:body.spendPerPoint}),{headers});
 }catch{return fail(503,"POINTS_SETTINGS_UNAVAILABLE");}
}
