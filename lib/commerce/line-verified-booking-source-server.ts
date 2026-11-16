import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { identityRelationIsMissing } from "@/lib/commerce/stored-value-wallet-identity";
import {
  decideVerifiedLineSubject,
  type LineBindingReviewReason,
  type VerifiedLineBinding,
} from "@/lib/commerce/line-verified-booking-source";

export type LineBookingSourceResult = {
  outcome: "linked" | "already_linked" | "review" | "unavailable";
  reasonCode: string;
};

const REVIEW_RPC = "enqueue_member_binding_review";
const LINK_RPC = "link_booking_source_from_verified_line";

function review(reason: LineBindingReviewReason): LineBookingSourceResult {
  return { outcome: "review", reasonCode: reason };
}

/**
 * Staff-triggered sync from an existing verified LINE binding.
 * This is not a LINE OAuth callback. The caller cannot supply a finance
 * customer id or a LINE hash.
 */
export async function linkVerifiedLineBookingSource(input: {
  organizationAppId: string;
  sourceCustomerKey: string;
  authUserId: string;
}): Promise<LineBookingSourceResult> {
  const organizationAppId = input.organizationAppId.trim();
  const sourceCustomerKey = input.sourceCustomerKey.trim();
  const authUserId = input.authUserId.trim();
  if (!organizationAppId || !sourceCustomerKey || !authUserId) return review("NO_TRUSTED_ASSOCIATION");
  const booking = createServiceRoleClient();
  const finance = createBeautyOsFinanceClient();
  if (!booking || !finance) return { outcome: "unavailable", reasonCode: "UNAVAILABLE" };

  const organization = await booking
    .from("organizations")
    .select("id, app_id")
    .eq("app_id", organizationAppId)
    .maybeSingle();
  if (organization.error || !organization.data?.id) return review("ORG_MISMATCH");

  const sourceIsUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    sourceCustomerKey,
  );
  const byId = sourceIsUuid
    ? await booking
        .from("customers")
        .select("id, app_id, status, organization_id")
        .eq("id", sourceCustomerKey)
        .maybeSingle()
    : { data: null, error: null };
  const customer = byId.data
    ? byId
    : await booking
        .from("customers")
        .select("id, app_id, status, organization_id")
        .eq("app_id", sourceCustomerKey)
        .eq("organization_id", organization.data.id)
        .maybeSingle();
  if (customer.error) return { outcome: "unavailable", reasonCode: "UNAVAILABLE" };

  const bindings: VerifiedLineBinding[] = [];
  if (customer.data?.id) {
    const byCustomer = await booking
      .from("line_customer_bindings")
      .select("line_user_id_hash, status, verified, confirmed_at, bound_at, unbound_at, blocked_at")
      .eq("organization_id", organizationAppId)
      .eq("customer_id", customer.data.id)
      .limit(5);
    const byUuid = await booking
      .from("line_customer_bindings")
      .select("line_user_id_hash, status, verified, confirmed_at, bound_at, unbound_at, blocked_at")
      .eq("organization_id", organizationAppId)
      .eq("customer_uuid", customer.data.id)
      .limit(5);
    const legacy = {
      error: byCustomer.error ?? byUuid.error,
      data: [...(byCustomer.data ?? []), ...(byUuid.data ?? [])],
    };
    if (legacy.error && !identityRelationIsMissing(legacy.error.code)) {
      return { outcome: "unavailable", reasonCode: "UNAVAILABLE" };
    }
    for (const row of legacy.data ?? []) {
      bindings.push({
        source: "binding",
        hash: typeof row.line_user_id_hash === "string" ? row.line_user_id_hash : null,
        verified: row.verified === true,
        status: String(row.status ?? ""),
        confirmedAt: row.confirmed_at,
        boundAt: row.bound_at,
        unboundAt: row.unbound_at,
        blockedAt: row.blocked_at,
      });
    }
    const memberLinks = await booking
      .from("member_line_customer_links")
      .select("line_subject_hash, verified_at")
      .eq("organization_id", organization.data.id)
      .eq("customer_id", customer.data.id)
      .limit(5);
    if (memberLinks.error && !identityRelationIsMissing(memberLinks.error.code)) {
      return { outcome: "unavailable", reasonCode: "UNAVAILABLE" };
    }
    for (const row of memberLinks.data ?? []) {
      bindings.push({
        source: "member_link",
        hash: typeof row.line_subject_hash === "string" ? row.line_subject_hash : null,
        verified: Boolean(row.verified_at),
        status: row.verified_at ? "active" : "pending",
        confirmedAt: row.verified_at,
        boundAt: row.verified_at,
        unboundAt: null,
        blockedAt: null,
      });
    }
  }

  const decision = decideVerifiedLineSubject({
    organizationAppId,
    customerOrganizationAppId: customer.data?.organization_id === organization.data.id ? organizationAppId : null,
    customerStatus: customer.data?.status ?? null,
    bindings,
  });

  if (decision.outcome === "review") {
    const financeOrganization = await financeOrganizationId(finance, organizationAppId);
    if (!financeOrganization) return { outcome: "unavailable", reasonCode: "UNAVAILABLE" };
    const { error } = await finance.rpc(REVIEW_RPC, {
      p_organization_id: financeOrganization,
      p_source_customer_key: sourceCustomerKey,
      p_line_subject_hash: null,
      p_reason_code: decision.reason,
      p_auth_user_id: authUserId,
    });
    if (error) return { outcome: "unavailable", reasonCode: "UNAVAILABLE" };
    return review(decision.reason);
  }

  const linked = await finance.rpc(LINK_RPC, {
    p_organization_app_id: organizationAppId,
    p_source_customer_key: sourceCustomerKey,
    p_line_subject_hash: decision.hash,
    p_auth_user_id: authUserId,
  });
  if (linked.error || !linked.data || typeof linked.data !== "object") {
    return { outcome: "unavailable", reasonCode: "UNAVAILABLE" };
  }
  const outcome = String((linked.data as { outcome?: unknown }).outcome ?? "");
  const reasonCode = String((linked.data as { reasonCode?: unknown }).reasonCode ?? "");
  if (outcome === "linked" || outcome === "already_linked" || outcome === "review") {
    return { outcome, reasonCode };
  }
  return { outcome: "unavailable", reasonCode: "UNAVAILABLE" };
}

async function financeOrganizationId(
  finance: NonNullable<ReturnType<typeof createBeautyOsFinanceClient>>,
  organizationAppId: string,
): Promise<string | null> {
  const { data, error } = await finance
    .from("organizations")
    .select("id")
    .eq("app_id", organizationAppId)
    .maybeSingle();
  if (error || !data?.id) return null;
  return data.id;
}
