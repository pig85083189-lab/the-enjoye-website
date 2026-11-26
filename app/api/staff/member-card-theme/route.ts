import {NextResponse} from "next/server";
import {getAuthenticatedStaffMembership} from "@/lib/staff-auth/server";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
async function scope(org:unknown){
 if(typeof org!=="string"||!org||org.length>120)return null;
 const auth=await getAuthenticatedStaffMembership({organizationId:org});
 if(auth.status!=="ok"||!["OWNER","MANAGER"].includes(auth.membership.role))return null;
 const db=createBeautyOsFinanceClient();if(!db)throw Error("CONFIG");
 const r=await db.from("organizations").select("id").eq("app_id",org).single();if(r.error||!r.data)throw Error("ORG");return {db,id:r.data.id};
}
export async function GET(req:Request){try{const s=await scope(new URL(req.url).searchParams.get("organizationId"));if(!s)return reply({code:"FORBIDDEN"},403);const r=await s.db.from("member_card_theme").select("theme").eq("organization_id",s.id).maybeSingle();if(r.error)throw Error("READ");return reply({theme:r.data?.theme??"gold"});}catch{return reply({code:"UNAVAILABLE"},503);}}
export async function POST(req:Request){if(req.headers.get("origin")!==new URL(req.url).origin)return reply({code:"ORIGIN"},403);try{const b=await req.json();const s=await scope(b.organizationId);if(!s)return reply({code:"FORBIDDEN"},403);if(!["gold","rose","cocoa"].includes(b.theme))return reply({code:"INVALID_THEME"},400);const r=await s.db.from("member_card_theme").upsert({organization_id:s.id,theme:b.theme},{onConflict:"organization_id"}).select("theme").single();if(r.error)throw Error("SAVE");return reply({theme:r.data.theme});}catch{return reply({code:"UNAVAILABLE"},503);}}
