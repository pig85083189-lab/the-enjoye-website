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

import {randomUUID} from "node:crypto";
export async function GET(req:Request){try{const s=await scope(new URL(req.url).searchParams.get("organizationId"));if(!s)return fail(403,"FORBIDDEN");const r=await s.db.from("member_home_theme").select("config").eq("organization_id",s.org).maybeSingle();if(r.error)throw Error("READ");return NextResponse.json(r.data?.config??{},{headers})}catch{return fail(503,"UNAVAILABLE")}}
export async function POST(req:Request){if(req.headers.get("origin")!==new URL(req.url).origin)return fail(403,"ORIGIN");try{
if(req.headers.get("content-type")?.includes("multipart/form-data")){
if(Number(req.headers.get("content-length")??0)>3700000)return fail(413,"SIZE");
const f=await req.formData(),s=await scope(f.get("organizationId")),file=f.get("image");if(!s)return fail(403,"FORBIDDEN");if(!(file instanceof File)||file.size<14||file.size>3500000)return fail(400,"SIZE");
const b=new Uint8Array(await file.arrayBuffer()),str=(a:number,z:number)=>String.fromCharCode(...b.slice(a,z));
const ext=b[0]===255&&b[1]===216&&b[2]===255?"jpg":[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)?"png":str(0,6)==="GIF87a"||str(0,6)==="GIF89a"?"gif":str(0,4)==="RIFF"&&str(8,12)==="WEBP"?"webp":str(4,8)==="ftyp"?"mp4":"";
const mime=ext==="jpg"?"image/jpeg":ext==="mp4"?"video/mp4":"image/"+ext;if(!ext||file.type!==mime)return fail(400,"FORMAT");
const path=s.org+"/"+randomUUID()+"."+ext,bucket=s.db.storage.from("member-home-assets");const r=await bucket.upload(path,b,{contentType:mime,upsert:false,cacheControl:"31536000"});if(r.error)return fail(503,"UPLOAD");return NextResponse.json({url:bucket.getPublicUrl(path).data.publicUrl},{headers})}
const b=await req.json(),s=await scope(b.organizationId);if(!s)return fail(403,"FORBIDDEN");const p=b.config;if(!p||typeof p.enabled!=="boolean"||typeof p.name!=="string"||p.name.length>80||!["none","snow","red","gold","flower","heart","birthday","star"].includes(p.effect)||!Number.isInteger(p.opacity)||p.opacity<10||p.opacity>100||![1,2,3].includes(p.speed))return fail(400,"INVALID");
const prefix="https://bfzquejrtgqzzarhkiya.supabase.co/storage/v1/object/public/member-home-assets/"+s.org+"/";
if(typeof p.asset!=="string"||(p.asset&&(!p.asset.startsWith(prefix)||!/^[-a-f0-9]{36}\.(jpg|png|webp|gif|mp4)$/.test(p.asset.slice(prefix.length)))))return fail(400,"ASSET");
const date=(v:unknown)=>v===""||(typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+"+08:00")));if(!date(p.start)||!date(p.end)||(p.start&&p.end&&p.start>=p.end))return fail(400,"DATE");
const config={enabled:p.enabled,name:p.name,asset:p.asset,effect:p.effect,opacity:p.opacity,speed:p.speed,start:p.start,end:p.end};
const r=await s.db.from("member_home_theme").upsert({organization_id:s.org,config,updated_at:new Date().toISOString()});if(r.error)return fail(503,"SAVE");return NextResponse.json({ok:true},{headers});
}catch{return fail(503,"UNAVAILABLE")}}
