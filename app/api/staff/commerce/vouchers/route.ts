import { readBookingCheckoutSource } from "@/lib/commerce/booking-source-checkout-server";
import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { resolveBookingSourceFinanceCustomer } from "@/lib/commerce/booking-source-customer";
import { lineMembershipIsCurrent, type VerifiedLineBinding } from "@/lib/commerce/line-verified-booking-source";
import {
  checkoutCustomerKeyIsDbId,
  chooseCheckoutCustomer,
  identityRelationIsMissing,
  resolveStoredValueWalletCustomer,
  type CheckoutCustomerRow,
} from "@/lib/commerce/stored-value-wallet-identity";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const organizationId = params.get("organizationId");
  const draftId = params.get("draftId");
  const source = draftId && draftId.length <= 120 ? await readBookingCheckoutSource(draftId) : null;
  const customerId = source?.organizationAppId === organizationId ? source.sourceCustomerKey : null;
  const headers = { "Cache-Control": "private, no-store" };
  const fail = (status: number, code: string) =>
    NextResponse.json({ error: "無法查詢電子票券", code }, { status, headers });
  if (!organizationId || organizationId.length > 120 || !customerId || customerId.length > 120) return fail(400, "INVALID_INPUT");
  const identity = await getAuthenticatedStaffMembership({ organizationId });
  if (identity.status === "unauthenticated") return fail(401, "UNAUTHENTICATED");
  if (identity.status !== "ok" || !canCheckout(identity.membership)) return fail(403, "FORBIDDEN");
  const db = createBeautyOsFinanceClient();
  if (!db) return fail(503, "CONFIG_MISSING");
  const { data: org, error: orgError } = await db.from("organizations").select("id").eq("app_id", organizationId).maybeSingle();
  if (orgError || !org?.id) return fail(409, "ORG_NOT_FOUND");
  const toCustomerRow = (row: { id?: string; app_id?: string | null; status?: string }): CheckoutCustomerRow | null =>
    row.id && row.status ? { id: row.id, appId: row.app_id ?? null, status: row.status } : null;
  const { data: appRows, error: appError } = await db.from("customers")
    .select("id, app_id, status").eq("organization_id", org.id).eq("app_id", customerId).limit(2);
  if (appError) return fail(404, "CUSTOMER_NOT_FOUND");
  const appIdMatches = (appRows ?? []).map(toCustomerRow).filter((row): row is CheckoutCustomerRow => Boolean(row));
  let idMatches: CheckoutCustomerRow[] = [];
  if (appIdMatches.length === 0 && checkoutCustomerKeyIsDbId(customerId)) {
    const { data: idRows, error: idError } = await db.from("customers")
      .select("id, app_id, status").eq("organization_id", org.id).eq("id", customerId).limit(2);
    if (idError) return fail(404, "CUSTOMER_NOT_FOUND");
    idMatches = (idRows ?? []).map(toCustomerRow).filter((row): row is CheckoutCustomerRow => Boolean(row));
  }
  let customer = chooseCheckoutCustomer({ checkoutCustomerKey: customerId, appIdMatches, idMatches });
  if (!customer) {
    const { data: linkRows, error: linkError } = await db.from("booking_source_customer_links")
      .select("organization_id, source_customer_key, finance_booking_customer_id, status, evidence_kind")
      .eq("organization_id", org.id)
      .eq("source_customer_key", customerId.trim())
      .eq("status", "ACTIVE")
      .limit(2);
    if (linkError && identityRelationIsMissing(linkError.code)) return fail(404, "CUSTOMER_NOT_FOUND");
    if (linkError) {
      console.error("[stored-value/balance] source_link_lookup_failed", { code: linkError.code });
      return fail(503, "LINK_LOOKUP_FAILED");
    }
    const financeCustomerId = resolveBookingSourceFinanceCustomer({
      organizationId: org.id,
      sourceCustomerKey: customerId,
      links: (linkRows ?? []).map((row) => ({
        organizationId: String(row.organization_id ?? ""),
        sourceCustomerKey: String(row.source_customer_key ?? ""),
        financeBookingCustomerId: String(row.finance_booking_customer_id ?? ""),
        status: String(row.status ?? ""),
        evidenceKind: String(row.evidence_kind ?? ""),
      })),
    });
    let resolvedFinanceId = financeCustomerId;
    if (!resolvedFinanceId && checkoutCustomerKeyIsDbId(customerId)) {
      // The member booking database and finance database use distinct customer UUIDs.
      // A staff balance read may bridge only a confirmed, non-revoked pair.
      const { data: pairs, error: pairError } = await db.from("member_booking_finance_identity_links")
        .select("finance_customer_id,finance_confirmation_id")
        .eq("organization_id",org.id)
        .eq("booking_customer_id",customerId.trim())
        .is("revoked_at",null).limit(2);
      if (pairError) return fail(503,"IDENTITY_LOOKUP_FAILED");
      if (pairs?.length===1) {
        const pair=pairs[0];
        const { data: confirmation,error: confirmationError }=await db.from("member_finance_binding_challenges")
          .select("id").eq("id",pair.finance_confirmation_id)
          .eq("organization_id",org.id).eq("confirmed_customer_id",pair.finance_customer_id)
          .eq("status","CONFIRMED").not("confirmed_at","is",null).maybeSingle();
        if(confirmationError)return fail(503,"IDENTITY_LOOKUP_FAILED");
        if(confirmation)resolvedFinanceId=pair.finance_customer_id;
      }
    }
    // The checkout customer may be a booking app_id rather than its UUID.
    // Resolve it only inside the authenticated booking organization, then
    // require the independently confirmed, current LINE identity pair.
    if (!resolvedFinanceId) {
      const booking = createServiceRoleClient();
      if (!booking) return fail(503, "CONFIG_MISSING");
      const bookingOrg = await booking.from("organizations")
        .select("id").eq("app_id", organizationId).maybeSingle();
      if (bookingOrg.error || !bookingOrg.data) return fail(503, "IDENTITY_LOOKUP_FAILED");
      const bookingCustomer = checkoutCustomerKeyIsDbId(customerId)
        ? await booking.from("customers").select("id,status,organization_id")
            .eq("id",customerId).eq("organization_id",bookingOrg.data.id).maybeSingle()
        : await booking.from("customers").select("id,status,organization_id")
            .eq("app_id",customerId).eq("organization_id",bookingOrg.data.id).maybeSingle();
      if (bookingCustomer.error) return fail(503, "IDENTITY_LOOKUP_FAILED");
      if (bookingCustomer.data?.status === "ACTIVE") {
        const pairs = await db.from("member_booking_finance_identity_links")
          .select("finance_customer_id,finance_confirmation_id")
          .eq("organization_id",org.id)
          .eq("booking_organization_id",bookingOrg.data.id)
          .eq("booking_customer_id",bookingCustomer.data.id)
          .is("revoked_at",null).limit(2);
        if (pairs.error) return fail(503,"IDENTITY_LOOKUP_FAILED");
        if (pairs.data?.length === 1) {
          const pair = pairs.data[0];
          const confirmation = await db.from("member_finance_binding_challenges")
            .select("id").eq("id",pair.finance_confirmation_id)
            .eq("organization_id",org.id).eq("confirmed_customer_id",pair.finance_customer_id)
            .eq("status","CONFIRMED").not("confirmed_at","is",null).maybeSingle();
          if (confirmation.error) return fail(503,"IDENTITY_LOOKUP_FAILED");
          const bookingLine = await booking.from("member_line_customer_links")
            .select("line_subject_hash,verified_at")
            .eq("organization_id",bookingOrg.data.id)
            .eq("customer_id",bookingCustomer.data.id).limit(2);
          const financeLine = await db.from("member_line_customer_links")
            .select("line_subject_hash,verified_at")
            .eq("organization_id",org.id)
            .eq("customer_id",pair.finance_customer_id).limit(2);
          if (bookingLine.error || financeLine.error) return fail(503,"IDENTITY_LOOKUP_FAILED");
          if (confirmation.data && bookingLine.data?.length === 1 &&
              financeLine.data?.length === 1 &&
              bookingLine.data[0].verified_at && financeLine.data[0].verified_at &&
              bookingLine.data[0].line_subject_hash === financeLine.data[0].line_subject_hash) {
            const wallet = await db.from("customer_wallet_identities")
              .select("wallet_customer_id").eq("organization_id",org.id)
              .eq("wallet_customer_id",pair.finance_customer_id)
              .eq("status","ACTIVE").limit(2);
            if (wallet.error) return fail(503,"IDENTITY_LOOKUP_FAILED");
            if (wallet.data?.length === 1) resolvedFinanceId = pair.finance_customer_id;
          }
        }
      }
    }
    if (!resolvedFinanceId) {
      // First-time LINE members do not have the legacy in-store confirmation.
      // Read-only identity resolution; no linking or wallet mutation in GET.
      const booking = createServiceRoleClient();
      if (!booking) return fail(503, "CONFIG_MISSING");
      const bookingOrg = await booking.from("organizations").select("id")
        .eq("app_id", organizationId).maybeSingle();
      if (bookingOrg.error || !bookingOrg.data?.id) return fail(503, "IDENTITY_LOOKUP_FAILED");
      const bookingCustomer = checkoutCustomerKeyIsDbId(customerId)
        ? await booking.from("customers").select("id,status").eq("organization_id",bookingOrg.data.id).eq("id",customerId).maybeSingle()
        : await booking.from("customers").select("id,status").eq("organization_id",bookingOrg.data.id).eq("app_id",customerId).maybeSingle();
      if (bookingCustomer.error) return fail(503, "IDENTITY_LOOKUP_FAILED");
      if (bookingCustomer.data?.status === "ACTIVE") {
        const line = await booking.from("member_line_customer_links")
          .select("line_subject_hash,verified_at").eq("organization_id",bookingOrg.data.id)
          .eq("customer_id",bookingCustomer.data.id).limit(2);
        if (line.error) return fail(503, "IDENTITY_LOOKUP_FAILED");
        if (line.data?.length === 1 && line.data[0].verified_at) {
          const hash=line.data[0].line_subject_hash;
          const [bookingOwners,financeOwners,legacy,bookingPairs,sourceLinks,challenges] = await Promise.all([
            booking.from("member_line_customer_links").select("customer_id").eq("organization_id",bookingOrg.data.id).eq("line_subject_hash",hash).limit(2),
            db.from("member_line_customer_links").select("customer_id,verified_at").eq("organization_id",org.id).eq("line_subject_hash",hash).limit(2),
            db.from("line_customer_bindings").select("id").eq("organization_id",organizationId).eq("line_user_id_hash",hash).limit(2),
            db.from("member_booking_finance_identity_links").select("id").eq("organization_id",org.id).eq("booking_customer_id",bookingCustomer.data.id).limit(2),
            db.from("booking_source_customer_links").select("id").eq("organization_id",org.id).eq("source_customer_key",customerId.trim()).limit(2),
            db.from("member_finance_binding_challenges").select("id").eq("organization_id",org.id).eq("line_subject_hash",hash).limit(2),
          ]);
          if (bookingOwners.error||financeOwners.error||legacy.error||bookingPairs.error||sourceLinks.error||challenges.error)
            return fail(503, "IDENTITY_LOOKUP_FAILED");
          if (bookingOwners.data?.length===1 && bookingOwners.data[0].customer_id===bookingCustomer.data.id &&
              financeOwners.data?.length===1 && financeOwners.data[0].verified_at &&
              legacy.data?.length===0 && bookingPairs.data?.length===0 &&
              sourceLinks.data?.length===0 && challenges.data?.length===0) {
            const financeId=financeOwners.data[0].customer_id;
            const [financeCustomer,otherPairs,walletIdentity]=await Promise.all([
              db.from("customers").select("id,status").eq("organization_id",org.id).eq("id",financeId).maybeSingle(),
              db.from("member_booking_finance_identity_links").select("id").eq("organization_id",org.id).eq("finance_customer_id",financeId).limit(2),
              db.from("customer_wallet_identities").select("id").eq("organization_id",org.id)
                .or(`booking_customer_id.eq.${financeId},wallet_customer_id.eq.${financeId}`).limit(2),
            ]);
            if (financeCustomer.error||otherPairs.error||walletIdentity.error) return fail(503,"IDENTITY_LOOKUP_FAILED");
            if (financeCustomer.data?.status==="ACTIVE" && otherPairs.data?.length===0 &&
                walletIdentity.data?.length===0) resolvedFinanceId=financeId;
          }
        }
      }
    }
    if (!resolvedFinanceId) return fail(404, "CUSTOMER_NOT_FOUND");
    const { data: linked, error: linkedError } = await db.from("customers")
      .select("id, app_id, status")
      .eq("organization_id", org.id)
      .eq("id", resolvedFinanceId)
      .maybeSingle();
    if (linkedError || !linked) return fail(404, "CUSTOMER_NOT_FOUND");
    customer = toCustomerRow(linked);
  }
  if (!customer) return fail(404, "CUSTOMER_NOT_FOUND");

  const lineBound = async (customerUuid: string) => {
    const { data: canonical, error: canonicalError } = await db.from("member_line_customer_links")
      .select("line_subject_hash, verified_at").eq("organization_id", org.id).eq("customer_id", customerUuid).limit(5);
    if (canonicalError) return { bound: false, failed: true as const };
    const { data: legacy, error: legacyError } = await db.from("line_customer_bindings")
      .select("line_user_id_hash, status, verified, confirmed_at, bound_at, unbound_at, blocked_at")
      .eq("organization_id", organizationId).eq("customer_uuid", customerUuid).limit(5);
    if (legacyError) return { bound: false, failed: true as const };
    const bindings: VerifiedLineBinding[] = [
      ...(legacy ?? []).map((row) => ({
        source: "binding" as const,
        hash: typeof row.line_user_id_hash === "string" ? row.line_user_id_hash : null,
        verified: row.verified === true,
        status: String(row.status ?? ""),
        confirmedAt: row.confirmed_at,
        boundAt: row.bound_at,
        unboundAt: row.unbound_at,
        blockedAt: row.blocked_at,
      })),
      ...(canonical ?? []).map((row) => ({
        source: "member_link" as const,
        hash: typeof row.line_subject_hash === "string" ? row.line_subject_hash : null,
        verified: Boolean(row.verified_at),
        status: row.verified_at ? "active" : "pending",
        confirmedAt: row.verified_at,
        boundAt: row.verified_at,
        unboundAt: null,
        blockedAt: null,
      })),
    ];
    return {
      bound: lineMembershipIsCurrent(bindings, (canonical ?? []).some((row) => Boolean(row.verified_at))),
      failed: false as const,
    };
  };

  const bookingLine = await lineBound(customer.id);
  if (bookingLine.failed) return fail(503, "LINK_LOOKUP_FAILED");

  // Only an authorized identity row can point this booking customer at another wallet.
  const { data: walletIdentity, error: identityError } = await db.from("customer_wallet_identities")
    .select("wallet_customer_id")
    .eq("organization_id", org.id)
    .eq("booking_customer_id", customer.id)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (identityError && identityRelationIsMissing(identityError.code)) {
    console.error("[stored-value/balance] identity_table_unavailable", { code: identityError.code });
  } else if (identityError) {
    console.error("[stored-value/balance] identity_lookup_failed", { code: identityError.code });
    return fail(503, "IDENTITY_LOOKUP_FAILED");
  }

  let link: { walletCustomerId: string; walletActive: boolean; walletLineBound: boolean } | null = null;
  if (walletIdentity?.wallet_customer_id) {
    const { data: walletCustomer, error: walletCustomerError } = await db.from("customers")
      .select("id,status").eq("organization_id", org.id).eq("id", walletIdentity.wallet_customer_id).maybeSingle();
    if (walletCustomerError) {
      console.error("[stored-value/balance] wallet_customer_lookup_failed", { code: walletCustomerError.code });
      return fail(503, "WALLET_CUSTOMER_LOOKUP_FAILED");
    }
    const walletLine = walletCustomer ? await lineBound(walletCustomer.id) : { bound: false, failed: false as const };
    if (walletLine.failed) return fail(503, "LINK_LOOKUP_FAILED");
    link = {
      walletCustomerId: walletIdentity.wallet_customer_id,
      walletActive: walletCustomer?.status === "ACTIVE",
      walletLineBound: walletLine.bound,
    };
  }

  const decision = resolveStoredValueWalletCustomer({
    bookingCustomerId: customer.id,
    bookingLineBound: bookingLine.bound,
    link,
  });
  if (!decision.ok) {
    return fail(decision.code === "LINE_LINK_REQUIRED" ? 403 : 409, decision.code);
  }

  const [points,draw]=await Promise.all([
    db.from("member_points_redemptions").select("id,gift_name,created_at").eq("organization_id",org.id).eq("customer_id",decision.walletCustomerId).eq("status","issued").limit(100),
    db.from("lucky_draw_results").select("id,prize_name,prize_tier,created_at").eq("organization_id",org.id).eq("customer_id",decision.walletCustomerId).eq("voucher_status","issued").limit(100)
  ]);
  if(points.error||draw.error)return fail(503,"VOUCHER_READ_FAILED");
  return NextResponse.json({tickets:[...(points.data??[]).map(x=>({id:x.id,name:x.gift_name,source:"points"})),...(draw.data??[]).map(x=>({id:x.id,name:x.prize_name,source:"draw",tier:x.prize_tier}))]},{headers});
}
