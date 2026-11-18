import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { REMOTE_CUSTOMER_COLUMNS, customerFromRemoteRow } from "@/lib/persistence/customer-mapping";
import { dbCustomerFromUnknown } from "@/lib/persistence/authenticated-customer-read-store";

/**
 * Read a stored-value customer's profile from the same dedicated Beauty OS
 * database as the stored-value overview. Never creates or links identities.
 */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const fail = (status: number, message: string) =>
    NextResponse.json({ error: message }, { status, headers });

  const params = new URL(request.url).searchParams;
  const organizationId = params.get("organizationId")?.trim() ?? "";
  const customerId = params.get("customerId")?.trim() ?? "";
  if (!organizationId || organizationId.length > 120 || !customerId || customerId.length > 120) {
    return fail(400, "無效的顧客查詢");
  }

  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return fail(401, "請先登入員工帳號");
  if (identity.status !== "ok" || !canCheckout(identity.membership)) {
    return fail(403, "沒有查看儲值顧客的權限");
  }

  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503, "儲值資料來源無法使用");

  const { data: organization, error: orgError } = await db
    .from("organizations")
    .select("id")
    .eq("app_id", organizationId)
    .limit(2);
  if (orgError) return fail(503, "無法讀取店家資料");
  if (organization?.length !== 1) return fail(404, "找不到目前店家");

  const { data: customers, error: customerError } = await db
    .from("customers")
    .select(REMOTE_CUSTOMER_COLUMNS.join(","))
    .eq("organization_id", organization[0]!.id)
    .eq("app_id", customerId)
    .limit(2);
  if (customerError) return fail(503, "無法讀取顧客資料");
  if (customers?.length !== 1) return fail(404, "找不到此客戶");

  const customerRow = dbCustomerFromUnknown(customers[0] as Record<string, unknown>);
  // This endpoint is deliberately restricted to customers in stored-value
  // management; other customer profiles continue using their existing path.
  const { data: account, error: accountError } = await db
    .from("stored_value_accounts")
    .select("id")
    .eq("organization_id", organization[0]!.id)
    .eq("customer_id", customerRow.id)
    .limit(1);
  if (accountError) return fail(503, "無法確認儲值顧客");
  if (!account?.length) return fail(404, "找不到此儲值顧客");

  // Finance ledger, not the legacy local CRM wallet, is the balance truth.
  const { data: entries, error: ledgerError } = await db
    .from("stored_value_ledger_entries")
    .select("amount_delta_minor")
    .eq("organization_id", organization[0]!.id)
    .eq("account_id", account[0]!.id)
    .limit(10001);
  if (ledgerError || !entries || entries.length === 10001) {
    return fail(503, "無法確認正式儲值餘額");
  }
  const storedValueBalanceMinor = entries.reduce(
    (sum, entry) => sum + Number(entry.amount_delta_minor),
    0,
  );
  if (!Number.isSafeInteger(storedValueBalanceMinor)) {
    return fail(503, "正式儲值餘額格式異常");
  }

  return NextResponse.json({
    customer: customerFromRemoteRow(organizationId, customerRow),
    storedValueBalanceMinor,
  }, { headers });
}
