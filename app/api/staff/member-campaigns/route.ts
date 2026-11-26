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
export async function GET(req:Request){try{const s=await scope(new URL(req.url).searchParams.get("organizationId"));if(!s)return fail(403,"FORBIDDEN");const r=await s.db.from("member_campaign_popups").select("*").eq("organization_id",s.org).order("priority",{ascending:false}).order("created_at",{ascending:false});if(r.error)throw Error("READ");return NextResponse.json({campaigns:r.data},{headers});}catch{return fail(503,"UNAVAILABLE");}}
export async function POST(req:Request){
 if(req.headers.get("origin")!==new URL(req.url).origin)return fail(403,"ORIGIN");
 try{const b=await req.json();const s=await scope(b.organizationId);if(!s)return fail(403,"FORBIDDEN");
 const prefix="https://bfzquejrtgqzzarhkiya.supabase.co/storage/v1/object/public/member-points-gift-images/"+s.org+"/";
 if(typeof b.title!=="string"||!b.title.trim()||b.title.length>120||typeof b.image_url!=="string"||!b.image_url.startsWith(prefix)||!/^[-a-f0-9]{36}\.(jpg|png|webp)$/.test(b.image_url.slice(prefix.length))||typeof b.button_label!=="string"||b.button_label.length>40||typeof b.href!=="string"||b.href.length>2048||typeof b.enabled!=="boolean"||typeof b.allow_dismiss!=="boolean"||!["daily","session","once"].includes(b.frequency)||!Number.isSafeInteger(b.priority)||Math.abs(b.priority)>1000||!Number.isFinite(Date.parse(b.starts_at))||!Number.isFinite(Date.parse(b.ends_at))||Date.parse(b.ends_at)<=Date.parse(b.starts_at))return fail(400,"INVALID_INPUT");
 if(b.href&&!/^\/member(?:\/[^\\\s]*)?$/.test(b.href)){try{const u=new URL(b.href);if(u.protocol!=="https:"||u.username||u.password)return fail(400,"INVALID_LINK");}catch{return fail(400,"INVALID_LINK");}}
 const row={organization_id:s.org,title:b.title.trim(),image_url:b.image_url,button_label:b.button_label,href:b.href,enabled:b.enabled,allow_dismiss:b.allow_dismiss,frequency:b.frequency,priority:b.priority,starts_at:b.starts_at,ends_at:b.ends_at};
 const r=b.id?await s.db.from("member_campaign_popups").update(row).eq("organization_id",s.org).eq("id",b.id).select("id").single():await s.db.from("member_campaign_popups").insert(row).select("id").single();
 if(r.error)return fail(409,"SAVE_FAILED");return NextResponse.json({ok:true,id:r.data.id},{headers});
 }catch{return fail(503,"UNAVAILABLE");}
}
