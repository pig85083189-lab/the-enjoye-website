import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { calculateAvailableStarts } from "@/lib/member-booking/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal diagnostic only. Never expose this route as member bookability.
 * Leave, break and concurrent booking locks are not yet unified.
 */
export async function GET(request: Request) {
  const auth = await getAuthenticatedStaffMembership();
  if (auth.status !== "ok") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const member = auth.membership;
  if (!["OWNER", "MANAGER"].includes(member.role)) return NextResponse.json({ error: "MANAGER_REQUIRED" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const locationId = params.get("locationId");
  const staffId = params.get("staffId");
  const date = params.get("date");
  const duration = Number(params.get("serviceMinutes"));
  if (!locationId || !member.locationIds.includes(locationId)) return NextResponse.json({ error: "LOCATION_NOT_AUTHORIZED" }, { status: 403 });
  if (!staffId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(duration) || duration < 15 || duration > 720) {
    return NextResponse.json({ error: "INVALID_PARAMETERS" }, { status: 400 });
  }
  const admin = createServiceRoleClient();
  if (!admin) return NextResponse.json({ error: "DATABASE_UNAVAILABLE" }, { status: 503 });

  const { data: staff, error: staffError } = await admin.from("staff_auth_memberships")
    .select("user_id,is_active").eq("organization_id", member.organizationId)
    .eq("user_id", staffId).eq("is_active", true).limit(2);
  if (staffError || !staff || staff.length !== 1) return NextResponse.json({ error: "STAFF_UNVERIFIED" }, { status: 503 });
  // Same staff-location verification as the existing staff time-off API.
  const { count: scheduleCount, error: scheduleError } = await admin.from("booking_staff_working_hours")
    .select("id", { count: "exact", head: true }).eq("organization_id", member.organizationId)
    .eq("location_id", locationId).eq("staff_id", staffId);
  if (scheduleError || !scheduleCount) return NextResponse.json({ error: "STAFF_LOCATION_UNVERIFIED" }, { status: 503 });

  const { data: orgs, error: orgError } = await admin.from("organizations").select("id").eq("app_id", member.organizationId).limit(2);
  const { data: locations, error: locationError } = await admin.from("locations").select("id,organization_id").eq("app_id", locationId).limit(2);
  if (orgError || locationError || orgs?.length !== 1 || locations?.length !== 1 || locations[0].organization_id !== orgs[0].id) {
    return NextResponse.json({ error: "TENANT_MAPPING_UNVERIFIED" }, { status: 503 });
  }

  const dayStart = Date.parse(date + "T00:00:00+08:00");
  if (!Number.isFinite(dayStart) || new Date(dayStart + 28800000).toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }
  const dayEnd = new Date(dayStart + 86400000).toISOString();
  const { data: shifts, error: shiftError } = await admin.from("booking_staff_working_hours")
    .select("staff_id,day_of_week,start_time,end_time,is_working")
    .eq("organization_id", member.organizationId).eq("location_id", locationId).eq("staff_id", staffId).limit(8);
  const { data: appointments, error: appointmentError } = await admin.from("appointments")
    .select("starts_at,ends_at,status").eq("organization_id", orgs[0].id).eq("location_id", locations[0].id)
    .eq("staff_id", staffId).lt("starts_at", dayEnd).gt("ends_at", new Date(dayStart).toISOString()).limit(501);
  // A single unresolved leave request is enough to block diagnostic slots for
  // the affected day. This is deliberately conservative until leave sources
  // and approval semantics are unified.
  const { data: leaves, error: leaveError } = await admin.from("booking_staff_time_off")
    .select("start_at,end_at,status")
    .eq("organization_id", member.organizationId).eq("location_id", locationId)
    .eq("staff_id", staffId)
    .in("status", ["REQUESTED", "APPROVED"])
    .lt("start_at", dayEnd).gt("end_at", new Date(dayStart).toISOString()).limit(501);
  if (leaveError || !leaves || leaves.length >= 501) {
    return NextResponse.json({ error: "LEAVE_SOURCE_UNAVAILABLE" }, { status: 503 });
  }
  if (shiftError || appointmentError || !shifts || !appointments || shifts.length > 7 || appointments.length >= 501) {
    return NextResponse.json({ error: "SCHEDULE_OR_BOOKINGS_UNAVAILABLE" }, { status: 503 });
  }
  // Treat every returned appointment as busy, including cancelled ones, until the
  // canonical booking status rules are verified. Conservative diagnostic only.
  try {
    const starts = calculateAvailableStarts({
      date, staffId, serviceMinutes: duration, notBefore: new Date().toISOString(),
      workingDays: shifts.map(s => ({
        staffId: s.staff_id, dayOfWeek: s.day_of_week,
        startTime: s.start_time, endTime: s.end_time, isWorking: s.is_working,
      })),
      busy: [
        ...appointments.map(a => ({ startAt: a.starts_at, endAt: a.ends_at })),
        ...leaves.map(l => ({ startAt: l.start_at, endAt: l.end_at })),
      ],
    });
    return NextResponse.json({
      status: "diagnostic_only", bookable: false, starts,
      warning: "Not member-bookable: one leave source is checked, but alternate leave records, breaks and atomic booking locks are not yet integrated.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "AVAILABILITY_DATA_INVALID" }, { status: 503 });
  }
}
