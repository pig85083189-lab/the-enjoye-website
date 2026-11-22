import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";

export const dynamic = "force-dynamic";

/**
 * Read-only finance preflight for package sales.
 * Deliberately does not use service-role to call the existing authenticated
 * purchase RPC: that RPC requires auth.uid() and finance-side actor checks.
 * A cross-database write bridge must preserve those checks before enabling payment.
 */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers });
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(400, "資料格式不正確");
    body = raw as Record<string, unknown>;
  } catch { return fail(400, "資料格式不正確"); }
  const keys = ["organizationId", "locationId", "customerId", "packageDefinitionId"] as const;
  if (Object.keys(body).some(key => !keys.includes(key as typeof keys[number]))) return fail(400, "資料格式不正確");
  const values = keys.map(key => typeof body[key] === "string" ? (body[key] as string).trim() : "");
  if (values.some(value => !value || value.length > 128)) return fail(400, "請確認套票與顧客資料");
  const [organizationId, locationId, customerId, packageDefinitionId] = values as [string,string,string,string];
  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return fail(401, "請先登入");
  if (identity.status !== "ok" || !canCheckout(identity.membership)) return fail(403, "沒有結帳權限");
  const actor = await getServerStaffAuthUser();
  if (!actor || actor.id !== identity.membership.authUserId) return fail(403, "沒有結帳權限");
  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503, "正式財務資料庫未設定");
  const { data: org, error: orgError } = await db.from("organizations").select("id").eq("app_id", organizationId).limit(2);
  if (orgError || org?.length !== 1) return fail(404, "找不到店家");
  const orgId = org[0]!.id;
  const [{ data: staff, error: staffError }, { data: location, error: locationError }, { data: customer, error: customerError }, { data: definition, error: definitionError }] = await Promise.all([
    db.from("staff_auth_memberships").select("id").eq("organization_id", organizationId).eq("auth_user_id", actor.id).eq("is_active", true).limit(2),
    db.from("locations").select("id").eq("organization_id", orgId).eq("app_id", locationId).eq("is_active", true).limit(2),
    db.from("customers").select("id").eq("organization_id", orgId).eq("app_id", customerId).eq("status", "ACTIVE").limit(2),
    db.from("package_definitions").select("id,price_minor,session_count,included_services").eq("organization_id", orgId).eq("app_id", packageDefinitionId).eq("is_active", true).limit(2),
  ]);
  if (staffError || locationError || customerError || definitionError) return fail(503, "無法確認正式套票結帳資格");
  if (staff?.length !== 1 || location?.length !== 1) return fail(403, "沒有此分店的結帳權限");
  if (customer?.length !== 1) return fail(409, "顧客尚未同步至正式財務資料庫");
  if (definition?.length !== 1 || !Number.isSafeInteger(definition[0]?.price_minor) || definition[0]!.price_minor <= 0 || !Number.isSafeInteger(definition[0]?.session_count) || definition[0]!.session_count < 1 || !Array.isArray(definition[0]?.included_services) || definition[0]!.included_services.length === 0) return fail(409, "套票方案無效");
  return NextResponse.json({ readyForWrite: false, reason: "FINANCE_AUTH_BRIDGE_REQUIRED", amountMinor: definition[0]!.price_minor, sessionCount: definition[0]!.session_count }, { headers });
}
