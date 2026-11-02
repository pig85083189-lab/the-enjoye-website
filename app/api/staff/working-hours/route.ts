import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MANAGERS = new Set(["OWNER", "MANAGER"]);
const HM = /^([01]\\d|2[0-3]):[0-5]\\d$/;

export async function GET(request: Request) {
  const resolved = await getAuthenticatedStaffMembership();
  if (resolved.status !== "ok") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const member = resolved.membership;
  const locationId = new URL(request.url).searchParams.get("locationId");
  if (!locationId || !member.locationIds.includes(locationId)) return NextResponse.json({ error: "LOCATION_NOT_AUTHORIZED" }, { status: 403 });
  const admin = createServiceRoleClient();
  if (!admin) return NextResponse.json({ error: "DATABASE_UNAVAILABLE" }, { status: 503 });
  const { data, error } = await admin.from("booking_staff_working_hours")
    .select("staff_id,day_of_week,start_time,end_time,is_working,updated_at")
    .eq("organization_id", member.organizationId).eq("location_id", locationId)
    .order("staff_id").order("day_of_week").limit(501);
  if (error || !data || data.length > 500) return NextResponse.json({ error: "SCHEDULE_READ_FAILED" }, { status: 503 });
  return NextResponse.json({ rows: data, source: "supabase" }, { headers: { "Cache-Control": "no-store" } });
}

/** Explicit migration action only. Never automatically overwrite existing rows from browser state. */
export async function POST(request: Request) {
  const resolved = await getAuthenticatedStaffMembership();
  if (resolved.status !== "ok") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const member = resolved.membership;
  if (!MANAGERS.has(member.role)) return NextResponse.json({ error: "MANAGER_REQUIRED" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  const input = body as { locationId?: unknown; rows?: unknown };
  if (typeof input.locationId !== "string" || !member.locationIds.includes(input.locationId)) return NextResponse.json({ error: "LOCATION_NOT_AUTHORIZED" }, { status: 403 });
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 100) return NextResponse.json({ error: "INVALID_ROWS" }, { status: 400 });
  const admin = createServiceRoleClient();
  if (!admin) return NextResponse.json({ error: "DATABASE_UNAVAILABLE" }, { status: 503 });
  const { data: staff, error: staffError } = await admin.from("staff_auth_memberships")
    .select("user_id,is_active").eq("organization_id", member.organizationId);
  if (staffError || !staff) return NextResponse.json({ error: "STAFF_READ_FAILED" }, { status: 503 });
  const allowed = new Set(staff.filter((s) => s.is_active && s.user_id).map((s) => s.user_id));
  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  for (const raw of input.rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NextResponse.json({ error: "INVALID_ROW" }, { status: 400 });
    const row = raw as Record<string, unknown>;
    const staffId = row.staffId, day = row.dayOfWeek, start = row.startTime, end = row.endTime, working = row.isWorking;
    if (typeof staffId !== "string" || !allowed.has(staffId) || !Number.isInteger(day) || (day as number) < 0 || (day as number) > 6 || typeof start !== "string" || !HM.test(start) || typeof end !== "string" || !HM.test(end) || start >= end || typeof working !== "boolean") return NextResponse.json({ error: "INVALID_SCHEDULE_ROW" }, { status: 400 });
    const key = staffId + ":" + day;
    if (seen.has(key)) return NextResponse.json({ error: "DUPLICATE_DAY" }, { status: 400 });
    seen.add(key);
    rows.push({ organization_id: member.organizationId, location_id: input.locationId, staff_id: staffId, day_of_week: day, start_time: start, end_time: end, is_working: working, updated_at: new Date().toISOString() });
  }
  // Import is create-only: refuse the entire import when any server schedule already exists.
  const { count, error: checkError } = await admin.from("booking_staff_working_hours")
    .select("id", { count: "exact", head: true }).eq("organization_id", member.organizationId).eq("location_id", input.locationId);
  if (checkError) return NextResponse.json({ error: "SCHEDULE_READ_FAILED" }, { status: 503 });
  if (count !== 0) return NextResponse.json({ error: "SERVER_SCHEDULE_ALREADY_EXISTS" }, { status: 409 });
  const { error } = await admin.from("booking_staff_working_hours").insert(rows);
  if (error) return NextResponse.json({ error: error.code === "23505" ? "SERVER_SCHEDULE_ALREADY_EXISTS" : "SCHEDULE_IMPORT_FAILED" }, { status: error.code === "23505" ? 409 : 503 });
  return NextResponse.json({ imported: rows.length }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
