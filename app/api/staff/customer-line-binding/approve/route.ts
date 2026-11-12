import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Staff may approve a member-initiated, unexpired consent request only. */
export async function POST(request: NextRequest) {
  if (process.env.BEAUTY_OS_LINE_BINDING_APPROVAL_ENABLED !== "true") {
    return NextResponse.json({ error: "LINE binding approval is not enabled" }, { status: 503 });
  }
  const staff = await getServerStaffAuthUser();
  if (!staff) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const membership = await getAuthenticatedStaffMembership();
  if (membership.status !== "ok" || !["OWNER", "MANAGER"].includes(membership.membership.role)) {
    return NextResponse.json({ error: "Manager approval required" }, { status: 403 });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const input = body as Record<string, unknown> | null;
  const requestId = input?.requestId;
  const claimedCustomerId = input?.claimedCustomerId;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof requestId !== "string" || !uuid.test(requestId) ||
      typeof claimedCustomerId !== "string" || !uuid.test(claimedCustomerId)) {
    return NextResponse.json({ error: "Invalid identifiers" }, { status: 400 });
  }
  const db = createServiceRoleClient();
  if (!db) return NextResponse.json({ error: "Server unavailable" }, { status: 503 });
  // This RPC must atomically verify member consent, expiry, organization,
  // customer ownership, conflicting claims, and approval identity.
  // Never write the claims table directly from an HTTP request.
  const { data, error } = await db.rpc("approve_member_customer_claim", {
    p_request_id: requestId,
    p_claimed_customer_id: claimedCustomerId,
    p_approver_auth_user_id: staff.id,
    p_staff_organization_app_id: membership.membership.organizationId,
  });
  if (error) return NextResponse.json({ error: "Approval rejected or unavailable" }, { status: 409 });
  return NextResponse.json({ approved: data === true }, { status: data === true ? 200 : 409 });
}
