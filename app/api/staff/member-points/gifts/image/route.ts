import {NextResponse} from "next/server";
import {randomUUID} from "node:crypto";
import {getAuthenticatedStaffMembership} from "@/lib/staff-auth/server";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
export async function POST(request:Request){
 const fail=(status:number)=>NextResponse.json({ok:false},{status,headers:{"Cache-Control":"no-store"}});
 if(request.headers.get("origin")!==new URL(request.url).origin)return fail(403);
 if(Number(request.headers.get("content-length")??0)>1700000)return fail(413);
 try{
 const form=await request.formData(),org=form.get("organizationId"),file=form.get("image");
 if(typeof org!=="string"||org.length>120||!(file instanceof File)||file.size<12||file.size>1500000)return fail(400);
 const identity=await getAuthenticatedStaffMembership({organizationId:org});
 if(identity.status!=="ok"||!["OWNER","MANAGER"].includes(identity.membership.role))return fail(403);
 const db=createBeautyOsFinanceClient();if(!db)return fail(503);
 const scope=await db.from("organizations").select("id").eq("app_id",org).single();if(scope.error||!scope.data)return fail(403);
 const bytes=new Uint8Array(await file.arrayBuffer());
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 const webp=String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP";
 const ext=jpeg?"jpg":png?"png":webp?"webp":null;if(!ext)return fail(400);
 const mime=jpeg?"image/jpeg":png?"image/png":"image/webp";
 if(file.type!==mime)return fail(400);
 const path=scope.data.id+"/"+randomUUID()+"."+ext;
 const bucket=db.storage.from("member-points-gift-images");
 const upload=await bucket.upload(path,bytes,{contentType:mime,upsert:false});if(upload.error)return fail(503);
 return NextResponse.json({url:bucket.getPublicUrl(path).data.publicUrl},{headers:{"Cache-Control":"no-store"}});
 }catch{return fail(503);}
}
