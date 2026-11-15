/**
 * One-time server-side comparison of the booking Supabase project and the
 * finance Supabase project. Uses the service role already configured on the
 * server. Does not use the publishable key. Does not write. The report omits
 * names, phones, and LINE identifiers; those are compared only as booleans.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import {
  crossDbIdentityEvidence,
  type CrossDbIdentitySignals,
} from "@/lib/commerce/stored-value-wallet-identity";
import { normalizePhone } from "@/lib/phone";

const BOOKING_URL = "https://knccefcxncglgpmvgqlp.supabase.co";

type CustomerShape = {
  id: string;
  app_id: string | null;
  status: string;
  organization_id: string;
  full_name?: string | null;
  phone?: string | null;
  line_user_id?: string | null;
};

function digest(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return createHash("sha256").update(trimmed).digest("hex");
}

function nameKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function bookingAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url !== BOOKING_URL || !secret) return null;
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function hashesOverlap(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const item of left) {
    if (right.has(item)) return true;
  }
  return false;
}

async function lineHashes(
  db: SupabaseClient,
  customerId: string,
): Promise<{ hashes: Set<string>; failed: boolean }> {
  const hashes = new Set<string>();
  const binding = await db
    .from("line_customer_bindings")
    .select("line_user_id_hash")
    .eq("customer_uuid", customerId)
    .limit(20);
  if (binding.error) return { hashes, failed: true };
  for (const row of binding.data ?? []) {
    const hash = typeof row.line_user_id_hash === "string" ? row.line_user_id_hash.trim() : "";
    if (hash) hashes.add(hash);
  }
  return { hashes, failed: false };
}

export async function probeBookingFinanceIdentity(customerKey: string): Promise<Record<string, unknown>> {
  const key = customerKey.trim();
  const booking = bookingAdmin();
  const finance = createBeautyOsFinanceClient();
  if (!booking || !finance) {
    return { ok: false, code: "SERVER_CREDENTIALS_UNAVAILABLE" };
  }

  const byId = await booking
    .from("customers")
    .select("id,app_id,status,organization_id,full_name,phone,line_user_id")
    .eq("id", key)
    .limit(2);
  const byApp = await booking
    .from("customers")
    .select("id,app_id,status,organization_id,full_name,phone,line_user_id")
    .eq("app_id", key)
    .limit(2);
  if (byId.error || byApp.error) {
    return { ok: false, code: byId.error?.code ?? byApp.error?.code ?? "BOOKING_CUSTOMER_QUERY_FAILED" };
  }
  const rows = [...(byId.data ?? []), ...(byApp.data ?? [])] as CustomerShape[];
  const unique = new Map(rows.map((row) => [row.id, row]));
  if (unique.size !== 1) {
    return { ok: false, code: unique.size === 0 ? "BOOKING_CUSTOMER_NOT_FOUND" : "BOOKING_CUSTOMER_AMBIGUOUS", matches: unique.size };
  }
  const customer = [...unique.values()][0]!;
  const org = await booking.from("organizations").select("id,app_id").eq("id", customer.organization_id).maybeSingle();
  const appointments = await booking
    .from("appointments")
    .select("id,app_id,status")
    .eq("organization_id", customer.organization_id)
    .eq("customer_id", customer.id)
    .limit(30);
  const bookingLine = await lineHashes(booking, customer.id);
  const lineDigest = digest(customer.line_user_id);
  const orgAppId = typeof org.data?.app_id === "string" ? org.data.app_id : null;
  const appointmentAppIds = (appointments.data ?? [])
    .map((row) => (typeof row.app_id === "string" ? row.app_id.trim() : ""))
    .filter(Boolean);
  const appointmentIds = (appointments.data ?? []).map((row) => String(row.id));

  const financeOrg = orgAppId
    ? await finance.from("organizations").select("id,app_id").eq("app_id", orgAppId).maybeSingle()
    : { data: null, error: null };
  if (financeOrg.error || !financeOrg.data?.id) {
    return {
      ok: false,
      code: financeOrg.error?.code ?? "FINANCE_ORG_NOT_FOUND",
      booking: {
        id: customer.id,
        appId: customer.app_id,
        status: customer.status,
        orgAppId,
        appointmentCount: appointmentIds.length,
      },
    };
  }

  const links = await finance
    .from("customer_wallet_identities")
    .select("booking_customer_id,wallet_customer_id,status")
    .eq("organization_id", financeOrg.data.id)
    .eq("status", "ACTIVE")
    .limit(20);
  if (links.error) {
    return { ok: false, code: links.error.code ?? "FINANCE_LINK_QUERY_FAILED" };
  }
  const linkRows = links.data ?? [];
  const financeIds = [...new Set(linkRows.flatMap((row) => [row.booking_customer_id, row.wallet_customer_id]).filter(Boolean))];
  const financeCustomers = financeIds.length
    ? await finance
        .from("customers")
        .select("id,app_id,status,full_name,phone,line_user_id")
        .eq("organization_id", financeOrg.data.id)
        .in("id", financeIds)
    : { data: [], error: null };
  if (financeCustomers.error) {
    return { ok: false, code: financeCustomers.error.code ?? "FINANCE_CUSTOMER_QUERY_FAILED" };
  }
  const financeById = new Map((financeCustomers.data ?? []).map((row) => [String(row.id), row as CustomerShape]));

  const candidates = [];
  for (const link of linkRows) {
    const financeBooking = financeById.get(String(link.booking_customer_id));
    const financeWallet = financeById.get(String(link.wallet_customer_id));
    if (!financeBooking) continue;
    const financeLine = await lineHashes(finance, financeBooking.id);
    const walletLine = financeWallet ? await lineHashes(finance, financeWallet.id) : { hashes: new Set<string>(), failed: false };
    const financeHashes = new Set([...financeLine.hashes, ...walletLine.hashes]);
    const financeLineDigest = digest(financeBooking.line_user_id);
    const walletLineDigest = digest(financeWallet?.line_user_id);
    if (financeLineDigest) financeHashes.add(financeLineDigest);
    if (walletLineDigest) financeHashes.add(walletLineDigest);
    const bookingHashes = new Set(bookingLine.hashes);
    if (lineDigest) bookingHashes.add(lineDigest);
    const sharedAppointments = appointmentAppIds.length
      ? await finance
          .from("appointments")
          .select("id,app_id")
          .eq("organization_id", financeOrg.data.id)
          .in("app_id", appointmentAppIds.slice(0, 30))
      : { data: [], error: null };
    const signals: CrossDbIdentitySignals = {
      appIdEqual: Boolean(customer.app_id && customer.app_id === financeBooking.app_id),
      lineHashEqual: hashesOverlap(bookingHashes, financeHashes),
      sharedAppointmentCount: sharedAppointments.error ? -1 : (sharedAppointments.data ?? []).length,
      nameEqual: Boolean(nameKey(customer.full_name) && nameKey(customer.full_name) === nameKey(financeBooking.full_name)),
      phoneEqual: Boolean(
        normalizePhone(customer.phone ?? "") &&
          normalizePhone(customer.phone ?? "") === normalizePhone(financeBooking.phone ?? ""),
      ),
    };
    const balance = financeWallet
      ? await finance
          .from("stored_value_ledger_balances")
          .select("ledger_balance_minor")
          .eq("organization_id", financeOrg.data.id)
          .eq("customer_id", financeWallet.id)
          .maybeSingle()
      : { data: null, error: null };
    candidates.push({
      financeBookingId: financeBooking.id,
      financeBookingAppId: financeBooking.app_id,
      financeBookingStatus: financeBooking.status,
      financeWalletId: financeWallet?.id ?? null,
      financeWalletAppId: financeWallet?.app_id ?? null,
      walletBalanceMinor: balance.data?.ledger_balance_minor ?? null,
      evidence: crossDbIdentityEvidence(signals),
      signals,
    });
  }

  const confirmed = candidates.filter((item) => item.evidence);
  return {
    ok: true,
    booking: {
      id: customer.id,
      appId: customer.app_id,
      status: customer.status,
      orgAppId,
      appointmentCount: appointmentIds.length,
      appointmentAppIds: appointmentAppIds.slice(0, 10),
      lineHashCount: bookingLine.hashes.size + (lineDigest ? 1 : 0),
      lineQueryFailed: bookingLine.failed,
    },
    financeOrgAppId: financeOrg.data.app_id,
    activeIdentityCount: linkRows.length,
    confirmedCount: confirmed.length,
    candidates,
  };
}
