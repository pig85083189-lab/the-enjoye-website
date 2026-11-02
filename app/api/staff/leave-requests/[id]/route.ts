import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const resolved = await getAuthenticatedStaffMembership();
  if (resolved.status !== "ok") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const membership = resolved.membership;
  if (!["OWNER", "MANAGER"].includes(membership.role)) {
    return NextResponse.json({ error: "MANAGER_REQUIRED" }, { status: 403 });
  }
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "INVALID_REQUEST_ID" }, { status: 400 });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  const { action, locationId, note } = body as Record<string, unknown>;
  if (typeof locationId !== "string" || !membership.locationIds.includes(locationId)) {
    return NextResponse.json({ error: "LOCATION_NOT_AUTHORIZED" }, { status: 403 });
  }
  if (action !== "reject" && action !== "approve") return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  if (typeof note !== "string" || note.length > 1000) return NextResponse.json({ error: "INVALID_NOTE" }, { status: 400 });
  // Approval must not bypass appointment conflict verification.
  // The authoritative appointment source is not yet connected to this workflow.
  if (action === "approve") {
    return NextResponse.json({ error: "APPOINTMENT_CONFLICT_CHECK_NOT_READY" }, { status: 409 });
  }
  const admin = createServiceRoleClient();
  if (!admin) return NextResponse.json({ error: "DATABASE_UNAVAILABLE" }, { status: 503 });
  const { data, error } = await admin.from("staff_leave_requests")
    .update({ status: "rejected", reviewed_by_membership_id: membership.id, reviewed_at: new Date().toISOString(), review_note: note.trim(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", membership.organizationId)
    .eq("location_id", locationId)
    .eq("status", "pending")
    .select("id,status,reviewed_at,review_note")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "LEAVE_REVIEW_NOT_READY" }, { status: 503 });
  if (!data) return NextResponse.json({ error: "REQUEST_NOT_PENDING_OR_NOT_FOUND" }, { status: 409 });
  return NextResponse.json({ request: data }, { headers: { "Cache-Control": "no-store" } });
}
