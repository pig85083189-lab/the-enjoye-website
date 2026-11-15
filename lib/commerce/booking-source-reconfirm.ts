import { createClient } from "@supabase/supabase-js";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { tryGetSupabaseEnv, tryGetSupabaseServiceRoleKey } from "@/lib/supabase/env";

const BOOKING_URL = "https://knccefcxncglgpmvgqlp.supabase.co";
const BOOKING_CUSTOMER_ID = "e06709d5-893f-4be1-8d83-b3d666a9257c";
const FINANCE_BOOKING_APP_ID = "cust-musfocyt-3x0fpe";
const FINANCE_BOOKING_ID = "bceef2c0-4555-41b2-9d1e-b999d604fa81";
const FINANCE_WALLET_APP_ID = "cust-line-a6cd6d968c4747c39229bc1deb985559";
const FINANCE_WALLET_ID = "a6cd6d96-8c47-47c3-9229-bc1deb985559";
const ORG_APP_ID = "org-the-enjoye";

/** One-shot production read. Logs booleans and the ledger total only. */
export async function reconfirmBookingSource(): Promise<void> {
  const env = tryGetSupabaseEnv();
  const bookingKey = tryGetSupabaseServiceRoleKey();
  const finance = createBeautyOsFinanceClient();
  if (!env || !bookingKey || env.url.replace(/\/$/, "") !== BOOKING_URL || !finance) {
    console.error("[booking-source-reconfirm]", { ready: false });
    return;
  }
  const booking = createClient(BOOKING_URL, bookingKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const customer = await booking.from("customers").select("id, app_id, status, organization_id").eq("id", BOOKING_CUSTOMER_ID).maybeSingle();
  const organization = customer.data?.organization_id
    ? await booking.from("organizations").select("id, app_id").eq("id", customer.data.organization_id).maybeSingle()
    : { data: null, error: null };
  const appointments = await booking.from("appointments").select("id", { count: "exact", head: true }).eq("customer_id", BOOKING_CUSTOMER_ID);
  const financeOrg = await finance.from("organizations").select("id, app_id").eq("app_id", ORG_APP_ID).maybeSingle();
  const financeBooking = financeOrg.data?.id
    ? await finance.from("customers").select("id, app_id, status, organization_id").eq("app_id", FINANCE_BOOKING_APP_ID).maybeSingle()
    : { data: null, error: null };
  const financeWallet = financeOrg.data?.id
    ? await finance.from("customers").select("id, app_id, status, organization_id").eq("app_id", FINANCE_WALLET_APP_ID).maybeSingle()
    : { data: null, error: null };
  const identity = financeOrg.data?.id
    ? await finance.from("customer_wallet_identities")
      .select("id, status, booking_customer_id, wallet_customer_id")
      .eq("organization_id", financeOrg.data.id)
      .eq("status", "ACTIVE")
    : { data: null, error: null };
  const line = financeWallet.data?.id
    ? await finance.from("member_line_customer_links")
      .select("customer_id, verified_at")
      .eq("customer_id", financeWallet.data.id)
      .not("verified_at", "is", null)
      .limit(1)
    : { data: null, error: null };
  const account = financeWallet.data?.id
    ? await finance.from("stored_value_accounts")
      .select("id, status, currency")
      .eq("customer_id", financeWallet.data.id)
      .eq("status", "ACTIVE")
      .eq("currency", "TWD")
      .maybeSingle()
    : { data: null, error: null };
  const balance = account.data?.id
    ? await finance.from("stored_value_ledger_balances")
      .select("ledger_balance_minor")
      .eq("account_id", account.data.id)
      .maybeSingle()
    : { data: null, error: null };
  const activeIdentity = (identity.data ?? []).filter((row) =>
    row.booking_customer_id === financeBooking.data?.id && row.wallet_customer_id === financeWallet.data?.id,
  );
  console.error("[booking-source-reconfirm]", {
    ready: true,
    bookingCustomerActive: customer.data?.status === "ACTIVE",
    bookingAppIdBlank: customer.data?.app_id == null || String(customer.data.app_id).trim() === "",
    bookingOrg: organization.data?.app_id === ORG_APP_ID,
    appointmentCount: appointments.count,
    financeBookingMatches: financeBooking.data?.id === FINANCE_BOOKING_ID && financeBooking.data.status === "ACTIVE",
    financeWalletMatches: financeWallet.data?.id === FINANCE_WALLET_ID && financeWallet.data.status === "ACTIVE",
    sameOrganization: Boolean(
      financeOrg.data?.id &&
      financeBooking.data?.organization_id === financeOrg.data.id &&
      financeWallet.data?.organization_id === financeOrg.data.id,
    ),
    walletIdentityActive: activeIdentity.length === 1,
    lineVerified: Boolean(line.data?.length),
    accountActive: account.data?.status === "ACTIVE" && account.data.currency === "TWD",
    ledgerBalanceMinor: balance.data?.ledger_balance_minor ?? null,
    queryFailed: Boolean(customer.error || appointments.error || financeBooking.error || financeWallet.error || identity.error || line.error || account.error || balance.error),
  });
}
