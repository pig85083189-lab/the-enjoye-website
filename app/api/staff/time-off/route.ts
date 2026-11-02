import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MANAGERS = new Set(["OWNER", "MANAGER"]);
const noStore = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });

export async function GET(request: Request) {
  const auth = await getAuthenticatedStaffMembership();
  if (auth.status !== "ok") return fail("UNAUTHORIZED", 401);
  const member = auth.membership;
  const locationId = new URL(request.url).searchParams.get("locationId");
  if (!locationId || !member.locationIds.includes(locationId)) return fail("LOCATION_NOT_AUTHORIZED", 403);
  const admin = createServiceRoleClient();
  if (!admin) return fail("DATABASE_UNAVAILABLE", 503);
  let query = admin.from("booking_staff_time_off")
    .select("id,staff_id,location_id,start_at,end_at,reason,status,source,requested_by,reviewed_by,reviewed_at,created_at")
    .eq("organization_id", member.organizationId).eq("location_id", locationId)
    .order("created_at", { ascending: false }).limit(201);
  if (!MANAGERS.has(member.role)) query = query.eq("staff_id", member.userId);
  const { data, error } = await query;
  if (error || !data || data.length > 200) return fail("LEAVE_READ_FAILED", 503);
  return NextResponse.json({ rows: data }, { headers: noStore });
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedStaffMembership();
  if (auth.status !== "ok") return fail("UNAUTHORIZED", 401);
  const member = auth.membership;
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_BODY", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("INVALID_BODY", 400);
  const { locationId, staffId, startAt, endAt, reason, mode } = body as Record<string, unknown>;
  const isManager = MANAGERS.has(member.role);
  if (typeof locationId !== "string" || !member.locationIds.includes(locationId)) return fail("LOCATION_NOT_AUTHORIZED", 403);
  if (mode !== "REQUEST" && mode !== "DIRECT") return fail("INVALID_MODE", 400);
  if (mode === "DIRECT" && !isManager) return fail("MANAGER_REQUIRED", 403);
  if (typeof staffId !== "string" || (!isManager && staffId !== member.userId)) return fail("STAFF_NOT_AUTHORIZED", 403);
  if (typeof startAt !== "string" || typeof endAt !== "string" ||
    !Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt)) ||
    new Date(startAt).toISOString() !== startAt || new Date(endAt).toISOString() !== endAt ||
    Date.parse(startAt) >= Date.parse(endAt) ||
    Date.parse(endAt) - Date.parse(startAt) > 31 * 86400000 ||
    typeof reason !== "undefined" && (typeof reason !== "string" || reason.length > 500))
    return fail("INVALID_LEAVE_RANGE", 400);
  const admin = createServiceRoleClient();
  if (!admin) return fail("DATABASE_UNAVAILABLE", 503);
  const { data: staff, error: staffError } = await admin.from("staff_auth_memberships")
    .select("user_id,is_active").eq("organization_id", member.organizationId)
    .eq("user_id", staffId).eq("is_active", true).maybeSingle();
  if (staffError || !staff) return fail("STAFF_NOT_AUTHORIZED", 403);
  // Both request and manager-directed entries remain pending until the
  // appointment-to-tenant mapping and conflict check are proven.
  // Never mark a leave APPROVED in this endpoint.
  const { data, error } = await admin.from("booking_staff_time_off").insert({
    organization_id: member.organizationId, location_id: locationId, staff_id: staffId,
    start_at: startAt, end_at: endAt, reason: typeof reason === "string" ? reason.trim() : null,
    status: "REQUESTED", source: mode === "DIRECT" ? "MANAGER_DIRECT" : "STAFF_REQUEST",
    requested_by: member.userId,
  }).select("id,status,source").single();
  if (error || !data) return fail("LEAVE_CREATE_FAILED", 503);
  return NextResponse.json({ created: true, row: data, notice: "PENDING_CONFLICT_VERIFICATION" }, { status: 201, headers: noStore });
}

/**
 * Manager review. Rejection is safe to persist now.
 * Approval remains blocked until the production appointment tenant mapping
 * and conflict query are verified, never infer safety from an empty result.
 */
export async function PATCH(request: Request) {
  const auth = await getAuthenticatedStaffMembership();
  if (auth.status !== "ok") return fail("UNAUTHORIZED", 401);
  const member = auth.membership;
  if (!MANAGERS.has(member.role)) return fail("MANAGER_REQUIRED", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_BODY", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("INVALID_BODY", 400);
  const { id, locationId, decision } = body as Record<string, unknown>;
  if (typeof locationId !== "string" || !member.locationIds.includes(locationId)) return fail("LOCATION_NOT_AUTHORIZED", 403);
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return fail("INVALID_LEAVE_ID", 400);
  if (decision !== "APPROVE" && decision !== "REJECT") return fail("INVALID_DECISION", 400);
  if (decision === "APPROVE") return fail("APPOINTMENT_SCOPE_UNVERIFIED", 409);
  const admin = createServiceRoleClient();
  if (!admin) return fail("DATABASE_UNAVAILABLE", 503);
  const { data, error } = await admin.from("booking_staff_time_off")
    .update({ status: "REJECTED", reviewed_by: member.userId,
      reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id).eq("organization_id", member.organizationId)
    .eq("location_id", locationId).eq("status", "REQUESTED")
    .select("id,status,reviewed_at").maybeSingle();
  if (error) return fail("LEAVE_REVIEW_FAILED", 503);
  if (!data) return fail("LEAVE_NOT_PENDING", 409);
  return NextResponse.json({ reviewed: true, row: data }, { headers: noStore });
}
