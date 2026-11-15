import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FUTURE_QA_APPOINTMENT } from "@/lib/appointments/remote-readiness";
import {
  remoteStoredValueBlockReason,
  remoteStoredValueWalletFromBalanceResponse,
} from "@/lib/commerce/checkout-stored-value";
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
  const panel = readFileSync(path.join(ROOT, "features/checkout/CheckoutPanel.tsx"), "utf8");

  it("keeps package closed and posts one atomic stored-value debit", () => {
    expect(sql).toMatch(/method='PACKAGE'/);
    expect(sql).toMatch(/此付款方式目前尚未開放/);
    expect(sql).toMatch(/'PAYMENT'/);
    expect(sql).toMatch(/'checkout:'\|\|v_draft\.id::text/);
    expect(sql).toMatch(/for share of b/);
    expect(sql).toMatch(/儲值金餘額不足/);
    expect(sql).toMatch(/必須先完成 LINE 會員綁定/);
    expect(sql).toMatch(/儲值金扣款未入帳，請勿重複結帳/);
    expect(sql).toMatch(/v_wallet_balance < 0/);
    expect(sql).not.toMatch(/\bBEGIN\b/);
    expect(sql).not.toMatch(/\bCOMMIT\b/);
    expect(sql).not.toMatch(/service_role/);
    expect(panel).toMatch(/\/api\/staff\/stored-value\/balance/);
    expect(panel).toMatch(/尚未開放儲值金付款/);
    expect(panel).toMatch(/remoteStoredValueBlockReason/);
  });
});
