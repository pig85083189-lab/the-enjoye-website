import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { createServiceRoleClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METHODS = new Set(["CASH", "CREDIT_CARD", "BANK_TRANSFER", "OTHER"]);

function reject(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Manual settlement is an authenticated staff attestation, NOT bank verification.
 * Explicit environment-scoped release flags; never enable by default.
 * No browser-provided staff identity, organization UUID, or ledger balance is trusted.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  if (!origin || origin !== url.origin) return reject("無效的請求來源", 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return reject("請使用 JSON 格式", 415);
  }
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject("無效的請求資料", 400);
    body = raw as Record<string, unknown>;
  } catch { return reject("無效的請求資料", 400); }

  const organizationId = body.organizationId;
  const locationId = body.locationId;
  const customerId = body.customerId;
  const method = body.method;
  const amountMinor = body.amountMinor;
  const effectKey = body.effectKey;
  if (typeof organizationId !== "string" || typeof locationId !== "string" ||
      typeof customerId !== "string" || typeof method !== "string" ||
      !METHODS.has(method) || !Number.isSafeInteger(amountMinor) ||
      (amountMinor as number) <= 0 || (amountMinor as number) > 100000000 ||
      typeof effectKey !== "string" || !/^[a-zA-Z0-9:_-]{16,180}$/.test(effectKey) ||
      body.manualPaymentConfirmed !== true) {
    return reject("請確認收款方式、實收金額及已收款聲明", 400);
  }

  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return reject("請先登入員工帳號", 401);
  if (identity.status !== "ok" || !canCheckout(identity.membership)) {
    return reject("沒有此組織的儲值結帳權限", 403);
  }

  // The service role is never available to the browser.
  // Production and Preview must be explicitly enabled independently.
  const enabled = process.env.VERCEL_ENV === "production"
    ? process.env.BEAUTY_OS_STORED_VALUE_MANUAL_TOPUP_PRODUCTION === "1"
    : process.env.VERCEL_ENV === "preview"
      && process.env.BEAUTY_OS_STORED_VALUE_MANUAL_TOPUP_TEST === "1";
  if (!enabled) return reject("此環境尚未啟用儲值入帳", 503);
  // Financial records must never be queried or written against the member-booking Supabase project.
  // Keep this server-side guard even if a shared Vercel environment variable is misconfigured.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\/$/, "") !== "https://bfzquejrtgqzzarhkiya.supabase.co") {
    console.error("[stored-value] beauty_os_database_url_mismatch");
    return reject("儲值資料庫連線設定不符", 503);
  }
  const db = createServiceRoleClient();
  if (!db) return reject("儲值資料庫尚未設定", 503);

  // Resolve tenant and customer from canonical rows. app IDs are not canonical UUIDs.
  const { data: org, error: orgError } = await db.from("organizations")
    .select("id").eq("app_id", organizationId).maybeSingle();
  if (orgError || !org?.id || !UUID.test(org.id)) return reject("無法確認正式組織", 409);
  const { data: location, error: locError } = await db.from("locations")
    .select("id").eq("organization_id", org.id).eq("app_id", locationId).eq("is_active", true).maybeSingle();
  if (locError || !location?.id) return reject("分店資料無法驗證", 409);
  const { data: customer, error: custError } = await db.from("customers")
    .select("id").eq("organization_id", org.id).eq("app_id", customerId).eq("status", "ACTIVE").maybeSingle();
  if (custError || !customer?.id) return reject("顧客資料無法驗證", 409);

  // This is the employee's explicit manual receipt attestation. The request
  // is audit-attributed to the authenticated membership, not to a client ID.
  const { data, error } = await db.rpc("post_stored_value_top_up_v1", {
    p_organization_id: org.id,
    p_customer_id: customer.id,
    p_location_id: location.id,
    p_staff_id: identity.membership.userId,
    p_amount_minor: amountMinor,
    p_effect_key: effectKey,
    p_method: method,
  });
  if (error || !Array.isArray(data) || data.length !== 1) {
    console.error("[stored-value-top-up] ledger write failed", error?.code ?? "invalid_response");
    return reject("儲值入帳未確認，請先查詢交易紀錄，勿重新建立交易", 409);
  }
  return NextResponse.json({
    entryId: data[0].entry_id,
    balanceMinor: data[0].balance_minor,
    duplicate: data[0].was_duplicate,
  }, { headers: { "Cache-Control": "no-store" } });
}
