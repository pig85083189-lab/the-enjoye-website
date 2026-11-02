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
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
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

const LEAVE_TYPES = new Set(["scheduled_off", "annual", "personal", "sick"]);
const DAY = 86400000;

export async function POST(request: Request) {
  const resolved = await getAuthenticatedStaffMembership();
  if (resolved.status !== "ok") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const membership = resolved.membership;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid body");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const { locationId, leaveType, date, reason } = body;
  if (typeof locationId !== "string" || !membership.locationIds.includes(locationId)) {
    return NextResponse.json({ error: "LOCATION_NOT_AUTHORIZED" }, { status: 403 });
  }
  if (typeof leaveType !== "string" || !LEAVE_TYPES.has(leaveType) || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "INVALID_LEAVE_DETAILS" }, { status: 400 });
  }
  if (typeof reason !== "string" || reason.length > 1000) {
    return NextResponse.json({ error: "INVALID_REASON" }, { status: 400 });
  }
  const start = Date.parse(date + "T00:00:00+08:00");
  if (!Number.isFinite(start) || new Date(start + 8 * 3600000).toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }
  const now = Date.now();
  if (start < now - DAY || start > now + 180 * DAY) {
    return NextResponse.json({ error: "DATE_OUT_OF_RANGE" }, { status: 400 });
  }
  const admin = createServiceRoleClient();
  if (!admin) return NextResponse.json({ error: "DATABASE_UNAVAILABLE" }, { status: 503 });
  const end = new Date(start + DAY).toISOString();
  const { data: overlapping, error: overlapError } = await admin.from("staff_leave_requests")
    .select("id,status").eq("organization_id", membership.organizationId)
    .eq("location_id", locationId).eq("staff_membership_id", membership.id)
    .in("status", ["pending", "approved"])
    .lt("starts_at", end).gt("ends_at", new Date(start).toISOString()).limit(1);
  if (overlapError) return NextResponse.json({ error: "LEAVE_SOURCE_NOT_READY" }, { status: 503 });
  if (overlapping?.length) return NextResponse.json({ error: "LEAVE_ALREADY_REQUESTED" }, { status: 409 });
  const { data, error } = await admin.from("staff_leave_requests").insert({
    organization_id: membership.organizationId,
    location_id: locationId,
    staff_membership_id: membership.id,
    leave_type: leaveType,
    starts_at: new Date(start).toISOString(),
    ends_at: end,
    reason: reason.trim(),
    status: "pending",
  }).select("id,status,starts_at,ends_at").single();
  if (error?.code === "23P01") return NextResponse.json({ error: "LEAVE_ALREADY_REQUESTED" }, { status: 409 });
  if (error) return NextResponse.json({ error: "LEAVE_CREATE_FAILED" }, { status: 503 });
  return NextResponse.json({ request: data }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
