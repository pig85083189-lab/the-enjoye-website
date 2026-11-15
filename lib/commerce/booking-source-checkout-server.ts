/**
 * Server-only checkout resolution. The browser sends the booking draft id.
 * The finance customer comes from booking_source_customer_links, never from the request.
 */

import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { createClient } from "@/lib/supabase/server";

type QueryError = { message: string; code?: string } | null;

type BookingClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: QueryError }>;
        limit(count: number): Promise<{ data: Record<string, unknown>[] | null; error: QueryError }>;
      };
    };
  };
};

export function sourceCustomerKey(row: { id?: unknown; app_id?: unknown }): string {
  const appId = typeof row.app_id === "string" ? row.app_id.trim() : "";
  if (appId) return appId;
  return typeof row.id === "string" ? row.id.trim() : "";
}

export async function readBookingCheckoutSource(draftAppId: string): Promise<{
  sourceCustomerKey: string;
  organizationAppId: string;
  locationAppId: string;
  organizationId: string;
  checkoutAppId: string;
} | null> {
  const booking = (await createClient()) as unknown as BookingClient;
  const draft = await booking
    .from("checkout_drafts")
    .select("app_id, customer_id, organization_id, location_id")
    .eq("app_id", draftAppId)
    .maybeSingle();
  if (draft.error || !draft.data?.customer_id || !draft.data.organization_id || !draft.data.location_id) {
    return null;
  }
  const customer = await booking
    .from("customers")
    .select("id, app_id")
    .eq("id", String(draft.data.customer_id))
    .maybeSingle();
  const organization = await booking
    .from("organizations")
    .select("id, app_id")
    .eq("id", String(draft.data.organization_id))
    .maybeSingle();
  const location = await booking
    .from("locations")
    .select("id, app_id")
    .eq("id", String(draft.data.location_id))
    .maybeSingle();
  const sourceKey = customer.data ? sourceCustomerKey(customer.data) : "";
  const organizationAppId = typeof organization.data?.app_id === "string" ? organization.data.app_id.trim() : "";
  const locationAppId = typeof location.data?.app_id === "string" ? location.data.app_id.trim() : "";
  if (!sourceKey || !organizationAppId || !organization.data?.id) return null;
  return {
    sourceCustomerKey: sourceKey,
    organizationAppId,
    locationAppId,
    organizationId: String(organization.data.id),
    checkoutAppId: draftAppId,
  };
}

export async function callBookingSourceCheckout(
  fn: "open_booking_source_checkout" | "save_booking_source_checkout" | "settle_booking_source_checkout",
  input: {
    organizationAppId: string;
    sourceCustomerKey: string;
    checkoutAppId: string;
    locationAppId: string;
    amount: number;
    staffId: string;
  },
): Promise<{ effectKey?: string; balanceMinor?: number; replayed?: boolean }> {
  const finance = createBeautyOsFinanceClient();
  if (!finance) throw new Error("目前無法完成結帳，請稍後再試");
  const { data, error } = await finance.rpc(fn, {
    p_organization_app_id: input.organizationAppId,
    p_source_customer_key: input.sourceCustomerKey,
    p_checkout_app_id: input.checkoutAppId,
    p_location_app_id: input.locationAppId,
    p_amount: input.amount,
    p_staff_id: input.staffId,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as { effectKey?: string; balanceMinor?: number; replayed?: boolean };
  return row;
}
