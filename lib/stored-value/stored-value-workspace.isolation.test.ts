import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addCheckoutItem,
  completeCheckout,
  createEmptyCheckoutDraft,
  setCheckoutPayments,
} from "@/lib/commerce/checkout-store";
import { applyCommerceLedgerEffects } from "@/lib/commerce/settle-effects";
import { getTransaction } from "@/lib/commerce/transaction-store";
import type { StoredValueAccount, StoredValueLedgerEntry } from "@/lib/stored-value/domain";
import {
  adjustStoredValue,
  getCustomerStoredValueBalance,
  getOrCreateStoredValueAccount,
  listStoredValueAccounts,
  listStoredValueLedger,
  postStoredValuePayment,
  postStoredValueTopUp,
} from "@/lib/stored-value/store";
import {
  STORED_VALUE_HAS_ADJUSTMENT,
  STORED_VALUE_HAS_EXPIRATION,
  STORED_VALUE_HAS_PRINCIPAL_BONUS_SPLIT,
  STORED_VALUE_HAS_REFUND_TYPE,
  STORED_VALUE_INLINE_MIN_PX,
  STORED_VALUE_PANEL_WIDTH_PX,
  STORED_VALUE_WORKSPACE_GAP_PX,
  buildStoredValueWorkspaceRows,
  canConfirmStoredValueTopUp,
  countStoredValueSummary,
  filterCustomersForStoredValuePicker,
  filterStoredValueRows,
  isInlineStoredValueQuickViewViewport,
  isStoredValueRowKeyboardActivation,
  ledgerWithRunningBalance,
  mapStoredValueLedgerViews,
  previewStoredValueTopUp,
  recentLedgerViews,
  resolveSelectedStoredValueRow,
  shouldRenderStoredValueQuickView,
  shouldResetStoredValueSelection,
  sortStoredValueRows,
  storedValueBalanceFromLedger,
  storedValueListPresentation,
  visitCountLabel,
  formatStoredValueTimestamp,
  type StoredValueWorkspaceRow,
} from "@/lib/stored-value/stored-value-workspace-derived";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import type { Customer } from "@/types";

const NOW = new Date(2026, 8, 28, 14, 30, 0);

function customer(
  partial: Partial<Customer> & Pick<Customer, "id" | "name">,
): Customer {
  return {
    organizationId: ORG_ENJOYE_ID,
    phone: "",
    birthday: "",
    age: 0,
    membership: "regular",
    lastVisit: "",
    totalVisits: 0,
    packages: [],
    lastServiceNotes: [],
    trackingFocus: [],
    alerts: [],
    tags: [],
    joinedAt: "",
    createdAt: "2025-01-01T00:00:00+08:00",
    updatedAt: "2026-09-01T00:00:00+08:00",
    ...partial,
  };
}

function account(
  partial: Partial<StoredValueAccount> &
    Pick<StoredValueAccount, "id" | "customerId">,
): StoredValueAccount {
  return {
    organizationId: ORG_ENJOYE_ID,
    currency: "TWD",
    status: "ACTIVE",
    createdAt: "2026-08-01T00:00:00+08:00",
    updatedAt: "2026-08-01T00:00:00+08:00",
    ...partial,
  };
}

function entry(
  partial: Partial<StoredValueLedgerEntry> &
    Pick<StoredValueLedgerEntry, "id" | "accountId" | "customerId" | "type" | "amountDelta">,
): StoredValueLedgerEntry {
  return {
    organizationId: ORG_ENJOYE_ID,
    createdByStaffId: "staff-001",
    createdAt: "2026-09-10T10:00:00+08:00",
    ...partial,
  };
}

const wang = customer({
  id: "demo-001",
  name: "王小美",
  phone: "0912-345-678",
  membership: "vip",
  totalVisits: 12,
});
const lin = customer({
  id: "demo-002",
  name: "林雅婷",
  phone: "0987-111-222",
  membership: "new",
  totalVisits: 1,
});
const li = customer({
  id: "demo-003",
  name: "李心柔",
  phone: "0922-333-444",
  totalVisits: 3,
});

const accounts = [
  account({ id: "sva-1", customerId: "demo-001" }),
  account({ id: "sva-2", customerId: "demo-002" }),
  account({ id: "sva-3", customerId: "demo-003" }),
];

const ledger: StoredValueLedgerEntry[] = [
  entry({
    id: "svl-1",
    accountId: "sva-1",
    customerId: "demo-001",
    type: "TOP_UP",
    amountDelta: 10000,
    createdAt: "2026-09-05T09:00:00+08:00",
    transactionId: "txn-1",
  }),
  entry({
    id: "svl-2",
    accountId: "sva-1",
    customerId: "demo-001",
    type: "PAYMENT",
    amountDelta: -2800,
    createdAt: "2026-09-12T14:00:00+08:00",
    transactionId: "txn-2",
  }),
  entry({
    id: "svl-3",
    accountId: "sva-1",
    customerId: "demo-001",
    type: "ADJUSTMENT",
    amountDelta: 500,
    reason: "活動補償",
    createdAt: "2026-09-20T11:00:00+08:00",
  }),
  entry({
    id: "svl-4",
    accountId: "sva-2",
    customerId: "demo-002",
    type: "TOP_UP",
    amountDelta: 3000,
    createdAt: "2026-08-15T10:00:00+08:00",
  }),
  entry({
    id: "svl-5",
    accountId: "sva-2",
    customerId: "demo-002",
    type: "PAYMENT",
    amountDelta: -3000,
    createdAt: "2026-09-01T16:00:00+08:00",
  }),
  entry({
    id: "svl-6",
    accountId: "sva-3",
    customerId: "demo-003",
    type: "TOP_UP",
    amountDelta: 8000,
    createdAt: "2026-09-18T08:00:00+08:00",
  }),
];

function rowsFromFixture(): StoredValueWorkspaceRow[] {
  return buildStoredValueWorkspaceRows({
    organizationId: ORG_ENJOYE_ID,
    accounts,
    ledger,
    customers: [wang, lin, li],
  });
}

describe("domain flags — no invented dimensions", () => {
  it("does not claim principal/bonus, expiration, or refund types", () => {
    expect(STORED_VALUE_HAS_PRINCIPAL_BONUS_SPLIT).toBe(false);
    expect(STORED_VALUE_HAS_EXPIRATION).toBe(false);
    expect(STORED_VALUE_HAS_REFUND_TYPE).toBe(false);
    expect(STORED_VALUE_HAS_ADJUSTMENT).toBe(true);
  });

  it("row shape has total balance only — no principal/bonus fields", () => {
    const row = rowsFromFixture().find((item) => item.customerId === "demo-001")!;
    expect(row.balanceMinor).toBe(7700);
    expect(row).not.toHaveProperty("principalMinor");
    expect(row).not.toHaveProperty("bonusMinor");
    expect(row).not.toHaveProperty("principalBalance");
    expect(row).not.toHaveProperty("bonusBalance");
  });
});

describe("balance summary derived", () => {
  it("derives holders, available, month top-up, and month usage from ledger", () => {
    const rows = rowsFromFixture();
    const summary = countStoredValueSummary(rows, ledger, NOW, ORG_ENJOYE_ID);
    expect(summary.holders).toBe(2);
    expect(summary.availableMinor).toBe(7700 + 0 + 8000);
    expect(summary.monthTopUpMinor).toBe(10000 + 8000);
    expect(summary.monthUsageMinor).toBe(2800 + 3000);
  });

  it("shows zeros when store is empty", () => {
    const summary = countStoredValueSummary([], [], NOW, ORG_ENJOYE_ID);
    expect(summary).toEqual({
      holders: 0,
      availableMinor: 0,
      monthTopUpMinor: 0,
      monthUsageMinor: 0,
    });
  });
});

describe("customer count / zero / positive", () => {
  it("counts holders as positive-balance customers only", () => {
    const rows = rowsFromFixture();
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.balanceMinor > 0)).toHaveLength(2);
    expect(rows.find((row) => row.customerId === "demo-002")?.balanceMinor).toBe(0);
    expect(rows.find((row) => row.customerId === "demo-002")?.status).toEqual({
      kind: "zero",
      title: "餘額為 0",
    });
    expect(rows.find((row) => row.customerId === "demo-001")?.status).toEqual({
      kind: "positive",
      title: "有餘額",
    });
  });
});

describe("ledger sorting and running balance", () => {
  it("builds chronological running balances then recent views newest-first", () => {
    const wangLedger = ledger.filter((item) => item.customerId === "demo-001");
    const views = ledgerWithRunningBalance(wangLedger);
    expect(views.map((item) => item.runningBalanceMinor)).toEqual([10000, 7200, 7700]);
    const recent = recentLedgerViews(views, 5);
    expect(recent[0]?.id).toBe("svl-3");
    expect(recent[0]?.runningBalanceMinor).toBe(7700);
    expect(recent).toHaveLength(3);
  });
});

describe("search / filter / sort", () => {
  it("filters by balance and searches name/phone", () => {
    const rows = rowsFromFixture();
    expect(filterStoredValueRows(rows, "positive", "")).toHaveLength(2);
    expect(filterStoredValueRows(rows, "zero", "").map((row) => row.customerId)).toEqual([
      "demo-002",
    ]);
    expect(filterStoredValueRows(rows, "all", "王小美").map((row) => row.customerId)).toEqual([
      "demo-001",
    ]);
    expect(filterStoredValueRows(rows, "all", "0987").map((row) => row.customerId)).toEqual([
      "demo-002",
    ]);
  });

  it("sorts by recent activity, highest, and lowest balance", () => {
    const rows = rowsFromFixture();
    expect(sortStoredValueRows(rows, "recent").map((row) => row.customerId)).toEqual([
      "demo-001",
      "demo-003",
      "demo-002",
    ]);
    expect(sortStoredValueRows(rows, "balance_desc").map((row) => row.customerId)).toEqual([
      "demo-003",
      "demo-001",
      "demo-002",
    ]);
    expect(sortStoredValueRows(rows, "balance_asc").map((row) => row.customerId)).toEqual([
      "demo-002",
      "demo-001",
      "demo-003",
    ]);
  });
});

describe("selected customer / reset / Quick View mapping", () => {
  it("resolves selectedCustomerId and resets when filtered out", () => {
    const rows = rowsFromFixture();
    const selected = resolveSelectedStoredValueRow(rows, "demo-001");
    expect(selected?.customerName).toBe("王小美");
    expect(shouldRenderStoredValueQuickView(selected)).toBe(true);
    expect(
      shouldResetStoredValueSelection({
        selectedCustomerId: "demo-001",
        visibleRows: filterStoredValueRows(rows, "zero", ""),
      }),
    ).toBe(true);
    expect(
      shouldResetStoredValueSelection({
        selectedCustomerId: "demo-002",
        visibleRows: filterStoredValueRows(rows, "zero", ""),
      }),
    ).toBe(false);
    expect(resolveSelectedStoredValueRow(rows, null)).toBeNull();
  });

  it("maps Quick View ledger labels from domain enums", () => {
    const views = mapStoredValueLedgerViews(
      ledger.filter((item) => item.customerId === "demo-001"),
      { "staff-001": "怡蓁" },
    );
    expect(views.map((item) => item.typeLabel)).toEqual(["儲值", "消費", "調整"]);
    expect(views[2]?.staffName).toBe("怡蓁");
    expect(views[0]?.transactionId).toBe("txn-1");
    expect(visitCountLabel(12)).toBe("第 12 次來店");
    expect(visitCountLabel(0)).toBeNull();
  });
});

describe("top-up preview", () => {
  it("derives after-balance without inventing bonus", () => {
    const preview = previewStoredValueTopUp({
      currentBalanceMinor: 2000,
      amountMinor: 10000,
    });
    expect(preview).toEqual({
      currentBalanceMinor: 2000,
      amountMinor: 10000,
      afterBalanceMinor: 12000,
    });
    expect(preview).not.toHaveProperty("bonusMinor");
    expect(canConfirmStoredValueTopUp({ customerId: "demo-001", amountMinor: 10000 })).toBe(
      true,
    );
    expect(canConfirmStoredValueTopUp({ customerId: null, amountMinor: 10000 })).toBe(false);
    expect(canConfirmStoredValueTopUp({ customerId: "demo-001", amountMinor: 0 })).toBe(false);
  });
});

describe("customer picker search", () => {
  it("filters picker customers by name and phone", () => {
    const hits = filterCustomersForStoredValuePicker([wang, lin, li], "0912");
    expect(hits.map((item) => item.id)).toEqual(["demo-001"]);
  });
});

describe("responsive derived behavior", () => {
  it("uses 400px panel, 16px gap, 1200 inline breakpoint", () => {
    expect(STORED_VALUE_PANEL_WIDTH_PX).toBe(400);
    expect(STORED_VALUE_WORKSPACE_GAP_PX).toBe(16);
    expect(STORED_VALUE_INLINE_MIN_PX).toBe(1200);
    expect(isInlineStoredValueQuickViewViewport(1200)).toBe(true);
    expect(isInlineStoredValueQuickViewViewport(1199)).toBe(false);
    expect(storedValueListPresentation(1536)).toBe("desktop-rows");
    expect(storedValueListPresentation(820)).toBe("mobile-cards");
    expect(storedValueListPresentation(390)).toBe("mobile-cards");
    expect(isStoredValueRowKeyboardActivation("Enter")).toBe(true);
    expect(isStoredValueRowKeyboardActivation(" ")).toBe(true);
    expect(isStoredValueRowKeyboardActivation("Tab")).toBe(false);
    expect(formatStoredValueTimestamp("2026-09-20T11:00:00+08:00")).toEqual({
      dateLabel: "2026/09/20",
      timeLabel: "11:00",
    });
  });
});

describe("store ledger truth — credit / debit / adjustment", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("credits TOP_UP, debits PAYMENT, and appends ADJUSTMENT without mutating a balance field", () => {
    getOrCreateStoredValueAccount(ORG_ENJOYE_ID, "demo-001", "staff-001");
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 10000,
      transactionId: "txn-credit",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-credit:STORED_VALUE_TOP_UP:i",
    });
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(10000);
    postStoredValuePayment(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 2800,
      transactionId: "txn-debit",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-debit:STORED_VALUE_PAYMENT:p",
    });
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(7200);
    adjustStoredValue(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amountDelta: -200,
      reason: "人工修正",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
    });
    const entries = listStoredValueLedger(ORG_ENJOYE_ID, { customerId: "demo-001" });
    const acc = listStoredValueAccounts(ORG_ENJOYE_ID, { customerId: "demo-001" })[0];
    expect(acc).not.toHaveProperty("balance");
    expect(storedValueBalanceFromLedger(entries, acc.id)).toBe(7000);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(7000);
    expect(entries.map((item) => item.type)).toEqual(["TOP_UP", "PAYMENT", "ADJUSTMENT"]);
  });
});

describe("checkout STORED_VALUE uses the same balance source", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("workspace row balance equals getCustomerStoredValueBalance", () => {
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 5000,
      transactionId: "txn-same",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-same:STORED_VALUE_TOP_UP:i",
    });
    const storeBalance = getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001");
    const built = buildStoredValueWorkspaceRows({
      organizationId: ORG_ENJOYE_ID,
      accounts: listStoredValueAccounts(ORG_ENJOYE_ID),
      ledger: listStoredValueLedger(ORG_ENJOYE_ID),
      customers: [wang, lin, li],
    });
    expect(built.find((row) => row.customerId === "demo-001")?.balanceMinor).toBe(
      storeBalance,
    );
  });

  it("completed checkout STORED_VALUE payment updates the same ledger", () => {
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 8000,
      transactionId: "txn-seed-sv",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-seed-sv:STORED_VALUE_TOP_UP:i",
    });
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "CUSTOM",
      name: "一般銷售",
      unitPrice: 2000,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "STORED_VALUE", amount: 2000 },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(tx.status).toBe("COMPLETED");
    expect(tx.payments[0]?.method).toBe("STORED_VALUE");
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(6000);
    const types = listStoredValueLedger(ORG_ENJOYE_ID, { customerId: "demo-001" }).map(
      (item) => item.type,
    );
    expect(types).toEqual(["TOP_UP", "PAYMENT"]);
  });

  it("top-up via checkout posts a single TOP_UP after completeCheckout", () => {
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "STORED_VALUE_TOP_UP",
      name: "儲值",
      unitPrice: 10000,
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [{ method: "CASH", amount: 10000 }]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(10000);
    const entries = listStoredValueLedger(ORG_ENJOYE_ID, { customerId: "demo-001" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("TOP_UP");
    expect(entries[0]?.transactionId).toBe(tx.id);
    applyCommerceLedgerEffects(ORG_ENJOYE_ID, tx, {
      ...draft,
      items: tx.items,
      payments: tx.payments,
      status: "COMPLETED",
    });
    expect(listStoredValueLedger(ORG_ENJOYE_ID, { customerId: "demo-001" })).toHaveLength(1);
  });
});

describe("organization / location isolation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does not leak org A ledger into org B workspace", () => {
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 5000,
      transactionId: "txn-a",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-a:STORED_VALUE_TOP_UP:i",
    });
    const lumiereCustomer = customer({
      id: "lumiere-c-001",
      organizationId: ORG_LUMIERE_ID,
      name: "周雨萱",
    });
    const lumiereRows = buildStoredValueWorkspaceRows({
      organizationId: ORG_LUMIERE_ID,
      accounts: listStoredValueAccounts(ORG_LUMIERE_ID),
      ledger: listStoredValueLedger(ORG_LUMIERE_ID),
      customers: [lumiereCustomer],
    });
    expect(lumiereRows).toEqual([]);
    expect(getCustomerStoredValueBalance(ORG_LUMIERE_ID, "lumiere-c-001")).toBe(0);
    const enjoyeRows = buildStoredValueWorkspaceRows({
      organizationId: ORG_ENJOYE_ID,
      accounts: listStoredValueAccounts(ORG_ENJOYE_ID),
      ledger: listStoredValueLedger(ORG_ENJOYE_ID),
      customers: [wang],
    });
    expect(enjoyeRows[0]?.balanceMinor).toBe(5000);
  });

  it("keeps org-wide balance; location is activity metadata only", () => {
    postStoredValueTopUp(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 4000,
      transactionId: "txn-loc-a",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-loc-a:STORED_VALUE_TOP_UP:i",
    });
    postStoredValuePayment(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      amount: 1000,
      transactionId: "txn-loc-b",
      locationId: LOC_ENJOYE_SECONDARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-loc-b:STORED_VALUE_PAYMENT:p",
    });
    expect(getCustomerStoredValueBalance(ORG_ENJOYE_ID, "demo-001")).toBe(3000);
    const built = buildStoredValueWorkspaceRows({
      organizationId: ORG_ENJOYE_ID,
      accounts: listStoredValueAccounts(ORG_ENJOYE_ID),
      ledger: listStoredValueLedger(ORG_ENJOYE_ID),
      customers: [wang],
    });
    expect(built).toHaveLength(1);
    expect(built[0]?.balanceMinor).toBe(3000);
    const locations = new Set(
      listStoredValueLedger(ORG_ENJOYE_ID, { customerId: "demo-001" }).map(
        (item) => item.locationId,
      ),
    );
    expect(locations.has(LOC_ENJOYE_PRIMARY_ID)).toBe(true);
    expect(locations.has(LOC_ENJOYE_SECONDARY_ID)).toBe(true);
  });
});

describe("architecture source guards", () => {
  it("extends existing stored-value + checkout instead of a parallel ledger", () => {
    const derived = readFileSync(
      path.join(process.cwd(), "lib/stored-value/stored-value-workspace-derived.ts"),
      "utf8",
    );
    const page = readFileSync(
      path.join(process.cwd(), "features/stored-value/StoredValuePageClient.tsx"),
      "utf8",
    );
    const quickView = readFileSync(
      path.join(process.cwd(), "features/stored-value/StoredValueQuickView.tsx"),
      "utf8",
    );
    const modal = readFileSync(
      path.join(process.cwd(), "features/stored-value/StoredValueTopUpModal.tsx"),
      "utf8",
    );
    const shell = readFileSync(
      path.join(process.cwd(), "components/layout/StaffShell.tsx"),
      "utf8",
    );
    const domain = readFileSync(
      path.join(process.cwd(), "lib/stored-value/domain.ts"),
      "utf8",
    );
    const panel = readFileSync(
      path.join(process.cwd(), "features/checkout/CheckoutPanel.tsx"),
      "utf8",
    );

    expect(derived).not.toMatch(/localStorage/);
    expect(derived).toMatch(/STORED_VALUE_HAS_PRINCIPAL_BONUS_SPLIT = false/);
    expect(page).toMatch(/selectedCustomerId/);
    expect(page).toMatch(/listStoredValueAccounts/);
    expect(page).toMatch(/listStoredValueLedger/);
    expect(page).toMatch(/getCustomerStoredValueBalance/);
    expect(page).not.toMatch(/customer\.balance\s*=/);
    expect(quickView).toMatch(/adjustStoredValue/);
    expect(quickView).not.toMatch(/REFUND/);
    expect(quickView).not.toMatch(/principal|bonus/i);
    expect(modal).toMatch(/createEmptyCheckoutDraft/);
    expect(modal).toMatch(/STORED_VALUE_TOP_UP/);
    expect(modal).toMatch(/completeCheckout/);
    expect(modal).toMatch(/EXTERNAL_PAYMENT_METHODS/);
    expect(shell).toMatch(/isStoredValueWorkbench/);
    expect(shell).toMatch(/w-\[254px\]/);
    expect(shell).toMatch(/w-\[232px\]/);
    expect(domain).not.toMatch(/PRINCIPAL|BONUS|EXPIR/);
    expect(panel).toMatch(/getCustomerStoredValueBalance/);
    expect(getTransaction).toEqual(expect.any(Function));
  });
});
