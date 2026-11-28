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
export async function GET(req:Request){try{const s=await scope(new URL(req.url).searchParams.get("organizationId"));if(!s)return fail(403,"FORBIDDEN");const r=await s.db.from("member_daily_card_settings").select("cards,updated_at").eq("organization_id",s.org).maybeSingle();if(r.error)return fail(503,"READ");return NextResponse.json({cards:r.data?.cards??[],updatedAt:r.data?.updated_at??null},{headers})}catch{return fail(503,"UNAVAILABLE")}}
export async function POST(req:Request){if(req.headers.get("origin")!==new URL(req.url).origin)return fail(403,"ORIGIN");try{if(req.headers.get("content-type")?.includes("multipart/form-data")){
if(Number(req.headers.get("content-length")??0)>3700000)return fail(413,"SIZE");
const f=await req.formData(),s=await scope(f.get("organizationId")),video=f.has("video"),file=f.get(video?"video":"image");if(!s)return fail(403,"FORBIDDEN");if(!(file instanceof File)||file.size<14||file.size>3500000)return fail(400,"SIZE");
const b=new Uint8Array(await file.arrayBuffer()),str=(a:number,z:number)=>String.fromCharCode(...b.slice(a,z));
const ext=b[0]===255&&b[1]===216&&b[2]===255?"jpg":[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)?"png":str(0,6)==="GIF87a"||str(0,6)==="GIF89a"?"gif":str(0,4)==="RIFF"&&str(8,12)==="WEBP"?"webp":str(4,8)==="ftyp"?"mp4":"";
const mime=ext==="jpg"?"image/jpeg":ext==="mp4"?"video/mp4":"image/"+ext;if(!ext||(video?ext!=="mp4":ext==="mp4")||file.type!==mime)return fail(400,"FORMAT");
const path=s.org+"/"+randomUUID()+"."+ext,bucket=s.db.storage.from("member-home-assets");const r=await bucket.upload(path,b,{contentType:mime,upsert:false,cacheControl:"31536000"});if(r.error)return fail(503,"UPLOAD");return NextResponse.json({url:bucket.getPublicUrl(path).data.publicUrl},{headers})}
const raw=await req.text();if(raw.length>1500000)return fail(413,"SIZE");const b=JSON.parse(raw),s=await scope(b.organizationId);if(!s)return fail(403,"FORBIDDEN");if(!Array.isArray(b.cards)||b.cards.length>500)return fail(400,"CARDS");const ids=new Set<string>();const cards=[];for(const p of b.cards){if(!p||typeof p.id!=="string"||!/^[a-zA-Z0-9_-]{1,80}$/.test(p.id)||ids.has(p.id)||typeof p.enabled!=="boolean")return fail(400,"CARD");for(const k of ["name","symbol","meaning","detail"]){if(typeof p[k]!=="string"||!p[k].trim()||p[k].length>(k==="detail"?2000:100))return fail(400,"TEXT")}const prefix="https://bfzquejrtgqzzarhkiya.supabase.co/storage/v1/object/public/member-home-assets/"+s.org+"/";for(const k of ["front","back"]){if(p[k]!==undefined&&(typeof p[k]!=="string"||(p[k]&&(!p[k].startsWith(prefix)||!/^[-a-f0-9]{36}\.(jpg|png|webp|gif)$/.test(p[k].slice(prefix.length))))))return fail(400,"IMAGE")}if(p.video!==undefined&&(typeof p.video!=="string"||(p.video&&(!p.video.startsWith(prefix)||!/^[-a-f0-9]{36}\.mp4$/.test(p.video.slice(prefix.length))))))return fail(400,"VIDEO");ids.add(p.id);cards.push({id:p.id,enabled:p.enabled,name:p.name,symbol:p.symbol,meaning:p.meaning,detail:p.detail,front:p.front??"",back:p.back??"",video:p.video??""})}const updatedAt=new Date().toISOString();const r=await s.db.from("member_daily_card_settings").upsert({organization_id:s.org,cards,updated_at:updatedAt});if(r.error)return fail(503,"SAVE");return NextResponse.json({ok:true,updatedAt},{headers})}catch{return fail(503,"UNAVAILABLE")}}
