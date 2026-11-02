import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BLOCKING_STATUSES = ["BOOKED", "CONFIRMED", "ARRIVED", "IN_SERVICE", "DRAFT"];
const fail = (error: string, status: number) =>
  NextResponse.json({ error, approvalEnabled: false }, { status, headers: { "Cache-Control": "no-store" } });

/** Manager-only diagnostic for booking_staff_time_off. Does not approve leave. */
export async function GET(request: Request) {
  const auth = await getAuthenticatedStaffMembership();
  if (auth.status !== "ok") return fail("UNAUTHORIZED", 401);
  const member = auth.membership;
  if (!["OWNER", "MANAGER"].includes(member.role)) return fail("MANAGER_REQUIRED", 403);
  const params = new URL(request.url).searchParams;
  const locationId = params.get("locationId");
  const id = params.get("id");
  if (!locationId || !member.locationIds.includes(locationId)) return fail("LOCATION_NOT_AUTHORIZED", 403);
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return fail("INVALID_LEAVE_ID", 400);
  const admin = createServiceRoleClient();
  if (!admin) return fail("DATABASE_UNAVAILABLE", 503);

  const { data: leave, error: leaveError } = await admin.from("booking_staff_time_off")
    .select("id,staff_id,start_at,end_at,status")
    .eq("id", id).eq("organization_id", member.organizationId)
    .eq("location_id", locationId).maybeSingle();
  if (leaveError || !leave) return fail("LEAVE_NOT_FOUND_OR_UNAVAILABLE", 503);
  if (leave.status !== "REQUESTED") return fail("LEAVE_NOT_PENDING", 409);

  const { data: staff, error: staffError } = await admin.from("staff_auth_memberships")
    .select("user_id").eq("organization_id", member.organizationId)
    .eq("user_id", leave.staff_id).eq("is_active", true).limit(2);
  if (staffError || staff?.length !== 1) return fail("STAFF_IDENTITY_UNVERIFIED", 503);

  const { data: orgs, error: orgError } = await admin.from("organizations")
    .select("id").eq("app_id", member.organizationId).limit(2);
  const { data: locations, error: locationError } = await admin.from("locations")
    .select("id,organization_id").eq("app_id", locationId).limit(2);
  if (orgError || locationError || orgs?.length !== 1 || locations?.length !== 1 ||
      locations[0].organization_id !== orgs[0].id) return fail("TENANT_MAPPING_UNVERIFIED", 503);

  const { data: appointments, error: appointmentError } = await admin.from("appointments")
    .select("id,status,starts_at,ends_at")
    .eq("organization_id", orgs[0].id).eq("location_id", locations[0].id)
    .eq("staff_id", leave.staff_id).in("status", BLOCKING_STATUSES)
    .lt("starts_at", leave.end_at).gt("ends_at", leave.start_at).limit(501);
  if (appointmentError || !appointments || appointments.length >= 501) return fail("APPOINTMENT_CHECK_UNAVAILABLE", 503);
  return NextResponse.json({
    status: appointments.length ? "conflict" : "no_conflicts_found",
    blockingCount: appointments.length,
    approvalEnabled: false,
    message: appointments.length
      ? "既有預約與休假時間重疊，不可核准。"
      : "目前未查到衝突；尚未實作原子預約鎖，仍不可核准。",
  }, { headers: { "Cache-Control": "no-store" } });
}
