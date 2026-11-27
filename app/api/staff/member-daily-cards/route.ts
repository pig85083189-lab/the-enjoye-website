import {NextResponse} from "next/server";
import {getAuthenticatedStaffMembership} from "@/lib/staff-auth/server";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
const headers={"Cache-Control":"private, no-store"};
const fail=(status:number,code:string)=>NextResponse.json({code},{status,headers});
async function scope(org:unknown){
 if(typeof org!=="string"||!org||org.length>120)return null;
 const auth=await getAuthenticatedStaffMembership({organizationId:org});
 if(auth.status!=="ok"||!["OWNER","MANAGER"].includes(auth.membership.role))return null;
 const db=createBeautyOsFinanceClient();if(!db)throw Error("CONFIG");
 const r=await db.from("organizations").select("id").eq("app_id",org).single();if(r.error||!r.data)throw Error("ORG");
 return {db,org:r.data.id};
}

export async function GET(req:Request){try{const s=await scope(new URL(req.url).searchParams.get("organizationId"));if(!s)return fail(403,"FORBIDDEN");const r=await s.db.from("member_daily_card_settings").select("cards").eq("organization_id",s.org).maybeSingle();if(r.error)return fail(503,"READ");return NextResponse.json({cards:r.data?.cards??[]},{headers})}catch{return fail(503,"UNAVAILABLE")}}
export async function POST(req:Request){if(req.headers.get("origin")!==new URL(req.url).origin)return fail(403,"ORIGIN");try{const raw=await req.text();if(raw.length>1500000)return fail(413,"SIZE");const b=JSON.parse(raw),s=await scope(b.organizationId);if(!s)return fail(403,"FORBIDDEN");if(!Array.isArray(b.cards)||b.cards.length>500)return fail(400,"CARDS");const ids=new Set<string>();const cards=[];for(const p of b.cards){if(!p||typeof p.id!=="string"||!/^[a-zA-Z0-9_-]{1,80}$/.test(p.id)||ids.has(p.id)||typeof p.enabled!=="boolean")return fail(400,"CARD");for(const k of ["name","symbol","meaning","detail"]){if(typeof p[k]!=="string"||!p[k].trim()||p[k].length>(k==="detail"?2000:100))return fail(400,"TEXT")}ids.add(p.id);cards.push({id:p.id,enabled:p.enabled,name:p.name,symbol:p.symbol,meaning:p.meaning,detail:p.detail})}const r=await s.db.from("member_daily_card_settings").upsert({organization_id:s.org,cards,updated_at:new Date().toISOString()});if(r.error)return fail(503,"SAVE");return NextResponse.json({ok:true},{headers})}catch{return fail(503,"UNAVAILABLE")}}
