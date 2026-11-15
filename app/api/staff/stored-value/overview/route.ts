import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";

export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  const headers = { "Cache-Control": "private, no-store" };
  const fail = (status: number) => NextResponse.json({ error: "無法讀取正式儲值紀錄" }, { status, headers });
  if (!organizationId || organizationId.length > 120) return fail(400);
  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return fail(401);
  if (identity.status !== "ok" || !canCheckout(identity.membership)) return fail(403);
  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503);
  const { data: org, error: orgError } = await db.from("organizations").select("id").eq("app_id", organizationId).maybeSingle();
  if (orgError || !org?.id) return fail(409);
  const { data: accounts, error: accountsError } = await db.from("stored_value_accounts")
    .select("id,customer_id,status,currency,created_at,updated_at").eq("organization_id", org.id);
  if (accountsError || !accounts) return fail(503);
  if (accounts.length === 0) return NextResponse.json({ accounts: [], ledger: [], customers: [] }, { headers });
  const customerIds = accounts.map(a => a.customer_id);
  const { data: customers, error: customersError } = await db.from("customers")
    .select("id,app_id,full_name,phone").eq("organization_id", org.id).in("id", customerIds);
  if (customersError || !customers) return fail(503);
  const { data: ledger, error: ledgerError } = await db.from("stored_value_ledger_entries")
    .select("id,account_id,customer_id,type,amount_delta_minor,created_at,created_by_staff_id,transaction_id,appointment_id,location_id,reason,effect_key,reverses_entry_id")
    .eq("organization_id", org.id).order("created_at", { ascending: true }).limit(10000);
  if (ledgerError || !ledger || ledger.length === 10000) return fail(503);
  const customerByUuid = new Map(customers.map(c => [c.id, c]));
  if (accounts.some(a => !customerByUuid.get(a.customer_id)?.app_id)) return fail(503);
  return NextResponse.json({
    accounts: accounts.map(a => ({ id: a.id, organizationId, customerId: customerByUuid.get(a.customer_id)!.app_id, status: a.status, currency: a.currency, createdAt: a.created_at, updatedAt: a.updated_at })),
    customers: customers.filter(c => c.app_id).map(c => ({ id: c.app_id, name: c.full_name ?? "", phone: c.phone ?? "" })),
    ledger: ledger.map(e => ({
      id: e.id, organizationId, accountId: e.account_id,
      customerId: customerByUuid.get(e.customer_id)?.app_id ?? "",
      type: e.type, amountDelta: Number(e.amount_delta_minor), createdAt: e.created_at,
      createdByStaffId: e.created_by_staff_id,
      transactionId: e.transaction_id ?? undefined, appointmentId: e.appointment_id ?? undefined,
      locationId: e.location_id ?? undefined, reason: e.reason ?? undefined,
      effectKey: e.effect_key ?? undefined, reversesEntryId: e.reverses_entry_id ?? undefined,
    })),
  }, { headers });
}
