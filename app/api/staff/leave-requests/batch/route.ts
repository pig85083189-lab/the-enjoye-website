import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;

export async function POST(request: Request) {
  const auth = await getAuthenticatedStaffMembership();
  if (auth.status !== "ok") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const member = auth.membership;
  let body: Record<string, unknown>;
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body");
    body = value as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 }); }
  const { locationId, dates, reason } = body;
  if (typeof locationId !== "string" || !member.locationIds.includes(locationId)) return NextResponse.json({ error: "LOCATION_NOT_AUTHORIZED" }, { status: 403 });
  if (!Array.isArray(dates) || dates.length < 1 || dates.length > 31 ||
    dates.some(d => typeof d !== "string" || !DATE.test(d)) ||
    new Set(dates).size !== dates.length || typeof reason !== "string" || reason.length > 1000) {
    return NextResponse.json({ error: "INVALID_LEAVE_DETAILS" }, { status: 400 });
  }
  const now = Date.now();
  if ((dates as string[]).some(d => {
    const start = Date.parse(d + "T00:00:00+08:00");
    return !Number.isFinite(start) || new Date(start + 8 * 3600000).toISOString().slice(0,10) !== d ||
      start < now - DAY || start > now + 180 * DAY;
  })) return NextResponse.json({ error: "DATE_OUT_OF_RANGE" }, { status: 400 });
  const admin = createServiceRoleClient();
  if (!admin) return NextResponse.json({ error: "DATABASE_UNAVAILABLE" }, { status: 503 });
  // Each RPC is atomic with booking time-off. Multi-day batches are deliberately
  // rejected until a single-transaction batch RPC is available: no partial days.
  if (dates.length !== 1) return NextResponse.json({ error: "ONE_DAY_AT_A_TIME" }, { status: 400 });
  const { data, error } = await admin.rpc("staff_self_leave_set_v1", {
    p_membership_id: member.id, p_location_id: locationId,
    p_date: dates[0], p_cancel: false, p_reason: reason.trim(),
  });
  if (error) {
    const message = error.message || "";
    const conflict = /CONFLICT|EXISTS|OVERLAP|APPOINTMENT/.test(message);
    const known = [
      "MEMBERSHIP_OR_LOCATION_NOT_AUTHORIZED", "LOCATION_ORGANIZATION_MISMATCH",
      "DATE_OUT_OF_RANGE", "NOT_SELF_MANAGED_LEAVE", "TIME_OFF_CONFLICT",
      "LEAVE_ALREADY_EXISTS", "APPOINTMENT_CONFLICT", "FORBIDDEN",
    ].find(code => message.includes(code));
    // Log only diagnostic categories, never request data or credentials.
    console.error("[staff-self-leave] RPC failed", {
      code: error.code || "unknown", category: known || "UNEXPECTED_RPC_ERROR",
    });
    return NextResponse.json(
      { error: conflict ? "LEAVE_CONFLICT" : known || "LEAVE_SAVE_FAILED" },
      { status: conflict ? 409 : known === "DATE_OUT_OF_RANGE" ? 400 : 503 },
    );
  }
  return NextResponse.json({ requests: [data], status: "approved" }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
