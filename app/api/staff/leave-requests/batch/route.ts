import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DAY = 86400000;
const DATE = /^\\d{4}-\\d{2}-\\d{2}$/;

/** Batch submission for collective-review (B) leave. All dates remain pending. */
export async function POST(request: Request) {
  const auth = await getAuthenticatedStaffMembership();
  if (auth.status !== "ok") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const member = auth.membership;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  const { locationId, dates, reason } = body as Record<string, unknown>;
  if (typeof locationId !== "string" || !member.locationIds.includes(locationId)) return NextResponse.json({ error: "LOCATION_NOT_AUTHORIZED" }, { status: 403 });
  if (!Array.isArray(dates) || dates.length < 1 || dates.length > 31 ||
    dates.some(d => typeof d !== "string" || !DATE.test(d)) ||
    new Set(dates).size !== dates.length ||
    typeof reason !== "string" || reason.length > 1000) {
    return NextResponse.json({ error: "INVALID_LEAVE_DETAILS" }, { status: 400 });
  }
  const now = Date.now();
  const starts = (dates as string[]).map(d => Date.parse(d + "T00:00:00+08:00"));
  if (starts.some((s, i) => !Number.isFinite(s) ||
    new Date(s + 8 * 3600000).toISOString().slice(0, 10) !== dates[i] ||
    s < now - DAY || s > now + 180 * DAY)) {
    return NextResponse.json({ error: "DATE_OUT_OF_RANGE" }, { status: 400 });
  }
  const admin = createServiceRoleClient();
  if (!admin) return NextResponse.json({ error: "DATABASE_UNAVAILABLE" }, { status: 503 });
  const earliest = Math.min(...starts);
  const latest = Math.max(...starts) + DAY;
  const { data: existing, error: readError } = await admin.from("staff_leave_requests")
    .select("starts_at,ends_at").eq("organization_id", member.organizationId)
    .eq("location_id", locationId).eq("staff_membership_id", member.id)
    .in("status", ["pending", "approved"])
    .lt("starts_at", new Date(latest).toISOString())
    .gt("ends_at", new Date(earliest).toISOString()).limit(500);
  if (readError || !existing || existing.length === 500) return NextResponse.json({ error: "LEAVE_READ_FAILED" }, { status: 503 });
  if (starts.some(s => existing.some(e => Date.parse(e.starts_at) < s + DAY && Date.parse(e.ends_at) > s))) {
    return NextResponse.json({ error: "LEAVE_ALREADY_REQUESTED" }, { status: 409 });
  }
  const rows = starts.map(s => ({
    organization_id: member.organizationId, location_id: locationId,
    staff_membership_id: member.id, leave_type: "scheduled_off",
    starts_at: new Date(s).toISOString(), ends_at: new Date(s + DAY).toISOString(),
    reason: reason.trim(), status: "pending",
  }));
  // A single insert statement avoids partial acceptance of a multi-day request.
  const { data, error } = await admin.from("staff_leave_requests").insert(rows).select("id,status,starts_at,ends_at");
  if (error?.code === "23P01" || error?.code === "23505") return NextResponse.json({ error: "LEAVE_ALREADY_REQUESTED" }, { status: 409 });
  if (error || !data || data.length !== rows.length) return NextResponse.json({ error: "LEAVE_CREATE_FAILED" }, { status: 503 });
  return NextResponse.json({ requests: data, status: "pending" }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
