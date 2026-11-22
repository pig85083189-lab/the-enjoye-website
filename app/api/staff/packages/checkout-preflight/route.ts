import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { lineMembershipIsCurrent, type VerifiedLineBinding } from "@/lib/commerce/line-verified-booking-source";

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
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || origin !== (host ? `${url.protocol}//${host}` : url.origin)) return fail(403, "無效請求來源");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return fail(415, "請使用 JSON");
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
  // Organization membership alone must not grant access to every branch.
  if (!identity.membership.locationIds.includes(locationId)) {
    return fail(403, "沒有此分店的結帳權限");
  }
  const actor = await getServerStaffAuthUser();
  if (!actor || actor.id !== identity.membership.authUserId) return fail(403, "沒有結帳權限");
  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503, "正式財務資料庫未設定");
  const { data: org, error: orgError } = await db.from("organizations").select("id").eq("app_id", organizationId).limit(2);
  if (orgError || org?.length !== 1) return fail(404, "找不到店家");
  const orgId = org[0]!.id;
  const [{ data: staff, error: staffError }, { data: location, error: locationError }, { data: customer, error: customerError }, { data: definition, error: definitionError }] = await Promise.all([
    db.from("staff_auth_memberships").select("id,role,user_id").eq("organization_id", organizationId).eq("auth_user_id", actor.id).eq("is_active", true).limit(2),
    db.from("locations").select("id").eq("organization_id", orgId).eq("app_id", locationId).eq("is_active", true).limit(2),
    db.from("customers").select("id").eq("organization_id", orgId).eq("app_id", customerId).eq("status", "ACTIVE").limit(2),
    db.from("package_definitions").select("id,price_minor,session_count,included_services").eq("organization_id", orgId).eq("app_id", packageDefinitionId).eq("is_active", true).limit(2),
  ]);
  if (staffError || locationError || customerError || definitionError) return fail(503, "無法確認正式套票結帳資格");
  if (staff?.length !== 1 || location?.length !== 1) return fail(403, "沒有此分店的結帳權限");
  if (staff?.[0]?.role !== identity.membership.role || staff?.[0]?.user_id !== identity.membership.userId) {
    return fail(403, "員工身分與財務資料庫不一致");
  }
  if (customer?.length !== 1) return fail(409, "顧客尚未同步至正式財務資料庫");
  // Re-check LINE status on the server at the moment of purchase.
  // A browser-visible eligible-customer list is not authorization.
  const financeCustomerId = customer[0]!.id;
  const [{ data: memberLinks, error: memberError }, { data: bindings, error: bindingError }] = await Promise.all([
    db.from("member_line_customer_links").select("customer_id,line_subject_hash,verified_at")
      .eq("organization_id", orgId).eq("customer_id", financeCustomerId),
    db.from("line_customer_bindings").select("customer_uuid,line_user_id_hash,status,verified,confirmed_at,bound_at,unbound_at,blocked_at")
      .eq("organization_id", organizationId).eq("customer_uuid", financeCustomerId),
  ]);
  if (memberError || bindingError) return fail(503, "目前無法確認 LINE 會員資格");
  const evidence: VerifiedLineBinding[] = [];
  for (const row of bindings ?? []) {
    evidence.push({
      source: "binding",
      hash: typeof row.line_user_id_hash === "string" ? row.line_user_id_hash : null,
      verified: row.verified === true,
      status: String(row.status ?? ""),
      confirmedAt: row.confirmed_at,
      boundAt: row.bound_at,
      unboundAt: row.unbound_at,
      blockedAt: row.blocked_at,
    });
  }
  const hasCanonical = (memberLinks ?? []).some(row => Boolean(row.verified_at));
  for (const row of memberLinks ?? []) {
    evidence.push({
      source: "member_link",
      hash: typeof row.line_subject_hash === "string" ? row.line_subject_hash : null,
      verified: Boolean(row.verified_at),
      status: row.verified_at ? "active" : "pending",
      confirmedAt: row.verified_at,
      boundAt: row.verified_at,
      unboundAt: null,
      blockedAt: null,
    });
  }
  if (!lineMembershipIsCurrent(evidence, hasCanonical)) return fail(403, "僅限已完成 LINE 綁定的會員購買套票");
  if (definition?.length !== 1 || !Number.isSafeInteger(definition[0]?.price_minor) || definition[0]!.price_minor <= 0 || !Number.isSafeInteger(definition[0]?.session_count) || definition[0]!.session_count < 1 || !Array.isArray(definition[0]?.included_services) || definition[0]!.included_services.length === 0) return fail(409, "套票方案無效");
  const serviceRules = definition[0]!.included_services as unknown[];
  const serviceIds = serviceRules.map(rule =>
    rule && typeof rule === "object" && "serviceId" in rule &&
    typeof rule.serviceId === "string" ? rule.serviceId.trim() : "",
  );
  const validRules = serviceRules.every(rule => {
    if (!rule || typeof rule !== "object" || !("sessionsPerRedemption" in rule)) return false;
    const sessions = rule.sessionsPerRedemption;
    return sessions === 1;
  });
  if (!validRules) return fail(409, "套票療程扣堂設定無效");
  if (serviceIds.some(id => !id || id.length > 128) || new Set(serviceIds).size !== serviceIds.length) {
    return fail(409, "套票指定療程設定無效");
  }
  // Catalog records may reference either the finance UUID or its app_id.
  // Every designated treatment must still exist and be active in this organization.
  const uuidIds = serviceIds.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  const appIds = serviceIds.filter(id => !uuidIds.includes(id));
  const serviceQueries = [
    ...(uuidIds.length ? [db.from("services").select("id,app_id").eq("organization_id", orgId).eq("is_active", true).in("id", uuidIds)] : []),
    ...(appIds.length ? [db.from("services").select("id,app_id").eq("organization_id", orgId).eq("is_active", true).in("app_id", appIds)] : []),
  ];
  const serviceResults = await Promise.all(serviceQueries);
  if (serviceResults.some(result => result.error)) return fail(503, "無法確認指定療程");
  const found = new Set<string>();
  for (const result of serviceResults) {
    for (const row of result.data ?? []) {
      if (typeof row.id === "string") found.add(row.id);
      if (typeof row.app_id === "string") found.add(row.app_id);
    }
  }
  if (serviceIds.some(id => !found.has(id))) return fail(409, "套票包含已停用或不存在的指定療程");
  return NextResponse.json({ readyForWrite: false, reason: "FINANCE_AUTH_BRIDGE_REQUIRED", amountMinor: definition[0]!.price_minor, sessionCount: definition[0]!.session_count }, { headers });
}
