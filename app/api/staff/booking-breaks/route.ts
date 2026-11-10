import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MANAGERS = new Set(["OWNER", "MANAGER", "ADMIN"]);
const headers = { "Cache-Control": "no-store" };
function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers });
}
function validDay(date: string): boolean {
  const ms = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) return false;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const delta = (ms - Date.parse(today + "T00:00:00Z")) / 86400000;
  return delta >= 0 && delta <= 180;
}
/**
 * Manager-only, opt-in endpoint. Does not attest break synchronization.
 * Staff self-service requires a separately verified membership-to-staff mapping.
 */
export async function POST(request: Request) {
  if (process.env.BEAUTY_OS_BOOKING_BREAKS_WRITE_ENABLED !== "true") return fail(503, "BREAK_WRITE_DISABLED");
  const auth = await getAuthenticatedStaffMembership();
  if (auth.status !== "ok") return fail(401, "UNAUTHORIZED");
  const member = auth.membership;
  if (!MANAGERS.has(member.role)) return fail(403, "MANAGER_REQUIRED");
  let payload: unknown;
  try { payload = await request.json(); } catch { return fail(400, "INVALID_JSON"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fail(400, "INVALID_BODY");
  const body = payload as Record<string, unknown>;
  if (Object.keys(body).sort().join(",") !== "breaks,date,locationId,staffId") return fail(400, "INVALID_FIELDS");
  const { locationId, staffId, date, breaks } = body;
  if (typeof locationId !== "string" || !member.locationIds.includes(locationId)) return fail(403, "LOCATION_NOT_AUTHORIZED");
  if (typeof staffId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(staffId) ||
      typeof date !== "string" || !DATE.test(date) || !validDay(date) ||
      !Array.isArray(breaks) || breaks.length > 12) return fail(400, "INVALID_BREAK_DETAILS");
  const intervals: Array<{ start: string; end: string }> = [];
  for (const item of breaks) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail(400, "INVALID_BREAK_INTERVAL");
    const row = item as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== "end,start" ||
        typeof row.start !== "string" || typeof row.end !== "string" ||
        !CLOCK.test(row.start) || !CLOCK.test(row.end) || row.start >= row.end) return fail(400, "INVALID_BREAK_INTERVAL");
    intervals.push({
      start: date + "T" + row.start + ":00+08:00",
      end: date + "T" + row.end + ":00+08:00",
    });
  }
  const admin = createServiceRoleClient();
  if (!admin) return fail(503, "DATABASE_UNAVAILABLE");
  // Validate staff belongs to this tenant and location before privileged RPC.
  const { data: schedule, error: scheduleError } = await admin.from("booking_staff_working_hours")
    .select("staff_id").eq("organization_id", member.organizationId)
    .eq("location_id", locationId).eq("staff_id", staffId).limit(1);
  if (scheduleError) return fail(503, "STAFF_SCHEDULE_UNAVAILABLE");
  if (!schedule || schedule.length !== 1) return fail(404, "STAFF_NOT_IN_LOCATION");
  const { data, error } = await admin.rpc("booking_staff_breaks_replace_day_v1", {
    p_organization_id: member.organizationId,
    p_location_id: locationId,
    p_staff_id: staffId,
    p_date: date,
    p_breaks: intervals,
  });
  if (error) {
    const code = error.message || "";
    if (code.includes("BREAK_OVERLAP")) return fail(409, "BREAK_OVERLAP");
    if (code.includes("INVALID_BREAK") || code.includes("STAFF_SCHEDULE_NOT_FOUND")) return fail(400, "INVALID_BREAK_DETAILS");
    console.error("[booking-breaks] write failed", error.code);
    return fail(503, "BREAK_SAVE_UNAVAILABLE");
  }
  return NextResponse.json({ ok: true, saved: data, syncVerified: false }, { headers });
}
