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
export async function GET(req:Request){try{const s=await scope(new URL(req.url).searchParams.get("organizationId"));if(!s)return fail(403,"FORBIDDEN");const r=await s.db.from("member_pet_settings").select("pets,active_id").eq("organization_id",s.org).maybeSingle();if(r.error)throw Error("READ");return NextResponse.json(r.data??{pets:[],active_id:null},{headers});}catch{return fail(503,"UNAVAILABLE");}}
export async function POST(req:Request){if(req.headers.get("origin")!==new URL(req.url).origin)return fail(403,"ORIGIN");try{
if(req.headers.get("content-type")?.includes("multipart/form-data")){
if(Number(req.headers.get("content-length")??0)>3700000)return fail(413,"SIZE");
const f=await req.formData(),s=await scope(f.get("organizationId")),file=f.get("image");if(!s)return fail(403,"FORBIDDEN");if(!(file instanceof File)||file.size<14||file.size>3500000)return fail(400,"SIZE");
const bytes=new Uint8Array(await file.arrayBuffer());const sig=String.fromCharCode(...bytes.slice(0,6));const gif=sig==="GIF87a"||sig==="GIF89a";const png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);const rive=String.fromCharCode(...bytes.slice(0,4))==="RIVE"&&file.name.toLowerCase().endsWith(".riv");if(!gif&&!png&&!rive)return fail(400,"FORMAT");const mime=rive?"application/octet-stream":gif?"image/gif":"image/png";if(!rive&&file.type!==mime)return fail(400,"FORMAT");
const path=s.org+"/"+randomUUID()+(rive?".riv":gif?".gif":".png");const bucket=s.db.storage.from("member-pet-assets");const r=await bucket.upload(path,bytes,{contentType:mime,upsert:false,cacheControl:"31536000"});if(r.error)return fail(503,"UPLOAD");return NextResponse.json({url:bucket.getPublicUrl(path).data.publicUrl},{headers});}
const b=await req.json(),s=await scope(b.organizationId);if(!s)return fail(403,"FORBIDDEN");
const prefix="https://bfzquejrtgqzzarhkiya.supabase.co/storage/v1/object/public/member-pet-assets/"+s.org+"/";
const valid=(v:unknown)=>typeof v==="string"&&v.startsWith(prefix)&&/^[-a-f0-9]{36}\.(gif|png)$/.test(v.slice(prefix.length));
const validRive=(v:unknown)=>typeof v==="string"&&v.startsWith(prefix)&&/^[-a-f0-9]{36}\.riv$/.test(v.slice(prefix.length));
if(!Array.isArray(b.pets)||b.pets.length>30)return fail(400,"INVALID");
const ids=new Set<string>();const pets=[];for(const p of b.pets){if(!p||typeof p.id!=="string"||!/^[-a-f0-9]{36}$/.test(p.id)||ids.has(p.id)||typeof p.name!=="string"||!p.name.trim()||p.name.length>80||!valid(p.idle)||!Number.isInteger(p.size)||p.size<15||p.size>65||!Number.isInteger(p.bottom)||p.bottom<0||p.bottom>35||typeof p.autoWalk!=="boolean")return fail(400,"INVALID");if(p.format!==undefined&&p.format!=="gif"&&p.format!=="rive")return fail(400,"FORMAT");if((p.rive&&!validRive(p.rive))||(p.format==="rive"&&!validRive(p.rive)))return fail(400,"INVALID_RIVE");ids.add(p.id);const row={id:p.id,format:p.format??"gif",rive:p.rive||"",name:p.name.trim(),idle:p.idle,size:p.size,bottom:p.bottom,autoWalk:p.autoWalk,walk:"",hello:"",jump:"",rest:"",background:""};for(const k of ["walk","hello","jump","rest","background"] as const){if(p[k]&&!valid(p[k]))return fail(400,"INVALID_ASSET");row[k]=p[k]||"";}pets.push(row);}
if(b.active_id!==null&&!ids.has(b.active_id))return fail(400,"INVALID_ACTIVE");
const r=await s.db.from("member_pet_settings").upsert({organization_id:s.org,pets,active_id:b.active_id,updated_at:new Date().toISOString()});if(r.error)return fail(503,"SAVE");return NextResponse.json({ok:true},{headers});
}catch{return fail(503,"UNAVAILABLE");}}
