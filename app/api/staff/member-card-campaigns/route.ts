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
export async function GET(req:Request){try{const s=await scope(new URL(req.url).searchParams.get("organizationId"));if(!s)return reply({code:"FORBIDDEN"},403);const r=await s.db.from("member_card_campaigns").select("*").eq("organization_id",s.id).order("priority",{ascending:false}).order("created_at",{ascending:false});if(r.error)throw Error("READ");return reply({cards:r.data});}catch{return reply({code:"UNAVAILABLE"},503);}}
const color=(v:unknown)=>typeof v==="string"&&/^#[0-9a-fA-F]{6}$/.test(v);
const date=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export async function POST(req:Request){if(req.headers.get("origin")!==new URL(req.url).origin)return reply({code:"ORIGIN"},403);try{const b=await req.json();const s=await scope(b.organizationId);if(!s)return reply({code:"FORBIDDEN"},403);
if(b.action==="delete"){const r=await s.db.from("member_card_campaigns").delete().eq("organization_id",s.id).eq("id",b.id).select("id").single();return r.error?reply({code:"DELETE_FAILED"},409):reply({ok:true});}
const prefix="https://bfzquejrtgqzzarhkiya.supabase.co/storage/v1/object/public/member-points-gift-images/"+s.id+"/";
if(typeof b.title!=="string"||!b.title.trim()||b.title.length>100||typeof b.subtitle!=="string"||b.subtitle.length>80||!color(b.background)||!color(b.foreground)||typeof b.enabled!=="boolean"||!Number.isInteger(b.priority)||Math.abs(b.priority)>1000||typeof b.image_url!=="string"||(b.image_url!==""&&(!b.image_url.startsWith(prefix)||!/^[-a-f0-9]{36}\.(jpg|png|webp)$/.test(b.image_url.slice(prefix.length))))||!((b.starts_on===null&&b.ends_on===null)||(date(b.starts_on)&&date(b.ends_on)&&b.starts_on<=b.ends_on)))return reply({code:"INVALID_INPUT"},400);
const row={organization_id:s.id,title:b.title.trim(),subtitle:b.subtitle,background:b.background,foreground:b.foreground,image_url:b.image_url,enabled:b.enabled,priority:b.priority,starts_on:b.starts_on,ends_on:b.ends_on};
const r=b.id?await s.db.from("member_card_campaigns").update(row).eq("organization_id",s.id).eq("id",b.id).select("id").single():await s.db.from("member_card_campaigns").insert(row).select("id").single();return r.error?reply({code:"SAVE_FAILED"},409):reply({ok:true,id:r.data.id});}catch{return reply({code:"UNAVAILABLE"},503);}}
