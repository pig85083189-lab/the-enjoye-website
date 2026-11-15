import { NextResponse } from "next/server";
import { isBookingSourceEvidence } from "@/lib/commerce/booking-source-customer";
import { sourceCustomerKey } from "@/lib/commerce/booking-source-checkout-server";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { createClient } from "@/lib/supabase/server";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

function fail(status: number, message: string) {
  return NextResponse.json({ message }, { status, headers });
}

async function requireManager(organizationId: string) {
  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return { error: fail(401, "沒有權限建立顧客身分對應") };
  if (identity.status !== "ok") return { error: fail(403, "沒有權限建立顧客身分對應") };
  const role = identity.membership.role;
  if (!identity.membership.isActive || (role !== "OWNER" && role !== "MANAGER")) {
    return { error: fail(403, "沒有權限建立顧客身分對應") };
  }
  const actor = await getServerStaffAuthUser();
  if (!actor || actor.id !== identity.membership.authUserId) {
    return { error: fail(403, "沒有權限建立顧客身分對應") };
  }
  return { identity, actor };
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "沒有權限建立顧客身分對應");
  }
  if ("financeCustomerId" in body || "walletCustomerId" in body) {
    return fail(400, "沒有權限建立顧客身分對應");
  }
  const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";
  const sourceCustomerKeyInput = typeof body.sourceCustomerKey === "string" ? body.sourceCustomerKey.trim() : "";
  const financeBookingCustomerAppId =
    typeof body.financeBookingCustomerAppId === "string" ? body.financeBookingCustomerAppId.trim() : "";
  const evidenceKind = typeof body.evidenceKind === "string" ? body.evidenceKind : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!organizationId || !sourceCustomerKeyInput || !financeBookingCustomerAppId || !isBookingSourceEvidence(evidenceKind)) {
    return fail(400, "沒有權限建立顧客身分對應");
  }
  if (reason.length < 8 || reason.length > 200) return fail(400, "請填寫身分對應原因");
  const manager = await requireManager(organizationId);
  if ("error" in manager && manager.error) return manager.error;
  if (!("identity" in manager)) return fail(403, "沒有權限建立顧客身分對應");

  const booking = await createClient();
  const byId = await booking
    .from("customers")
    .select("id, app_id, status, organization_id")
    .eq("id", sourceCustomerKeyInput)
    .maybeSingle();
  const byApp = byId.data
    ? byId
    : await booking
        .from("customers")
        .select("id, app_id, status, organization_id")
        .eq("app_id", sourceCustomerKeyInput)
        .maybeSingle();
  if (byApp.error || !byApp.data || byApp.data.status !== "ACTIVE") return fail(404, "顧客帳號無效");
  const organization = await booking
    .from("organizations")
    .select("id, app_id")
    .eq("id", byApp.data.organization_id)
    .maybeSingle();
  if (organization.error || organization.data?.app_id !== organizationId) return fail(403, "沒有權限建立顧客身分對應");
  const resolvedKey = sourceCustomerKey(byApp.data);
  if (resolvedKey !== sourceCustomerKeyInput) return fail(400, "顧客帳號無效");

  const finance = createBeautyOsFinanceClient();
  if (!finance) return fail(503, "目前無法完成結帳，請稍後再試");
  const { error } = await finance.rpc("confirm_booking_source_customer_link", {
    p_organization_app_id: organizationId,
    p_source_customer_key: resolvedKey,
    p_finance_booking_customer_app_id: financeBookingCustomerAppId,
    p_evidence_kind: evidenceKind,
    p_reason: reason,
    p_confirmed_by_auth_user_id: manager.actor.id,
    p_confirmed_by_staff_id: manager.identity.membership.userId,
  });
  if (error) return fail(409, "沒有權限建立顧客身分對應");
  return NextResponse.json({ confirmed: true }, { headers });
}
