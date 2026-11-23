import { NextResponse } from "next/server";
import { POST as runPackagePreflight } from "../checkout-preflight/route";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { validatePackageSaleTenders } from "@/lib/commerce/package-sale-tender-validation";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers });
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128 &&
  /^[a-zA-Z0-9:_-]+$/.test(value);

/**
 * Dedicated package-sale finance API. This is intentionally disabled until
 * the reviewed finance RPC has been migrated and integration tests pass.
 * All actions re-run booking and finance membership, LINE and service checks.
 */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail(403, "無效請求來源");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return fail(415, "請使用 JSON");
  if (process.env.BEAUTY_OS_PACKAGE_FINANCE_BRIDGE_ENABLED !== "1") {
    return fail(503, "套票付款尚未通過正式交易驗證，暫停收款");
  }
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(400, "資料格式不正確");
    body = raw as Record<string, unknown>;
  } catch { return fail(400, "資料格式不正確"); }
  const action = body.action;
  if (action !== "OPEN" && action !== "SAVE" && action !== "SETTLE") return fail(400, "不支援的交易操作");
  const allowed = action === "OPEN"
    ? ["action","organizationId","locationId","customerId","packageDefinitionId","checkoutAppId"]
    : ["action","checkoutAppId","expectedUpdatedAt",...(action === "SAVE" ? ["payments"] : [])];
  if (Object.keys(body).some(key => !allowed.includes(key))) return fail(400, "包含不允許的欄位");
  if (!validId(body.checkoutAppId)) return fail(400, "結帳識別碼無效");
  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503, "財務資料庫未設定");
  let organizationId: string, locationId: string, customerId: string, packageDefinitionId: string;
  let definitionDbId: string | null = null;
  let draftTotalMinor: number | null = null;
  let draftOrganizationDbId: string | null = null;
  let expectedUpdatedAt: string | null = null;
  if (action === "OPEN") {
    if (![body.organizationId,body.locationId,body.customerId,body.packageDefinitionId].every(validId)) {
      return fail(400, "套票結帳資料不完整");
    }
    organizationId = body.organizationId as string;
    locationId = body.locationId as string;
    customerId = body.customerId as string;
    packageDefinitionId = body.packageDefinitionId as string;
  } else {
    if (typeof body.expectedUpdatedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(body.expectedUpdatedAt) ||
      !Number.isFinite(Date.parse(body.expectedUpdatedAt))) return fail(400, "結帳版本無效");
    expectedUpdatedAt = body.expectedUpdatedAt;
    const { data: drafts, error: draftError } = await db.from("checkout_drafts")
      .select("id,organization_id,location_id,customer_id,status,total_minor,updated_at")
      .eq("app_id", body.checkoutAppId).limit(2);
    if (draftError || drafts?.length !== 1) return fail(404, "找不到套票結帳單");
    const draft = drafts[0]!;
    if (!["OPEN","READY"].includes(draft.status)) return fail(409, "結帳已完成或不可修改");
    if (draft.updated_at !== expectedUpdatedAt) return fail(409, "結帳資料已更新，請重新整理");
    if (!Number.isSafeInteger(draft.total_minor) || draft.total_minor <= 0) return fail(409, "結帳金額無效");
    draftTotalMinor = draft.total_minor;
    draftOrganizationDbId = draft.organization_id;
    const [{ data: org },{ data: loc },{ data: customer },{ data: items }] = await Promise.all([
      db.from("organizations").select("app_id").eq("id", draft.organization_id).limit(2),
      db.from("locations").select("app_id").eq("id", draft.location_id).eq("organization_id", draft.organization_id).limit(2),
      db.from("customers").select("app_id").eq("id", draft.customer_id).eq("organization_id", draft.organization_id).limit(2),
      db.from("checkout_items").select("type,reference_id,quantity").eq("checkout_draft_id",draft.id).limit(2),
    ]);
    if (org?.length !== 1 || loc?.length !== 1 || customer?.length !== 1 ||
        items?.length !== 1 || items[0]?.type !== "PACKAGE_PURCHASE" || items[0]?.quantity !== 1) {
      return fail(409, "不是有效的套票購買結帳");
    }
    organizationId = org[0]!.app_id;
    locationId = loc[0]!.app_id;
    customerId = customer[0]!.app_id;
    packageDefinitionId = items[0]!.reference_id;
  }
  // Reuse the same authorization gate for every write, not just opening.
  const preflightRequest = new Request(new URL("checkout-preflight",request.url), {
    method: "POST",
    headers: { "origin": new URL(request.url).origin, "content-type": "application/json" },
    body: JSON.stringify({ organizationId,locationId,customerId,packageDefinitionId }),
  });
  const preflight = await runPackagePreflight(preflightRequest);
  const check = await preflight.json() as { error?: string; amountMinor?: number; reason?: string };
  if (!preflight.ok) return fail(preflight.status, check.error ?? "套票結帳授權失敗");
  if (check.reason !== "FINANCE_AUTH_BRIDGE_REQUIRED" || !Number.isSafeInteger(check.amountMinor)) {
    return fail(503, "套票交易資格無法確認");
  }
  if (action !== "OPEN" && draftTotalMinor !== check.amountMinor) {
    return fail(409, "套票價格已變動，請重新建立結帳單");
  }
  const actor = await getServerStaffAuthUser();
  if (!actor) return fail(401, "請先登入");
  const { data: definitions, error: defError } = await db.from("package_definitions")
    .select("id,organization_id,price_minor").eq("app_id",packageDefinitionId).eq("is_active",true).limit(2);
  if (defError || definitions?.length !== 1) return fail(409, "套票方案已失效");
  if (definitions[0]!.price_minor !== check.amountMinor ||
      (draftOrganizationDbId && definitions[0]!.organization_id !== draftOrganizationDbId)) {
    return fail(409, "套票方案與結帳店家或金額不一致");
  }
  definitionDbId = definitions[0]!.id;
  let payments: Array<{method:string;amount:number;id:string;reference?:string}> | null = null;
  if (action === "SAVE") {
    try {
      payments = validatePackageSaleTenders(body.payments,check.amountMinor!).map((payment,index) => ({
        ...payment, id: `${body.checkoutAppId}:tender:${index}`,
      }));
    } catch (error) {
      return fail(400, error instanceof Error ? error.message : "付款金額無效");
    }
  }
  const { data, error } = await db.rpc("finance_package_checkout_bridge", {
    p_action: action,
    p_actor_auth_user_id: actor.id,
    p_checkout_app_id: body.checkoutAppId,
    p_customer_app_id: action === "OPEN" ? customerId : null,
    p_location_app_id: action === "OPEN" ? locationId : null,
    p_package_definition_app_id: action === "OPEN" ? packageDefinitionId : null,
    p_expected_updated_at: expectedUpdatedAt,
    p_payments: payments,
    p_package_definition_id: action === "SETTLE" ? definitionDbId : null,
  });
  if (error) {
    console.error("[package-finance] bridge rejected", { code: error.code, action });
    return fail(error.code === "PGRST202" ? 503 : 409, "財務交易未完成，請重新整理後確認狀態");
  }
  return NextResponse.json({ bundle: data }, { headers });
}
