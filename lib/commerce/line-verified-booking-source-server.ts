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
  if (!booking || !finance) return { outcome: "unavailable", reasonCode: "CLIENT_CONFIG" };

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
  if (customer.error) return { outcome: "unavailable", reasonCode: "BOOKING_CUSTOMER_QUERY" };

  const bindings: VerifiedLineBinding[] = [];
  if (customer.data?.id) {
    const byCustomer = await booking
      .from("line_customer_bindings")
      .select("line_user_id_hash, status, verified, confirmed_at, bound_at, unbound_at")
      .eq("organization_id", organizationAppId)
      .eq("customer_id", customer.data.id)
      .limit(5);
    const byUuid = await booking
      .from("line_customer_bindings")
      .select("line_user_id_hash, status, verified, confirmed_at, bound_at, unbound_at")
      .eq("organization_id", organizationAppId)
      .eq("customer_uuid", customer.data.id)
      .limit(5);
    const legacy = {
      error: byCustomer.error ?? byUuid.error,
      data: [...(byCustomer.data ?? []), ...(byUuid.data ?? [])],
    };
    if (legacy.error && !identityRelationIsMissing(legacy.error.code)) {
      return { outcome: "unavailable", reasonCode: "BOOKING_LEGACY_QUERY" };
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
        blockedAt: null, // Booking legacy table has no blocked_at column; revocation uses status/unbound_at.
      });
    }
    const memberLinks = await booking
      .from("member_line_customer_links")
      .select("line_subject_hash, verified_at")
      .eq("organization_id", organization.data.id)
      .eq("customer_id", customer.data.id)
      .limit(5);
    if (memberLinks.error && !identityRelationIsMissing(memberLinks.error.code)) {
      return { outcome: "unavailable", reasonCode: "BOOKING_MEMBER_QUERY" };
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
    // Archived or cross-organization customers are not eligible for a
    // checkout source. Do not attempt to enqueue a finance review for them:
    // the review RPC can reject the inactive identity and obscure the
    // actual reason as a transient UNAVAILABLE error.
    if (decision.reason === "ACCOUNT_DISABLED" || decision.reason === "ORG_MISMATCH") {
      return review(decision.reason);
    }
    const financeOrganization = await financeOrganizationId(finance, organizationAppId);
    if (!financeOrganization) return { outcome: "unavailable", reasonCode: "FINANCE_ORG_LOOKUP" };
    const { error } = await finance.rpc(REVIEW_RPC, {
      p_organization_id: financeOrganization,
      p_source_customer_key: sourceCustomerKey,
      p_line_subject_hash: null,
      p_reason_code: decision.reason,
      p_auth_user_id: authUserId,
    });
    if (error) return { outcome: "unavailable", reasonCode: "FINANCE_REVIEW_RPC" };
    return review(decision.reason);
  }

  // A verified LINE subject alone is not sufficient to authorize a cross-database
  // checkout link. Require the separately confirmed booking/finance identity pair,
  // an active wallet mapping, and matching current finance LINE evidence.
  const financeOrg = await financeOrganizationId(finance, organizationAppId);
  if (!financeOrg || !customer.data?.id) return review("NO_TRUSTED_ASSOCIATION");
  const pairs = await finance.from("member_booking_finance_identity_links")
    .select("finance_customer_id,finance_confirmation_id")
    .eq("organization_id", financeOrg)
    .eq("booking_organization_id", organization.data.id)
    .eq("booking_customer_id", customer.data.id)
    .is("revoked_at", null).limit(2);
  if (pairs.error) return { outcome: "unavailable", reasonCode: "FINANCE_PAIR_QUERY" };
  if (pairs.data?.length === 0) {
    // First-time LINE-only member: no historical cross-database pair.
    // Refuse any legacy binding, revoked pair, duplicate subject, or
    // pre-existing checkout source. Never infer identity from name/phone.
    const [bookingOwners,financeOwners,legacy,allPairs,sourceLinks] = await Promise.all([
      booking.from("member_line_customer_links").select("customer_id,verified_at")
        .eq("organization_id",organization.data.id).eq("line_subject_hash",decision.hash).limit(2),
      finance.from("member_line_customer_links").select("customer_id,verified_at")
        .eq("organization_id",financeOrg).eq("line_subject_hash",decision.hash).limit(2),
      finance.from("line_customer_bindings").select("id")
        .eq("organization_id",organizationAppId).eq("line_user_id_hash",decision.hash).limit(2),
      finance.from("member_booking_finance_identity_links").select("id")
        .eq("organization_id",financeOrg).eq("booking_customer_id",customer.data.id).limit(2),
      finance.from("booking_source_customer_links").select("id")
        .eq("organization_id",financeOrg).eq("source_customer_key",sourceCustomerKey).limit(2),
    ]);
    if (bookingOwners.error||financeOwners.error||legacy.error||allPairs.error||sourceLinks.error)
      return {outcome:"unavailable",reasonCode:"FIRST_TIME_IDENTITY_QUERY"};
    if (bookingOwners.data?.length!==1||bookingOwners.data[0].customer_id!==customer.data.id||
        !bookingOwners.data[0].verified_at||financeOwners.data?.length!==1||
        !financeOwners.data[0].verified_at||legacy.data?.length!==0||
        allPairs.data?.length!==0||sourceLinks.data?.length!==0)
      return review("NO_TRUSTED_ASSOCIATION");
    const financeCustomerId=financeOwners.data[0].customer_id;
    const [financeCustomer,otherPairs,challenges,wallet] = await Promise.all([
      finance.from("customers").select("id,status").eq("organization_id",financeOrg).eq("id",financeCustomerId).maybeSingle(),
      finance.from("member_booking_finance_identity_links").select("id")
        .eq("organization_id",financeOrg).eq("finance_customer_id",financeCustomerId).limit(2),
      finance.from("member_finance_binding_challenges").select("id")
        .eq("organization_id",financeOrg).eq("line_subject_hash",decision.hash).limit(2),
      finance.from("customer_wallet_identities").select("id")
        .eq("organization_id",financeOrg).or(`booking_customer_id.eq.${financeCustomerId},wallet_customer_id.eq.${financeCustomerId}`).limit(2),
    ]);
    if(financeCustomer.error||otherPairs.error||challenges.error||wallet.error)
      return {outcome:"unavailable",reasonCode:"FIRST_TIME_FINANCE_QUERY"};
    if(financeCustomer.data?.status!=="ACTIVE"||otherPairs.data?.length!==0||
       challenges.data?.length!==0||wallet.data?.length!==0)
      return review("NO_TRUSTED_ASSOCIATION");
    const linked=await finance.rpc(LINK_RPC,{
      p_organization_app_id:organizationAppId,
      p_source_customer_key:sourceCustomerKey,
      p_line_subject_hash:decision.hash,
      p_auth_user_id:authUserId,
    });
    if(linked.error||!linked.data||typeof linked.data!=="object")
      return {outcome:"unavailable",reasonCode:"FINANCE_LINK_RPC"};
    const outcome=String((linked.data as {outcome?:unknown}).outcome??"");
    return outcome==="linked"||outcome==="already_linked"
      ? {outcome,reasonCode:"FIRST_TIME_VERIFIED_LINE"}
      : review("NO_TRUSTED_ASSOCIATION");
  }
  if (pairs.data?.length !== 1) return review("NO_TRUSTED_ASSOCIATION");
  const pair = pairs.data[0];
  const confirmation = await finance.from("member_finance_binding_challenges")
    .select("id").eq("id", pair.finance_confirmation_id)
    .eq("organization_id", financeOrg)
    .eq("confirmed_customer_id", pair.finance_customer_id)
    .eq("status", "CONFIRMED").not("confirmed_at", "is", null).maybeSingle();
  if (confirmation.error) return { outcome: "unavailable", reasonCode: "FINANCE_CONFIRMATION_QUERY" };
  if (!confirmation.data) return review("NO_TRUSTED_ASSOCIATION");
  const financeLine = await finance.from("member_line_customer_links")
    .select("line_subject_hash,verified_at").eq("organization_id", financeOrg)
    .eq("customer_id", pair.finance_customer_id).limit(2);
  if (financeLine.error) return { outcome: "unavailable", reasonCode: "FINANCE_LINE_QUERY" };
  if (financeLine.data?.length !== 1 ||
      financeLine.data[0].line_subject_hash !== decision.hash ||
      !financeLine.data[0].verified_at) return review("NO_TRUSTED_ASSOCIATION");
  const wallet = await finance.from("customer_wallet_identities")
    .select("booking_customer_id").eq("organization_id", financeOrg)
    .eq("wallet_customer_id", pair.finance_customer_id)
    .eq("status", "ACTIVE").limit(2);
  if (wallet.error) return { outcome: "unavailable", reasonCode: "FINANCE_WALLET_QUERY" };
  if (wallet.data?.length !== 1) return review("NO_TRUSTED_ASSOCIATION");

  const linked = await finance.rpc(LINK_RPC, {
    p_organization_app_id: organizationAppId,
    p_source_customer_key: sourceCustomerKey,
    p_line_subject_hash: decision.hash,
    p_auth_user_id: authUserId,
  });
  if (linked.error || !linked.data || typeof linked.data !== "object") {
    // Only PostgreSQL/PostgREST diagnostic codes are logged. Never log
    // identities, LINE hashes, RPC arguments or raw database messages.
    console.error("[commerce/checkout] finance_link_rpc_failed", {
      dbCode: linked.error?.code ?? "NO_RESPONSE",
      hasData: Boolean(linked.data),
    });
    return { outcome: "unavailable", reasonCode: "FINANCE_LINK_RPC" };
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
