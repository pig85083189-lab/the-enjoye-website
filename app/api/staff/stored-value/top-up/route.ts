import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";

/**
 * Stored-value top-up admission endpoint.
 * Never accept a client-side "paid" boolean as evidence of settlement.
 * Posting remains disabled until the canonical server-side payment receipt and
 * operational staff identity are mapped to the Supabase ledger transaction.
 */
export async function POST(request: Request) {
  const identity = await getAuthenticatedStaffMembership();
  if (identity.status === "unauthenticated") {
    return NextResponse.json({ error: "請先登入員工帳號" }, { status: 401 });
  }
  if (identity.status !== "resolved" || !identity.membership ||
      !canCheckout(identity.membership)) {
    return NextResponse.json({ error: "沒有儲值結帳權限" }, { status: 403 });
  }
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "請使用 JSON 格式" }, { status: 415 });
  }
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: "無效的請求資料" }, { status: 400 }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "無效的儲值資料" }, { status: 400 });
  }
  // Fail closed: localStorage checkout completion is not authoritative proof of payment.
  // Do not call the ledger RPC until the server has independently verified a
  // completed, organization-scoped transaction and its payment settlement.
  return NextResponse.json({
    error: "正式儲值尚未啟用：等待伺服器端付款憑證及顧客 ID 對應驗證",
    code: "STORED_VALUE_SETTLEMENT_NOT_READY",
  }, { status: 503 });
}
