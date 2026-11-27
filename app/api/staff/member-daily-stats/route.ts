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

export async function GET(req:Request){try{const s=await scope(new URL(req.url).searchParams.get("organizationId"));if(!s)return fail(403,"FORBIDDEN");const day=new Date(Date.now()+28800000).toISOString().slice(0,10);const month=day.slice(0,7)+"-01";const [a,b,c,d]=await Promise.all([s.db.from("member_daily_readings").select("*",{count:"exact",head:true}).eq("organization_id",s.org).eq("reading_date",day).not("completed_at","is",null),s.db.from("member_daily_checkins").select("*",{count:"exact",head:true}).eq("organization_id",s.org).eq("checkin_date",day),s.db.from("member_daily_readings").select("*",{count:"exact",head:true}).eq("organization_id",s.org).gte("reading_date",month).lte("reading_date",day).not("completed_at","is",null),s.db.from("member_daily_checkins").select("*",{count:"exact",head:true}).eq("organization_id",s.org).gte("checkin_date",month).lte("checkin_date",day)]);if([a,b,c,d].some(x=>x.error||x.count===null))return fail(503,"READ");return NextResponse.json({day,readingsToday:a.count,checkinsToday:b.count,readingsMonth:c.count,checkinsMonth:d.count},{headers})}catch{return fail(503,"UNAVAILABLE")}}
