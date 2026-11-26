import {NextResponse} from "next/server";
import {getAuthenticatedStaffMembership} from "@/lib/staff-auth/server";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
const headers={"Cache-Control":"private, no-store"};
const fail=(status:number,code:string)=>NextResponse.json({code},{status,headers});
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
async function scope(value:unknown){
 if(typeof value!=="string"||!value.trim()||value.length>120)return null;
 const identity=await getAuthenticatedStaffMembership({organizationId:value});
 if(identity.status!=="ok"||!["OWNER","MANAGER"].includes(identity.membership.role))return null;
 const db=createBeautyOsFinanceClient();if(!db)throw new Error("CONFIG");
 const org=await db.from("organizations").select("id").eq("app_id",value).single();
 if(org.error||!org.data)throw new Error("ORG");
 return {db,org:org.data.id};
}
export async function GET(request:Request){
 try{const s=await scope(new URL(request.url).searchParams.get("organizationId"));if(!s)return fail(403,"FORBIDDEN");
 const [g,r,banner]=await Promise.all([s.db.from("member_points_gifts").select("*").eq("organization_id",s.org).order("created_at",{ascending:false}).limit(100),s.db.from("member_points_redemptions").select("id,gift_name,points_cost,status,created_at,customer_id").eq("organization_id",s.org).order("created_at",{ascending:false}).limit(100),s.db.from("member_points_banner").select("*").eq("organization_id",s.org).maybeSingle()]);
 if(g.error||r.error||banner.error)throw new Error("READ");return NextResponse.json({gifts:g.data,redemptions:r.data,banner:banner.data},{headers});
 }catch{return fail(503,"UNAVAILABLE");}
}
export async function POST(request:Request){
 if(request.headers.get("origin")!==new URL(request.url).origin)return fail(403,"INVALID_ORIGIN");
 if(!request.headers.get("content-type")?.startsWith("application/json"))return fail(415,"INVALID_CONTENT_TYPE");
 try{const b=await request.json();const s=await scope(b?.organizationId);if(!s)return fail(403,"FORBIDDEN");
 if(b.action==="carousel"){
 const prefix="https://bfzquejrtgqzzarhkiya.supabase.co/storage/v1/object/public/member-points-gift-images/"+s.org+"/";
 if(!Array.isArray(b.slides)||b.slides.length>10||typeof b.enabled!=="boolean")return fail(400,"INVALID_INPUT");
 const slides=[];
 for(const x of b.slides){
 if(!x||typeof x.image_url!=="string"||!x.image_url.startsWith(prefix)||!/^[-a-f0-9]{36}\.(jpg|png|webp)$/.test(x.image_url.slice(prefix.length))||typeof x.href!=="string"||x.href.length>2048||typeof x.enabled!=="boolean")return fail(400,"INVALID_SLIDE");
 const href=x.href.trim();
 if(href&&!/^#[a-zA-Z][\w-]*$/.test(href)&&!/^\/(?![\/\\])[^\\\s]*$/.test(href)){try{const u=new URL(href);if(u.protocol!=="https:"||u.username||u.password)return fail(400,"INVALID_LINK");}catch{return fail(400,"INVALID_LINK");}}
 slides.push({image_url:x.image_url,href,enabled:x.enabled});
 }
 const r=await s.db.from("member_points_banner").upsert({organization_id:s.org,slides,enabled:b.enabled,show_text:false});if(r.error)return fail(409,"SAVE_FAILED");return NextResponse.json({ok:true},{headers});
 }
 if(b.action==="banner"){
 if(typeof b.title!=="string"||b.title.length>120||typeof b.subtitle!=="string"||b.subtitle.length>200||typeof b.show_text!=="boolean"||typeof b.enabled!=="boolean"||typeof b.image!=="string")return fail(400,"INVALID_INPUT");
 const prefix="https://bfzquejrtgqzzarhkiya.supabase.co/storage/v1/object/public/member-points-gift-images/"+s.org+"/";
 if(b.image&&(!b.image.startsWith(prefix)||!/^[-a-f0-9]{36}\.(jpg|png|webp)$/.test(b.image.slice(prefix.length))))return fail(400,"INVALID_IMAGE");
 const r=await s.db.from("member_points_banner").upsert({organization_id:s.org,title:b.title,subtitle:b.subtitle,show_text:b.show_text,enabled:b.enabled,image_url:b.image||null});if(r.error)return fail(409,"SAVE_FAILED");return NextResponse.json({ok:true},{headers});
 }
 if(b.action==="resolve"){if(!uuid(b.id)||!["used","cancelled"].includes(b.status))return fail(400,"INVALID_INPUT");const r=await s.db.rpc("member_points_resolve_gift",{p_org:s.org,p_redemption:b.id,p_action:b.status});if(r.error)return fail(409,"RESOLVE_FAILED");return NextResponse.json({ok:true},{headers});}
 if(b.action==="publish"){if(!uuid(b.id)||typeof b.active!=="boolean")return fail(400,"INVALID_INPUT");const r=await s.db.from("member_points_gifts").update({active:b.active}).eq("organization_id",s.org).eq("id",b.id).select("id").single();if(r.error)return fail(409,"SAVE_FAILED");return NextResponse.json({ok:true},{headers});}
 if(b.action==="stock"){if(!uuid(b.id)||!Number.isSafeInteger(b.delta)||b.delta===0||Math.abs(b.delta)>1000000)return fail(400,"INVALID_INPUT");const r=await s.db.rpc("member_points_adjust_gift_stock",{p_org:s.org,p_gift:b.id,p_delta:b.delta});if(r.error)return fail(409,"STOCK_FAILED");return NextResponse.json({ok:true},{headers});}
 if(!["create","edit"].includes(b.action)||typeof b.name!=="string"||!b.name.trim()||b.name.length>120||typeof b.description!=="string"||b.description.length>2000||!Number.isSafeInteger(b.points)||b.points<1||b.points>1000000||!Number.isSafeInteger(b.stock)||b.stock<0||b.stock>1000000||typeof b.image!=="string"||b.image.length>2048||(b.image&&!b.image.startsWith("https://")))return fail(400,"INVALID_INPUT");
 if(b.action==="edit"){if(!uuid(b.id))return fail(400,"INVALID_INPUT");const r=await s.db.from("member_points_gifts").update({name:b.name.trim(),description:b.description,image_url:b.image||null,points_cost:b.points}).eq("organization_id",s.org).eq("id",b.id).select("id").single();if(r.error)return fail(409,"SAVE_FAILED");return NextResponse.json({ok:true},{headers});}
 const r=await s.db.from("member_points_gifts").insert({organization_id:s.org,name:b.name.trim(),description:b.description,image_url:b.image||null,points_cost:b.points,stock:b.stock,active:false});if(r.error)return fail(409,"SAVE_FAILED");return NextResponse.json({ok:true},{headers});
 }catch{return fail(503,"UNAVAILABLE");}
}
