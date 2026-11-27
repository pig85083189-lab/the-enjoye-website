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

export async function GET(req:Request){try{const s=await scope(new URL(req.url).searchParams.get("organizationId"));if(!s)return fail(403,"FORBIDDEN");const r=await s.db.from("member_daily_task_rules").select("rules").eq("organization_id",s.org).maybeSingle();if(r.error)return fail(503,"READ");return NextResponse.json({rules:r.data?.rules??[]},{headers})}catch{return fail(503,"UNAVAILABLE")}}
export async function POST(req:Request){if(req.headers.get("origin")!==new URL(req.url).origin)return fail(403,"ORIGIN");try{const raw=await req.text();if(raw.length>100000)return fail(413,"SIZE");const b=JSON.parse(raw),s=await scope(b.organizationId);if(!s)return fail(403,"FORBIDDEN");if(!Array.isArray(b.rules)||b.rules.length>100)return fail(400,"RULES");const ids=new Set<string>(),rules=[];for(const p of b.rules){if(!p||typeof p.id!=="string"||!/^[a-zA-Z0-9_-]{1,80}$/.test(p.id)||ids.has(p.id)||typeof p.name!=="string"||!p.name.trim()||p.name.length>100||!["reading","checkin","streak","spa","monthly","birthday"].includes(p.kind)||!Number.isInteger(p.target)||p.target<1||p.target>366||!["points","voucher","draw"].includes(p.reward)||!Number.isInteger(p.amount)||p.amount<0||p.amount>100000)return fail(400,"RULE");ids.add(p.id);rules.push({id:p.id,name:p.name,kind:p.kind,target:p.target,reward:p.reward,amount:p.amount,enabled:false})}const r=await s.db.from("member_daily_task_rules").upsert({organization_id:s.org,rules,updated_at:new Date().toISOString()});if(r.error)return fail(503,"SAVE");return NextResponse.json({ok:true},{headers})}catch{return fail(503,"UNAVAILABLE")}}
