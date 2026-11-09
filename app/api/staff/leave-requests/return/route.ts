import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
 const auth = await getAuthenticatedStaffMembership();
 if (auth.status !== "ok") return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
 const member = auth.membership;
 if (!["OWNER","MANAGER"].includes(member.role)) return NextResponse.json({error:"FORBIDDEN"},{status:403});
 let body: unknown;
 try { body = await request.json(); } catch { return NextResponse.json({error:"INVALID_BODY"},{status:400}); }
 if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({error:"INVALID_BODY"},{status:400});
 const {locationId,requestIds,note} = body as Record<string,unknown>;
 if (typeof locationId !== "string" || !member.locationIds.includes(locationId))
  return NextResponse.json({error:"LOCATION_NOT_AUTHORIZED"},{status:403});
 if (!Array.isArray(requestIds) || requestIds.length < 1 || requestIds.length > 100 ||
  requestIds.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) ||
  new Set(requestIds).size !== requestIds.length ||
  typeof note !== "string" || note.trim().length < 2 || note.length > 500)
  return NextResponse.json({error:"INVALID_REVIEW_DETAILS"},{status:400});
 const admin = createServiceRoleClient();
 if (!admin) return NextResponse.json({error:"DATABASE_UNAVAILABLE"},{status:503});
 const {data,error} = await admin.rpc("return_staff_leave_requests_for_reschedule",{
  p_organization_id:member.organizationId,p_location_id:locationId,
  p_reviewer_id:member.id,p_request_ids:requestIds,p_note:note.trim(),
 });
 if (error) {
  console.error("Return leave requests failed",error.code);
  return NextResponse.json({error:"RETURN_FAILED_OR_REQUESTS_CHANGED"},{status:409});
 }
 return NextResponse.json({returned:data},{headers:{"Cache-Control":"no-store"}});
}
