import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BLOCKING_STATUSES = ["BOOKED", "CONFIRMED", "ARRIVED", "IN_SERVICE", "DRAFT"];

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const resolved = await getAuthenticatedStaffMembership();
  if (resolved.status !== "ok") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const membership = resolved.membership;
  if (!["OWNER", "MANAGER"].includes(membership.role)) {
    return NextResponse.json({ error: "MANAGER_REQUIRED" }, { status: 403 });
  }
  const locationId = new URL(request.url).searchParams.get("locationId");
  if (!locationId || !membership.locationIds.includes(locationId)) {
    return NextResponse.json({ error: "LOCATION_NOT_AUTHORIZED" }, { status: 403 });
  }
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "INVALID_REQUEST_ID" }, { status: 400 });
  }
  const admin = createServiceRoleClient();
  if (!admin) return NextResponse.json({ error: "DATABASE_UNAVAILABLE" }, { status: 503 });
  const { data: leave, error: leaveError } = await admin.from("staff_leave_requests")
    .select("id,staff_membership_id,starts_at,ends_at,status")
    .eq("id", id).eq("organization_id", membership.organizationId)
    .eq("location_id", locationId).maybeSingle();
  if (leaveError || !leave) return NextResponse.json({ error: "LEAVE_NOT_READY_OR_NOT_FOUND" }, { status: 503 });
  if (leave.status !== "pending") return NextResponse.json({ error: "LEAVE_NOT_PENDING" }, { status: 409 });

  const { data: staff, error: staffError } = await admin.from("staff_auth_memberships")
    .select("user_id,organization_id").eq("id", leave.staff_membership_id).maybeSingle();
  if (staffError || !staff || staff.organization_id !== membership.organizationId || typeof staff.user_id !== "string" || !staff.user_id.trim()) {
    return NextResponse.json({ error: "STAFF_IDENTITY_UNVERIFIED" }, { status: 503 });
  }
  const { data: org, error: orgError } = await admin.from("organizations")
    .select("id").eq("app_id", membership.organizationId).limit(2);
  const { data: locations, error: locationError } = await admin.from("locations")
    .select("id,organization_id").eq("app_id", locationId).limit(2);
  if (orgError || locationError || org?.length !== 1 || locations?.length !== 1 || locations[0].organization_id !== org[0].id) {
    return NextResponse.json({ error: "TENANT_MAPPING_UNVERIFIED" }, { status: 503 });
  }
  const { data: appointments, error: appointmentsError } = await admin.from("appointments")
    .select("id,status,starts_at,ends_at")
    .eq("organization_id", org[0].id).eq("location_id", locations[0].id)
    .eq("staff_id", staff.user_id).in("status", BLOCKING_STATUSES)
    .lt("starts_at", leave.ends_at).gt("ends_at", leave.starts_at)
    .limit(501);
  if (appointmentsError || !appointments || appointments.length >= 501) {
    return NextResponse.json({ error: "APPOINTMENT_CHECK_UNAVAILABLE" }, { status: 503 });
  }
  // An empty result is not proof of safety until staff identity and every booking writer share an atomic lock.
  return NextResponse.json({
    status: appointments.length ? "conflict" : "no_conflicts_found",
    blockingCount: appointments.length,
    approvalEnabled: false,
    identityMappingVerified: false,
    message: appointments.length ? "查到既有預約衝突，不能核准休假。" : "目前未查到衝突，但員工 ID 對應與同步預約鎖尚未完成驗證，不能據此核准。",
  }, { headers: { "Cache-Control": "no-store" } });
}
