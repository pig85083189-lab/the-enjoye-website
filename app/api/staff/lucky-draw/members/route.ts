import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
export async function GET(request:Request){
 const headers={"Cache-Control":"private, no-store"};
 const fail=(status:number)=>NextResponse.json({error:"無法查詢會員"},{status,headers});
 const p=new URL(request.url).searchParams;
 const organizationId=p.get("organizationId")?.trim();
 const q=p.get("q")?.trim();
 if(!organizationId||organizationId.length>120||!q||q.length<2||q.length>80||/[%_\\]/.test(q))return fail(400);
 const identity=await getAuthenticatedStaffMembership({organizationId});
 if(identity.status!=="ok"||!["OWNER","MANAGER"].includes(identity.membership.role))return fail(403);
 const db=createBeautyOsFinanceClient();if(!db)return fail(503);
 const org=await db.from("organizations").select("id").eq("app_id",organizationId).single();
 if(org.error||!org.data)return fail(503);
 const rows=await db.from("customers").select("app_id,full_name,phone").eq("organization_id",org.data.id).eq("status","ACTIVE").not("app_id","is",null).ilike(/^\+?\d+$/.test(q)?"phone":"full_name","%"+q+"%").limit(20);
 if(rows.error)return fail(503);
 return NextResponse.json({members:(rows.data??[]).map(r=>({id:r.app_id,name:r.full_name,phoneSuffix:String(r.phone??"").slice(-4)}))},{headers});
}
