import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { customerFromRemoteRow } from "@/lib/persistence/customer-mapping";
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
    .select("id,organization_id,app_id,full_name,phone,email,birthday,gender,line_user_id,source,membership_tier,is_vip,primary_staff_id,status,notes,created_at,updated_at")
    .eq("organization_id", organization[0]!.id)
    .eq("app_id", customerId)
    .limit(2);
  if (customerError) return fail(503, "無法讀取顧客資料");
  let resolvedCustomers = customers;
  // Normal customer management may use the booking-system UUID rather than
  // the finance customer's app_id. Resolve only an active, verified source link.
  if (!customers?.length) {
    const { data: links, error: linkError } = await db
      .from("booking_source_customer_links")
      .select("finance_booking_customer_id")
      .eq("organization_id", organization[0]!.id)
      .eq("source_customer_key", customerId)
      .eq("status", "ACTIVE")
      .eq("evidence_kind", "LINE_VERIFIED_SESSION")
      .is("revoked_at", null)
      .limit(2);
    if (linkError) return fail(503, "無法確認預約顧客對應");
    if (links?.length !== 1) return fail(404, "找不到此客戶");
    const { data: mapped, error: mappedError } = await db
      .from("customers")
      .select("id,organization_id,app_id,full_name,phone,email,birthday,gender,line_user_id,source,membership_tier,is_vip,primary_staff_id,status,notes,created_at,updated_at")
      .eq("organization_id", organization[0]!.id)
      .eq("id", links[0]!.finance_booking_customer_id)
      .limit(2);
    if (mappedError) return fail(503, "無法讀取對應顧客");
    if (mapped?.length !== 1) return fail(404, "找不到此客戶");
    resolvedCustomers = mapped;
  }
  if (resolvedCustomers?.length !== 1) return fail(404, "找不到此客戶");

  const customerRow = dbCustomerFromUnknown(resolvedCustomers[0] as Record<string, unknown>);
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

  // Read only this verified finance customer's settled wallet payments.
  const { data: payments, error: paymentError } = await db
    .from("stored_value_ledger_entries")
    .select("transaction_id,amount_delta_minor,created_at")
    .eq("organization_id", organization[0]!.id)
    .eq("account_id", account[0]!.id)
    .eq("type", "PAYMENT")
    .not("transaction_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (paymentError) return fail(503, "無法讀取正式交易紀錄");
  const transactionIds = [...new Set((payments ?? []).map((p) => p.transaction_id).filter((id): id is string => typeof id === "string"))];
  const { data: settled, error: transactionError } = transactionIds.length
    ? await db.from("transactions")
        .select("id,location_id,transaction_number,status,subtotal_minor,discount_total_minor,total_minor,currency,created_by_staff_id,completed_at")
        .eq("organization_id", organization[0]!.id)
        .eq("customer_id", customerRow.id)
        .eq("status", "COMPLETED")
        .in("id", transactionIds)
    : { data: [], error: null };
  if (transactionError) return fail(503, "無法讀取正式交易紀錄");
  const settledById = new Map((settled ?? []).map((tx) => [tx.id, tx]));
  const financeTransactions = (payments ?? []).flatMap((payment) => {
    const tx = settledById.get(payment.transaction_id);
    if (!tx) return [];
    const amount = -Number(payment.amount_delta_minor);
    if (!Number.isSafeInteger(amount) || amount <= 0) return [];
    return [{
      id: tx.id, organizationId, locationId: tx.location_id,
      customerId, transactionNumber: tx.transaction_number, status: "COMPLETED" as const,
      items: [], discounts: [],
      payments: [{ id: tx.id + ":wallet", method: "STORED_VALUE" as const, amount, paidAt: tx.completed_at }],
      subtotal: Number(tx.subtotal_minor), discountTotal: Number(tx.discount_total_minor),
      total: Number(tx.total_minor), currency: tx.currency,
      createdByStaffId: tx.created_by_staff_id, completedAt: tx.completed_at,
    }];
  });

  // Include every wallet movement, including top-ups and manual adjustments.
  // Exclude wallet PAYMENT rows already represented by a completed checkout.
  const { data: allWalletEntries, error: walletHistoryError } = await db
    .from("stored_value_ledger_entries")
    .select("id,type,amount_delta_minor,transaction_id,reason,created_at")
    .eq("organization_id", organization[0]!.id)
    .eq("account_id", account[0]!.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (walletHistoryError) return fail(503, "無法讀取儲值異動紀錄");
  const completedIds = new Set(financeTransactions.map((tx) => tx.id));
  const financeActivity = [
    ...financeTransactions.map((tx) => ({
      id: "checkout:" + tx.id, kind: "CHECKOUT", label: "消費結帳",
      amountMinor: -tx.total, occurredAt: tx.completedAt, transactionId: tx.id,
    })),
    ...(allWalletEntries ?? [])
      .filter((entry) => !entry.transaction_id || !completedIds.has(entry.transaction_id))
      .map((entry) => ({
        id: "wallet:" + entry.id, kind: String(entry.type),
        label: entry.type === "TOP_UP" ? "儲值入帳"
          : entry.type === "PAYMENT" ? "儲值金扣款"
          : entry.type === "REFUND" ? "儲值金退款" : "儲值金調整",
        amountMinor: Number(entry.amount_delta_minor), occurredAt: entry.created_at,
        transactionId: entry.transaction_id,
      })),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return NextResponse.json({
    financeActivity,
    financeTransactions,
    customer: { ...customerFromRemoteRow(organizationId, customerRow), id: customerId },
    storedValueBalanceMinor,
  }, { headers });
}
