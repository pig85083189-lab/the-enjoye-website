import { NextResponse } from "next/server";
import { linkVerifiedLineBookingSource } from "@/lib/commerce/line-verified-booking-source-server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const REJECTED_FIELDS = [
  "financeCustomerId",
  "financeBookingCustomerId",
  "financeBookingCustomerAppId",
  "walletCustomerId",
  "lineUserId",
  "lineSubjectHash",
  "fullName",
  "phone",
] as const;

function fail(status: number, message: string) {
  return NextResponse.json({ message }, { status, headers });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail(401, "沒有權限建立顧客身分對應");
  }
  if (REJECTED_FIELDS.some((field) => field in body)) return fail(400, "沒有權限建立顧客身分對應");
  const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";
  const sourceCustomerKey = typeof body.sourceCustomerKey === "string" ? body.sourceCustomerKey.trim() : "";
  if (!organizationId || !sourceCustomerKey) return fail(400, "沒有權限建立顧客身分對應");

  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return fail(401, "沒有權限建立顧客身分對應");
  if (identity.status !== "ok" || !identity.membership.isActive || !canCheckout(identity.membership)) {
    return fail(403, "沒有權限建立顧客身分對應");
  }
  const actor = await getServerStaffAuthUser();
  if (!actor || actor.id !== identity.membership.authUserId) return fail(403, "沒有權限建立顧客身分對應");

  const result = await linkVerifiedLineBookingSource({
    organizationAppId: organizationId,
    sourceCustomerKey,
    authUserId: actor.id,
  });
  if (result.outcome === "unavailable") return fail(503, "目前無法完成結帳，請稍後再試");
  return NextResponse.json(
    { outcome: result.outcome, reasonCode: result.reasonCode },
    { headers },
  );
}
