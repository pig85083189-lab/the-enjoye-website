import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MANAGEMENT_ROLES = new Set(["OWNER", "MANAGER", "ADMIN"]);

export async function GET(request: Request) {
  const resolved = await getAuthenticatedStaffMembership();
  if (resolved.status !== "ok") {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const membership = resolved.membership;
  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  if (!locationId || !membership.locationIds.includes(locationId)) {
    return NextResponse.json({ error: "LOCATION_NOT_AUTHORIZED" }, { status: 403 });
  }
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || !/^\\d{4}-\\d{2}-\\d{2}$/.test(from) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: "INVALID_DATE_RANGE" }, { status: 400 });
  }
  const start = Date.parse(from + "T00:00:00+08:00");
  const end = Date.parse(to + "T00:00:00+08:00");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start > 93 * 86400000) {
    return NextResponse.json({ error: "INVALID_DATE_RANGE" }, { status: 400 });
  }
  const admin = createServiceRoleClient();
  if (!admin) return NextResponse.json({ error: "DATABASE_UNAVAILABLE" }, { status: 503 });

  // Service-role access is always explicitly tenant-scoped. Non-managers see only their own requests.
  let query = admin.from("staff_leave_requests")
    .select("id,staff_membership_id,leave_type,starts_at,ends_at,reason,status,reviewed_at,review_note,created_at")
    .eq("organization_id", membership.organizationId)
    .eq("location_id", locationId)
    .lt("starts_at", new Date(end + 86400000).toISOString())
    .gt("ends_at", new Date(start).toISOString())
    .order("starts_at", { ascending: true })
    .limit(500);
  if (!MANAGEMENT_ROLES.has(membership.role)) {
    query = query.eq("staff_membership_id", membership.id);
  }
  const { data, error } = await query;
  if (error) {
    console.error("Staff leave request read failed", error.code);
    return NextResponse.json({ error: "LEAVE_SOURCE_NOT_READY" }, { status: 503 });
  }
  if ((data?.length ?? 0) === 500) {
    return NextResponse.json({ error: "LEAVE_RESULT_LIMIT" }, { status: 503 });
  }
  return NextResponse.json({ status: "ready", requests: data ?? [], viewer: { role: membership.role, staffMembershipId: membership.id } }, { headers: { "Cache-Control": "no-store" } });
}
