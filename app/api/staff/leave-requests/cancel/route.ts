import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
 const auth=await getAuthenticatedStaffMembership();
 if(auth.status!=="ok") return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
 let body:Record<string,unknown>;
 try { const value:unknown=await request.json(); if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error(); body=value as Record<string,unknown>; }
 catch {return NextResponse.json({error:"INVALID_BODY"},{status:400});}
 const {locationId,date}=body;
 if(typeof locationId!=="string"||!auth.membership.locationIds.includes(locationId)) return NextResponse.json({error:"LOCATION_NOT_AUTHORIZED"},{status:403});
 if(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({error:"INVALID_DATE"},{status:400});
 const admin=createServiceRoleClient();
 if(!admin) return NextResponse.json({error:"DATABASE_UNAVAILABLE"},{status:503});
 const {data,error}=await admin.rpc("staff_self_leave_set_v1",{p_membership_id:auth.membership.id,p_location_id:locationId,p_date:date,p_cancel:true,p_reason:""});
 if(error) return NextResponse.json({error:/NOT_SELF_MANAGED/.test(error.message)?"NOT_SELF_MANAGED_LEAVE":"CANCEL_FAILED"},{status:/NOT_SELF_MANAGED/.test(error.message)?409:503});
 return NextResponse.json({result:data},{headers:{"Cache-Control":"no-store"}});
}
