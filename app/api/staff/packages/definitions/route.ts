import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";

async function bookingCatalog(organizationId: string) {
  const client = await createClient();
  const org = await client.from("organizations").select("id").eq("app_id", organizationId).limit(2);
  if (org.error || org.data?.length !== 1) throw new Error("booking organization unavailable");
  const result = await client.from("services").select("id,app_id,name,is_active,service_type,duration_minutes,price,price_minor,category,currency").eq("organization_id",org.data[0]!.id).order("name").limit(500);
  if (result.error || !result.data) throw new Error("booking services unavailable");
  return result.data;
}
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
  let catalog;
  try { catalog = await bookingCatalog(organizationId); } catch { return fail(503,"無法讀取正式服務項目"); }
  const chosen = catalog.filter(row => row.is_active && row.app_id && (serviceIds as string[]).includes(row.id));
  if (chosen.length !== serviceIds.length) return fail(409,"指定療程不存在或未啟用");
  const financeIds: string[] = [];
  for (const row of chosen) {
    const existing = await db.from("services").select("id,is_active").eq("organization_id",org[0]!.id).eq("app_id",row.app_id).limit(2);
    if (existing.error || (existing.data?.length ?? 0)>1) return fail(409,"療程對應異常");
    if (existing.data?.length === 1) {
      if (!existing.data[0]!.is_active) return fail(409,"財務療程未啟用");
      financeIds.push(existing.data[0]!.id);
    } else {
      const inserted = await db.from("services").insert({id:row.id,organization_id:org[0]!.id,app_id:row.app_id,name:row.name,is_active:true,service_type:row.service_type,duration_minutes:row.duration_minutes,price:row.price,price_minor:row.price_minor,category:row.category,currency:row.currency}).select("id").single();
      if (inserted.error || !inserted.data) return fail(409,"療程同步失敗，請重新讀取");
      financeIds.push(inserted.data.id);
    }
  }
  const { data, error } = await db.from("package_definitions").insert({
    organization_id: org[0]!.id,
    app_id: `pkgdef-${randomUUID()}`,
    name: name.trim(),
    description: typeof description === "string" ? description.trim() : null,
    included_services: financeIds.map(serviceId => ({ serviceId, sessionsPerRedemption: 1 })),
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
    db.from("services").select("id,app_id,name,is_active").eq("organization_id", orgId).order("name").limit(500),
  ]);
  if (definitions.error) return fail(503, "無法讀取正式套票方案");
  if (services.error) return fail(503, "無法讀取指定療程");
  let catalog;
  try { catalog = await bookingCatalog(organizationId); } catch { return fail(503,"無法讀取正式服務項目"); }
  const historical = (services.data ?? []).map(row => ({...row,is_active:false}));
  const current = catalog.map(row => ({id:row.id,name:row.name,is_active:row.is_active && Boolean(row.app_id)}));
  const displayDefinitions = (definitions.data ?? []).map(def => ({...def,included_services:(Array.isArray(def.included_services)?def.included_services:[]).map(item => {
    const finance = (services.data ?? []).find(row=>row.id===item.serviceId);
    const booking = catalog.find(row=>row.app_id && row.app_id===finance?.app_id);
    return {...item,serviceId:booking?.id ?? item.serviceId};
  })}));
  return NextResponse.json({definitions:displayDefinitions,services:[...current,...historical.filter(row=>!current.some(item=>item.id===row.id))]},{headers:{"Cache-Control":"private, no-store"}});
}
