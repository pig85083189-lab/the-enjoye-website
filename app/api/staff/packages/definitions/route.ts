import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** Only owner/manager may create package products. Selling is a separate staff checkout permission. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const expectedOrigin = forwardedHost ? `${requestUrl.protocol}//${forwardedHost}` : requestUrl.origin;
  if (!origin || origin !== expectedOrigin) return fail(403, "無效請求來源");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return fail(415, "請使用 JSON");
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(400, "資料格式錯誤");
    body = raw as Record<string, unknown>;
  } catch { return fail(400, "資料格式錯誤"); }
  const organizationId = body.organizationId;
  const name = body.name;
  const description = body.description;
  const serviceIds = body.serviceIds;
  const sessionCount = body.sessionCount;
  const priceMinor = body.priceMinor;
  const validityDays = body.validityDays;
  if (typeof organizationId !== "string" || organizationId.length > 120 ||
      typeof name !== "string" || !name.trim() || name.trim().length > 120 ||
      (description != null && (typeof description !== "string" || description.length > 1000)) ||
      !Array.isArray(serviceIds) || serviceIds.length < 1 || serviceIds.length > 30 ||
      !serviceIds.every((id: unknown) => typeof id === "string" && UUID.test(id)) ||
      new Set(serviceIds).size !== serviceIds.length ||
      !Number.isSafeInteger(sessionCount) || (sessionCount as number) < 1 || (sessionCount as number) > 10000 ||
      !Number.isSafeInteger(priceMinor) || (priceMinor as number) < 0 || (priceMinor as number) > 100000000 ||
      (validityDays != null && (!Number.isSafeInteger(validityDays) || (validityDays as number) < 1 || (validityDays as number) > 36500))) {
    return fail(400, "請填寫正確的指定療程、堂數、價格及有效期限");
  }
  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return fail(401, "請先登入");
  if (identity.status !== "ok" || !identity.membership.isActive ||
      !["OWNER", "MANAGER"].includes(identity.membership.role)) return fail(403, "只有主管或店長可管理套票方案");
  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503, "正式資料庫未設定");
  const { data: org, error: orgError } = await db.from("organizations").select("id")
    .eq("app_id", organizationId).limit(2);
  if (orgError || org?.length !== 1) return fail(409, "無法確認店家");
  const { data: services, error: serviceError } = await db.from("services").select("id")
    .eq("organization_id", org[0]!.id).eq("is_active", true).in("id", serviceIds as string[]);
  if (serviceError || services?.length !== serviceIds.length) return fail(409, "指定療程不存在或未啟用");
  const { data, error } = await db.from("package_definitions").insert({
    organization_id: org[0]!.id,
    app_id: `pkgdef-${randomUUID()}`,
    name: name.trim(),
    description: typeof description === "string" ? description.trim() : null,
    included_services: (serviceIds as string[]).map(serviceId => ({ serviceId, sessionsPerRedemption: 1 })),
    session_count: sessionCount,
    price_minor: priceMinor,
    currency: "TWD",
    validity_days: validityDays ?? null,
    is_active: true,
  }).select("id").single();
  if (error || !data?.id) return fail(409, "套票方案未建立，請檢查資料");
  return NextResponse.json({ id: data.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

/** Administrative catalogue only; independent of customer purchase and ledger reads. */
export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim() ?? "";
  if (!organizationId || organizationId.length > 120) return fail(400, "無效的店家");
  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return fail(401, "請先登入");
  if (identity.status !== "ok" || !identity.membership.isActive ||
      !["OWNER", "MANAGER"].includes(identity.membership.role)) return fail(403, "只有主管或店長可管理套票方案");
  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503, "正式資料庫未設定");
  const { data: org, error: orgError } = await db.from("organizations").select("id").eq("app_id", organizationId).limit(2);
  if (orgError || org?.length !== 1) return fail(409, "無法確認店家");
  const orgId = org[0]!.id;
  const [definitions, services] = await Promise.all([
    db.from("package_definitions").select("id,name,session_count,price_minor,is_active,included_services").eq("organization_id", orgId).order("created_at", {ascending:false}).limit(500),
    db.from("services").select("id,name,is_active").eq("organization_id", orgId).order("name").limit(500),
  ]);
  if (definitions.error) return fail(503, "無法讀取正式套票方案");
  if (services.error) return fail(503, "無法讀取指定療程");
  return NextResponse.json({definitions:definitions.data ?? [],services:services.data ?? []},{headers:{"Cache-Control":"private, no-store"}});
}
