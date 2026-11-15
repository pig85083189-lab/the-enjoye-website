import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FUTURE_QA_APPOINTMENT } from "@/lib/appointments/remote-readiness";
import {
  remoteStoredValueBlockReason,
  remoteStoredValueWalletFromBalanceResponse,
} from "@/lib/commerce/checkout-stored-value";
import { formatTwd } from "@/lib/commerce/money";
import { resolveBookingSourceFinanceCustomer } from "@/lib/commerce/booking-source-customer";
import {
  chooseCheckoutCustomer,
  crossDbIdentityEvidence,
  identityRelationIsMissing,
  resolveStoredValueWalletCustomer,
  type CheckoutCustomerRow,
} from "@/lib/commerce/stored-value-wallet-identity";
import {
  hydrateCheckoutFromTreatment,
  saveCheckoutDraft,
  settleCheckoutDraft,
  type CommerceEngineSnapshot,
  type CommerceEngineStoredValue,
} from "@/lib/commerce/commerce-remote-engine";
import { toCommerceUserMessage } from "@/lib/commerce/commerce-remote-write-errors";

const ROOT = process.cwd();

function wallet(balanceMinor: number, lineBound = true): CommerceEngineStoredValue {
  return {
    customerAppId: FUTURE_QA_APPOINTMENT.customerAppId,
    lineBound,
    active: true,
    currency: "TWD",
    balanceMinor,
    entries:
      balanceMinor === 0
        ? []
        : [
            {
              effectKey: "seed:isolated-wallet",
              amountDeltaMinor: balanceMinor,
              type: "TOP_UP",
            },
          ],
  };
}

function snapshot(storedValue?: CommerceEngineStoredValue): CommerceEngineSnapshot {
  return {
    now: new Date("2026-11-15T00:00:00.000Z"),
    actor: {
      authUserId: "99999999-9999-4999-8999-999999999999",
      organizationAppId: FUTURE_QA_APPOINTMENT.organizationAppId,
      organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
      operationalStaffId: FUTURE_QA_APPOINTMENT.staffAppId,
      role: "OWNER",
      isActive: true,
      allowedLocationAppIds: null,
    },
    appointment: {
      appId: "apt-sv-isolated",
      dbId: "b92c54a1-000e-4cf1-bbd3-837ce3312559",
      organizationAppId: FUTURE_QA_APPOINTMENT.organizationAppId,
      organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
      locationAppId: FUTURE_QA_APPOINTMENT.locationAppId,
      locationDbId: FUTURE_QA_APPOINTMENT.locationDbId,
      customerAppId: FUTURE_QA_APPOINTMENT.customerAppId,
      customerDbId: FUTURE_QA_APPOINTMENT.customerDbId,
      serviceAppId: FUTURE_QA_APPOINTMENT.serviceAppId,
      serviceDbId: FUTURE_QA_APPOINTMENT.serviceDbId,
      status: "COMPLETED",
    },
    treatment: {
      appId: "trt-sv-isolated",
      dbId: "d1c0a111-2222-4333-8444-555555555555",
      organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
      locationDbId: FUTURE_QA_APPOINTMENT.locationDbId,
      appointmentDbId: "b92c54a1-000e-4cf1-bbd3-837ce3312559",
      customerDbId: FUTURE_QA_APPOINTMENT.customerDbId,
      serviceDbId: FUTURE_QA_APPOINTMENT.serviceDbId,
      status: "COMPLETED",
    },
    service: {
      appId: FUTURE_QA_APPOINTMENT.serviceAppId,
      dbId: FUTURE_QA_APPOINTMENT.serviceDbId,
      organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
      name: "隔離測試服務",
      priceMinor: 800,
    },
    drafts: [],
    transactions: [],
    storedValue,
  };
}

function pay(source: CommerceEngineSnapshot, payments: CommerceEngineSnapshot["drafts"][number]["payments"]) {
  const hydrated = hydrateCheckoutFromTreatment(source);
  return saveCheckoutDraft(source, {
    draftId: hydrated.draft.id,
    expectedUpdatedAt: hydrated.draft.updatedAt,
    payments,
    discounts: [],
  });
}

function memberBalance(source: CommerceEngineSnapshot): number {
  return (source.storedValue?.entries ?? []).reduce((sum, entry) => sum + entry.amountDeltaMinor, 0);
}

describe("checkout stored-value balance response", () => {
  it("reads an active canonical balance and refuses an unbound member", () => {
    expect(remoteStoredValueWalletFromBalanceResponse(200, { status: "active", balanceMinor: 1250 })).toEqual({
      status: "active",
      balanceMinor: 1250,
    });
    expect(remoteStoredValueWalletFromBalanceResponse(200, { status: "not_created", balanceMinor: null })).toEqual({
      status: "not_created",
    });
    expect(remoteStoredValueWalletFromBalanceResponse(403, { code: "LINE_LINK_REQUIRED" })).toEqual({
      status: "unbound",
    });
    expect(remoteStoredValueBlockReason({ status: "unbound" }, 100)).toBe("必須先完成 LINE 會員綁定");
    expect(remoteStoredValueBlockReason({ status: "active", balanceMinor: 100 }, 101)).toBe("儲值金餘額不足");
    expect(remoteStoredValueBlockReason({ status: "active", balanceMinor: 100 }, 100)).toBeNull();
    expect(remoteStoredValueBlockReason({ status: "active", balanceMinor: 100 }, 0)).toBeNull();
    expect(remoteStoredValueWalletFromBalanceResponse(503, { code: "IDENTITY_LOOKUP_FAILED" })).toEqual({
      status: "unavailable",
    });
    expect(remoteStoredValueWalletFromBalanceResponse(409, { code: "WALLET_CUSTOMER_UNAVAILABLE" })).toEqual({
      status: "unavailable",
    });
  });

  it("uses a confirmed wallet identity and refuses name-based matching", () => {
    expect(
      resolveStoredValueWalletCustomer({
        bookingCustomerId: "booking-a",
        bookingLineBound: false,
        link: { walletCustomerId: "wallet-b", walletActive: true, walletLineBound: true },
      }),
    ).toEqual({ ok: true, walletCustomerId: "wallet-b", via: "confirmed_link" });
    expect(
      resolveStoredValueWalletCustomer({
        bookingCustomerId: "booking-a",
        bookingLineBound: false,
        link: null,
      }),
    ).toEqual({ ok: false, code: "LINE_LINK_REQUIRED" });
    expect(
      resolveStoredValueWalletCustomer({
        bookingCustomerId: "booking-a",
        bookingLineBound: true,
        link: { walletCustomerId: "wallet-b", walletActive: true, walletLineBound: false },
      }),
    ).toEqual({ ok: false, code: "LINE_LINK_REQUIRED" });
    expect(
      resolveStoredValueWalletCustomer({
        bookingCustomerId: "booking-a",
        bookingLineBound: true,
        link: null,
      }),
    ).toEqual({ ok: true, walletCustomerId: "booking-a", via: "self" });
    expect(crossDbIdentityEvidence({
      appIdEqual: false,
      lineHashEqual: false,
      sharedAppointmentCount: 0,
      nameEqual: true,
      phoneEqual: true,
    })).toBeNull();
    expect(crossDbIdentityEvidence({
      appIdEqual: false,
      lineHashEqual: true,
      sharedAppointmentCount: 0,
      nameEqual: false,
      phoneEqual: false,
    })).toBe("line_hash");
    expect(identityRelationIsMissing("PGRST205")).toBe(true);
    expect(identityRelationIsMissing("42501")).toBe(false);
  });

  it("resolves a blank app_id checkout key by customer id and keeps other customers separate", () => {
    const bookingKey = "e06709d5-893f-4be1-8d83-b3d666a9257c";
    const booking: CheckoutCustomerRow = { id: bookingKey, appId: null, status: "ACTIVE" };
    const other: CheckoutCustomerRow = {
      id: "11111111-1111-4111-8111-111111111111",
      appId: "cust-booking-other",
      status: "ACTIVE",
    };
    const wallet: CheckoutCustomerRow = {
      id: "22222222-2222-4222-8222-222222222222",
      appId: "cust-wallet-other",
      status: "ACTIVE",
    };
    const chosen = chooseCheckoutCustomer({
      checkoutCustomerKey: bookingKey,
      appIdMatches: [],
      idMatches: [booking, other],
    });
    expect(chosen).toEqual(booking);
    const decision = resolveStoredValueWalletCustomer({
      bookingCustomerId: chosen!.id,
      bookingLineBound: false,
      link: { walletCustomerId: wallet.id, walletActive: true, walletLineBound: true },
    });
    expect(decision).toEqual({ ok: true, walletCustomerId: wallet.id, via: "confirmed_link" });
    const walletResponse = remoteStoredValueWalletFromBalanceResponse(200, {
      status: "active",
      balanceMinor: 2100,
    });
    expect(walletResponse).toEqual({ status: "active", balanceMinor: 2100 });
    expect(walletResponse.status === "active" ? formatTwd(walletResponse.balanceMinor) : "").toBe("NT$2,100");
    expect(remoteStoredValueBlockReason(walletResponse, 800)).toBeNull();
    expect(
      chooseCheckoutCustomer({
        checkoutCustomerKey: other.id,
        appIdMatches: [],
        idMatches: [booking],
      }),
    ).toBeNull();
    expect(
      chooseCheckoutCustomer({
        checkoutCustomerKey: bookingKey,
        appIdMatches: [{ ...other, appId: bookingKey }],
        idMatches: [booking],
      })?.id,
    ).toBe(other.id);
    expect(
      chooseCheckoutCustomer({
        checkoutCustomerKey: "cust-wallet-other",
        appIdMatches: [wallet, { ...booking, appId: "cust-wallet-other" }],
        idMatches: [],
      }),
    ).toBeNull();
    expect(
      chooseCheckoutCustomer({
        checkoutCustomerKey: bookingKey,
        appIdMatches: [{ ...booking, status: "INACTIVE" }],
        idMatches: [booking],
      }),
    ).toBeNull();
  });

  it("uses a confirmed booking-source link and ignores unconfirmed or cross-organization keys", () => {
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const sourceCustomerKey = "src-isolated-0001";
    const financeBookingCustomerId = "f44fffff-ffff-4fff-8fff-ffffffffffff";
    const link = {
      organizationId,
      sourceCustomerKey,
      financeBookingCustomerId,
      status: "ACTIVE",
      evidenceKind: "CUSTOMER_PRESENT",
    };
    expect(resolveBookingSourceFinanceCustomer({
      organizationId,
      sourceCustomerKey,
      links: [link],
    })).toBe(financeBookingCustomerId);
    expect(resolveBookingSourceFinanceCustomer({
      organizationId,
      sourceCustomerKey: "src-unconfirmed",
      links: [link],
    })).toBeNull();
    expect(resolveBookingSourceFinanceCustomer({
      organizationId: "22222222-2222-4222-8222-222222222222",
      sourceCustomerKey,
      links: [link],
    })).toBeNull();
    expect(resolveBookingSourceFinanceCustomer({
      organizationId,
      sourceCustomerKey,
      links: [{ ...link, status: "REVOKED" }],
    })).toBeNull();
    expect(resolveBookingSourceFinanceCustomer({
      organizationId,
      sourceCustomerKey,
      links: [link, { ...link, evidenceKind: "TRUSTED_MEMBER_RECORD" }],
    })).toBeNull();
    const decision = resolveStoredValueWalletCustomer({
      bookingCustomerId: financeBookingCustomerId,
      bookingLineBound: false,
      link: { walletCustomerId: "f55fffff-ffff-4fff-8fff-ffffffffffff", walletActive: true, walletLineBound: true },
    });
    expect(decision).toEqual({
      ok: true,
      walletCustomerId: "f55fffff-ffff-4fff-8fff-ffffffffffff",
      via: "confirmed_link",
    });
    const shown = remoteStoredValueWalletFromBalanceResponse(200, { status: "active", balanceMinor: 2100 });
    expect(shown.status === "active" ? formatTwd(shown.balanceMinor) : "").toBe("NT$2,100");
    expect(remoteStoredValueBlockReason(shown, 500)).toBeNull();
  });
});

describe("stored-value checkout debit", () => {
  it("debits a full payment once and keeps the member-visible ledger in sync", () => {
    const source = snapshot(wallet(1000));
    const paid = pay(source, [{ id: "pay-sv", method: "STORED_VALUE", amount: 800 }]);
    const first = settleCheckoutDraft(source, {
      draftId: paid.draft.id,
      expectedUpdatedAt: paid.draft.updatedAt,
    });
    const second = settleCheckoutDraft(source, {
      draftId: first.draft.id,
      expectedUpdatedAt: paid.draft.updatedAt,
    });
    expect(second.transaction?.id).toBe(first.transaction?.id);
    expect(source.transactions).toHaveLength(1);
    expect(memberBalance(source)).toBe(200);
    expect(source.storedValue?.entries.filter((entry) => entry.type === "PAYMENT")).toEqual([
      { effectKey: `checkout:${paid.draft.id}`, amountDeltaMinor: -800, type: "PAYMENT" },
    ]);
  });

  it("debits only the stored-value part of a mixed tender", () => {
    const source = snapshot(wallet(1000));
    const paid = pay(source, [
      { id: "pay-cash", method: "CASH", amount: 300 },
      { id: "pay-sv", method: "STORED_VALUE", amount: 500 },
    ]);
    settleCheckoutDraft(source, {
      draftId: paid.draft.id,
      expectedUpdatedAt: paid.draft.updatedAt,
    });
    expect(memberBalance(source)).toBe(500);
    expect(source.storedValue?.entries.find((entry) => entry.type === "PAYMENT")?.amountDeltaMinor).toBe(-500);
  });

  it("rejects insufficient balance, missing LINE binding, and a failed settle without debiting", () => {
    const low = snapshot(wallet(100));
    const lowPaid = pay(low, [{ id: "pay-sv", method: "STORED_VALUE", amount: 800 }]);
    expect(() =>
      settleCheckoutDraft(low, {
        draftId: lowPaid.draft.id,
        expectedUpdatedAt: lowPaid.draft.updatedAt,
      }),
    ).toThrow("儲值金餘額不足");
    expect(memberBalance(low)).toBe(100);
    expect(low.transactions).toHaveLength(0);

    const unbound = snapshot(wallet(1000, false));
    const unboundPaid = pay(unbound, [{ id: "pay-sv", method: "STORED_VALUE", amount: 800 }]);
    expect(() =>
      settleCheckoutDraft(unbound, {
        draftId: unboundPaid.draft.id,
        expectedUpdatedAt: unboundPaid.draft.updatedAt,
      }),
    ).toThrow("必須先完成 LINE 會員綁定");
    expect(memberBalance(unbound)).toBe(1000);

    const failing = snapshot(wallet(1000));
    failing.failSettleAfterLock = true;
    const failingPaid = pay(failing, [{ id: "pay-sv", method: "STORED_VALUE", amount: 800 }]);
    expect(() =>
      settleCheckoutDraft(failing, {
        draftId: failingPaid.draft.id,
        expectedUpdatedAt: failingPaid.draft.updatedAt,
      }),
    ).toThrow(/forced_failure/);
    expect(memberBalance(failing)).toBe(1000);
    expect(failing.transactions).toHaveLength(0);
    expect(toCommerceUserMessage(new Error("postgres 儲值金餘額不足"))).toBe("儲值金餘額不足");
  });

  it("debits the confirmed wallet while the sale stays on the booking customer", () => {
    const source = snapshot({
      customerAppId: "cust-line-isolated",
      linkedBookingCustomerAppId: FUTURE_QA_APPOINTMENT.customerAppId,
      lineBound: true,
      active: true,
      currency: "TWD",
      balanceMinor: 2100,
      entries: [{ effectKey: "seed:wallet-b", amountDeltaMinor: 2100, type: "TOP_UP" }],
    });
    const paid = pay(source, [{ id: "pay-sv", method: "STORED_VALUE", amount: 800 }]);
    const settled = settleCheckoutDraft(source, {
      draftId: paid.draft.id,
      expectedUpdatedAt: paid.draft.updatedAt,
    });
    expect(settled.transaction?.customerId).toBe(FUTURE_QA_APPOINTMENT.customerAppId);
    expect(settled.draft.customerId).toBe(FUTURE_QA_APPOINTMENT.customerAppId);
    expect(memberBalance(source)).toBe(1300);
    const replay = settleCheckoutDraft(source, {
      draftId: paid.draft.id,
      expectedUpdatedAt: paid.draft.updatedAt,
    });
    expect(replay.transaction?.id).toBe(settled.transaction?.id);
    expect(memberBalance(source)).toBe(1300);
    expect(source.storedValue?.entries.filter((entry) => entry.type === "TOP_UP")).toHaveLength(1);
    expect(source.storedValue?.entries.filter((entry) => entry.type === "PAYMENT")).toEqual([
      { effectKey: `checkout:${paid.draft.id}`, amountDeltaMinor: -800, type: "PAYMENT" },
    ]);

    const unlinked = snapshot({
      customerAppId: "cust-line-isolated",
      lineBound: true,
      active: true,
      currency: "TWD",
      balanceMinor: 2100,
      entries: [{ effectKey: "seed:wallet-b", amountDeltaMinor: 2100, type: "TOP_UP" }],
    });
    const unlinkedPaid = pay(unlinked, [{ id: "pay-sv", method: "STORED_VALUE", amount: 800 }]);
    expect(() =>
      settleCheckoutDraft(unlinked, {
        draftId: unlinkedPaid.draft.id,
        expectedUpdatedAt: unlinkedPaid.draft.updatedAt,
      }),
    ).toThrow("找不到有效儲值帳戶");
    expect(memberBalance(unlinked)).toBe(2100);
  });

  it("does not let a second draft reuse another appointment transaction", () => {
    const source = snapshot(wallet(1000));
    const paid = pay(source, [{ id: "pay-sv", method: "STORED_VALUE", amount: 800 }]);
    const settled = settleCheckoutDraft(source, {
      draftId: paid.draft.id,
      expectedUpdatedAt: paid.draft.updatedAt,
    });
    source.drafts.push({
      ...settled.draft,
      id: "chk-other-draft",
      status: "OPEN",
      updatedAt: source.now.toISOString(),
      payments: [{ id: "pay-other", method: "STORED_VALUE", amount: 100 }],
      total: 100,
    });
    expect(() =>
      settleCheckoutDraft(source, {
        draftId: "chk-other-draft",
        expectedUpdatedAt: source.now.toISOString(),
      }),
    ).toThrow("此預約已有其他結帳交易，請先核對交易紀錄");
    expect(memberBalance(source)).toBe(200);
  });
});

describe("stored-value checkout SQL review", () => {
  const sql = readFileSync(
    path.join(ROOT, "supabase/beauty-os/stored_value_checkout_atomic.sql"),
    "utf8",
  );
  const identity = readFileSync(
    path.join(ROOT, "supabase/migrations/20261115140000_customer_wallet_identity.sql"),
    "utf8",
  );
  const panel = readFileSync(path.join(ROOT, "features/checkout/CheckoutPanel.tsx"), "utf8");
  const balanceRoute = readFileSync(
    path.join(ROOT, "app/api/staff/stored-value/balance/route.ts"),
    "utf8",
  );

  it("keeps package closed and posts one atomic stored-value debit", () => {
    expect(sql).toMatch(/method='PACKAGE'/);
    expect(sql).toMatch(/此付款方式目前尚未開放/);
    expect(sql).toMatch(/'PAYMENT'/);
    expect(sql).toMatch(/'checkout:'\|\|v_draft\.id::text/);
    expect(sql).toMatch(/for share of b/);
    expect(sql).toMatch(/儲值金餘額不足/);
    expect(sql).toMatch(/必須先完成 LINE 會員綁定/);
    expect(sql).toMatch(/儲值金扣款未入帳，請勿重複結帳/);
    expect(sql).toMatch(/v_wallet\.customer_id/);
    expect(sql).toMatch(/customer_wallet_identities/);
    expect(sql).toMatch(/v_wallet_balance < 0/);
    expect(identity).toMatch(/confirm_customer_wallet_identity/);
    expect(identity).not.toMatch(/full_name|phone/);
    expect(identity).not.toMatch(/update\s+public\.stored_value_ledger_entries/i);
    expect(identity).not.toMatch(/delete\s+from\s+public\.stored_value_ledger_entries/i);
    expect(sql).not.toMatch(/\bBEGIN\b/);
    expect(sql).not.toMatch(/\bCOMMIT\b/);
    expect(sql).not.toMatch(/service_role/);
    expect(panel).toMatch(/\/api\/staff\/stored-value\/balance/);
    expect(panel).toMatch(/尚未開放儲值金付款/);
    expect(panel).toMatch(/remoteStoredValueBlockReason/);
    expect(balanceRoute).toMatch(/chooseCheckoutCustomer/);
    expect(balanceRoute).toMatch(/checkoutCustomerKeyIsDbId/);
    expect(balanceRoute).toMatch(/resolveBookingSourceFinanceCustomer/);
    expect(balanceRoute).toMatch(/booking_source_customer_links/);
    expect(balanceRoute).not.toMatch(/cust-musfocyt-3x0fpe|cust-line-a6cd6d968c4747c39229bc1deb985559/);
    expect(balanceRoute).not.toMatch(/e06709d5-893f-4be1-8d83-b3d666a9257c|bceef2c0-4555-41b2-9d1e-b999d604fa81|a6cd6d96-8c47-47c3-9229-bc1deb985559/);
    expect(panel).not.toMatch(/cust-musfocyt-3x0fpe|cust-line-a6cd6d968c4747c39229bc1deb985559/);
    const sourceLink = readFileSync(
      path.join(ROOT, "supabase/migrations/20261115170000_booking_source_customer_links.sql"),
      "utf8",
    );
    const checkoutRoute = readFileSync(
      path.join(ROOT, "app/api/staff/commerce/checkout/route.ts"),
      "utf8",
    );
    const bookingReceipt = readFileSync(
      path.join(ROOT, "supabase/booking/20261115171000_checkout_stored_value_receipt.sql"),
      "utf8",
    );
    expect(sourceLink).toMatch(/confirm_booking_source_customer_link/);
    expect(sourceLink).toMatch(/CUSTOMER_PRESENT/);
    expect(sourceLink).toMatch(/TRUSTED_MEMBER_RECORD/);
    expect(sourceLink).toMatch(/settle_booking_source_checkout/);
    expect(sourceLink).toMatch(/customer_wallet_identities_backup_20261115/);
    expect(sourceLink).toMatch(/enable row level security/);
    expect(sourceLink).not.toMatch(/create or replace function public\.settle_checkout_draft/);
    expect(sourceLink).not.toMatch(/create or replace function public\.save_checkout_draft/);
    expect(sourceLink).not.toMatch(/create table if not exists public\.locations/);
    expect(sourceLink).not.toMatch(/full_name|phone/);
    expect(sourceLink).not.toMatch(/e06709d5-893f-4be1-8d83-b3d666a9257c|cust-musfocyt-3x0fpe/);
    expect(checkoutRoute).toMatch(/readBookingCheckoutSource/);
    expect(checkoutRoute).toMatch(/financeCustomerId/);
    expect(checkoutRoute).not.toMatch(/p_package_redemption/);
    expect(checkoutRoute).not.toMatch(/e06709d5-893f-4be1-8d83-b3d666a9257c|bceef2c0-4555-41b2-9d1e-b999d604fa81/);
    expect(bookingReceipt).toMatch(/stored_value_debit_receipts/);
    expect(bookingReceipt).toMatch(/此付款方式目前尚未開放/);
    expect(bookingReceipt).toMatch(/v_draft\.package_redemption/);
    expect(bookingReceipt).toMatch(/apply_package_effects_for_transaction/);
    expect(bookingReceipt).toMatch(/p_package_redemption jsonb/);
    expect(bookingReceipt).toMatch(/method = 'PACKAGE'/);
    expect(bookingReceipt).toMatch(
      /grant execute on function public\.save_checkout_draft\(text, timestamptz, jsonb, jsonb, jsonb\)/,
    );
    expect(bookingReceipt).not.toMatch(/stored_value_ledger_entries/);
    expect(bookingReceipt).not.toMatch(/create or replace function public\.apply_package_effects_for_transaction/);
    expect(readFileSync(path.join(ROOT, "features/checkout/use-commerce-remote-write.ts"), "utf8")).toMatch(
      /\/api\/staff\/commerce\/checkout/,
    );
  });
});
