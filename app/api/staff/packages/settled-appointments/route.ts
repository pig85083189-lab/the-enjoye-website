import {NextResponse} from "next/server";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
import {getAuthenticatedStaffMembership} from "@/lib/staff-auth/server";
import {canCheckout} from "@/lib/staff-auth/operational-capabilities";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(request:Request){
 const organizationId=new URL(request.url).searchParams.get("organizationId");
 const fail=(status:number)=>NextResponse.json({error:"無法確認套票結帳狀態"},{status,headers});
 if(!organizationId||organizationId.length>128)return fail(400);
 const auth=await getAuthenticatedStaffMembership({organizationId});
 if(auth.status!=="ok"||!canCheckout(auth.membership))return fail(403);
 const db=createBeautyOsFinanceClient();if(!db)return fail(503);
 const org=await db.from("organizations").select("id").eq("app_id",organizationId).maybeSingle();
 if(org.error||!org.data)return fail(503);
 const links=await db.from("package_redemption_booking_links").select("booking_appointment_app_id,transaction_id").eq("organization_id",org.data.id).limit(1000);
 if(links.error||!links.data||links.data.length===1000)return fail(503);
 const completed=[];
 for(let i=0;i<links.data.length;i+=100){
 const batch=links.data.slice(i,i+100);
 const tx=await db.from("transactions").select("id,app_id").eq("organization_id",org.data.id).eq("status","COMPLETED").in("id",batch.map(x=>x.transaction_id));
 if(tx.error)return fail(503);
 for(const link of batch){const row=tx.data?.find(x=>x.id===link.transaction_id);if(row)completed.push({appointmentId:link.booking_appointment_app_id,id:row.app_id??row.id});}
 }
 return NextResponse.json({completed},{headers});
}
