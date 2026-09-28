import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addCheckoutItem,
  completeCheckout,
  createCheckoutFromAppointment,
  createEmptyCheckoutDraft,
  setPackageRedemption,
} from "@/lib/commerce/checkout-store";
import { voidTransaction } from "@/lib/commerce/void-transaction";
import { createAppointment, transitionAppointmentStatus } from "@/lib/appointments/store";
import type { CustomerPackage, PackageLedgerEntry } from "@/lib/packages/domain";
import {
  createCustomerPackageFromPurchase,
  createPackageDefinition,
  getPackageLedgerBalance,
  getPackageUsableBalance,
  listUsablePackagesForService,
  reversePackageLedgerEntry,
} from "@/lib/packages/store";
import {
  PACKAGE_INLINE_MIN_PX,
  PACKAGE_PANEL_WIDTH_PX,
  PACKAGE_WORKSPACE_GAP_PX,
  PACKAGES_HAS_ADJUSTMENT,
  PACKAGES_HAS_EXPIRATION,
  PACKAGES_HAS_VOID,
  PACKAGES_USES_CUSTOMER_RESIDUE_REMAINING,
  buildPackageWorkspaceRows,
  canScheduleFromPackage,
  canStartPackageSale,
  countPackageSummary,
  derivePackageWorkspaceStatus,
  filterCustomersForPackagePicker,
  filterDefinitionsForPackagePicker,
  filterPackageRows,
  isInlinePackageQuickViewViewport,
  isPackageRowKeyboardActivation,
  ledgerWithRunningSessions,
  mapPackageLedgerViews,
  matchesPackageSearch,
  packageLedgerBalance,
  packageListPresentation,
  packageProgressLabel,
  packageRemainingLabel,
  packageScheduleHref,
  resolveSelectedPackageRow,
  shouldRenderPackageQuickView,
  shouldResetPackageSelection,
  sortPackageRows,
  usedSessionsFromSnapshot,
  type PackageWorkspaceRow,
} from "@/lib/packages/packages-workspace-derived";
import {
  LOC_ENJOYE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import type { Customer } from "@/types";

const NOW = new Date("2026-09-28T06:00:00.000Z");

function wipe() {
  localStorage.clear();
}

beforeEach(() => wipe());

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

function pkg(
  partial: Partial<CustomerPackage> & Pick<CustomerPackage, "id" | "customerId">,
): CustomerPackage {
  return {
    organizationId: ORG_ENJOYE_ID,
    packageDefinitionId: "pkgdef-1",
    nameSnapshot: "美胸 SPA 套票",
    sessionCountSnapshot: 10,
    priceSnapshot: 18000,
    includedServiceIdsSnapshot: ["svc-breast"],
    purchasedAt: "2026-09-01T09:00:00+08:00",
    status: "ACTIVE",
    createdAt: "2026-09-01T09:00:00+08:00",
    updatedAt: "2026-09-01T09:00:00+08:00",
    ...partial,
  };
}

function entry(
  partial: Partial<PackageLedgerEntry> &
    Pick<
      PackageLedgerEntry,
      "id" | "customerPackageId" | "customerId" | "type" | "sessionDelta"
    >,
): PackageLedgerEntry {
  return {
    organizationId: ORG_ENJOYE_ID,
    createdByStaffId: "staff-001",
    createdAt: "2026-09-01T09:00:00+08:00",
    ...partial,
  };
}

const wang = customer({
  id: "demo-001",
  name: "王小美",
  phone: "0912-345-678",
  membership: "vip",
  totalVisits: 12,
  packages: [
    {
      id: "crm-residue",
      customerId: "demo-001",
      serviceId: "svc-breast",
      serviceName: "性感美胸 SPA",
      remainingSessions: 99,
      totalSessions: 10,
    },
  ],
});
const lin = customer({
  id: "demo-002",
  name: "林雅婷",
  phone: "0911-222-333",
  membership: "new",
  totalVisits: 1,
});
const chen = customer({
  id: "demo-003",
  name: "陳欣怡",
  phone: "0988-777-666",
  totalVisits: 4,
});

const packages = [
  pkg({
    id: "cpkg-1",
    customerId: "demo-001",
    purchasedAt: "2026-09-05T09:00:00+08:00",
  }),
  pkg({
    id: "cpkg-2",
    customerId: "demo-002",
    nameSnapshot: "臉部保養 5 堂",
    packageDefinitionId: "pkgdef-2",
    sessionCountSnapshot: 5,
    includedServiceIdsSnapshot: ["svc-facial"],
    purchasedAt: "2026-08-15T10:00:00+08:00",
  }),
  pkg({
    id: "cpkg-3",
    customerId: "demo-003",
    nameSnapshot: "過期美胸",
    sessionCountSnapshot: 8,
    purchasedAt: "2025-09-01T08:00:00+08:00",
    expiresAt: "2026-01-01T00:00:00+08:00",
  }),
];

const ledger: PackageLedgerEntry[] = [
  entry({
    id: "plg-1",
    customerPackageId: "cpkg-1",
    customerId: "demo-001",
    type: "PURCHASE",
    sessionDelta: 10,
    createdAt: "2026-09-05T09:00:00+08:00",
    transactionId: "txn-p1",
    locationId: LOC_ENJOYE_PRIMARY_ID,
  }),
  entry({
    id: "plg-2",
    customerPackageId: "cpkg-1",
    customerId: "demo-001",
    type: "REDEMPTION",
    sessionDelta: -1,
    serviceId: "svc-breast",
    createdAt: "2026-09-12T14:00:00+08:00",
    transactionId: "txn-r1",
    locationId: LOC_ENJOYE_PRIMARY_ID,
  }),
  entry({
    id: "plg-3",
    customerPackageId: "cpkg-1",
    customerId: "demo-001",
    type: "REDEMPTION",
    sessionDelta: -1,
    serviceId: "svc-breast",
    createdAt: "2026-09-20T11:00:00+08:00",
    transactionId: "txn-r2",
  }),
  entry({
    id: "plg-4",
    customerPackageId: "cpkg-1",
    customerId: "demo-001",
    type: "REDEMPTION",
    sessionDelta: -1,
    serviceId: "svc-breast",
    createdAt: "2026-09-25T16:00:00+08:00",
    transactionId: "txn-r3",
  }),
  entry({
    id: "plg-5",
    customerPackageId: "cpkg-2",
    customerId: "demo-002",
    type: "PURCHASE",
    sessionDelta: 5,
    createdAt: "2026-08-15T10:00:00+08:00",
  }),
  entry({
    id: "plg-6",
    customerPackageId: "cpkg-2",
    customerId: "demo-002",
    type: "REDEMPTION",
    sessionDelta: -1,
    serviceId: "svc-facial",
    createdAt: "2026-08-20T10:00:00+08:00",
  }),
  entry({
    id: "plg-7",
    customerPackageId: "cpkg-2",
    customerId: "demo-002",
    type: "REDEMPTION",
    sessionDelta: -1,
    serviceId: "svc-facial",
    createdAt: "2026-08-28T10:00:00+08:00",
  }),
  entry({
    id: "plg-8",
    customerPackageId: "cpkg-2",
    customerId: "demo-002",
    type: "REDEMPTION",
    sessionDelta: -1,
    serviceId: "svc-facial",
    createdAt: "2026-09-01T16:00:00+08:00",
  }),
  entry({
    id: "plg-9",
    customerPackageId: "cpkg-2",
    customerId: "demo-002",
    type: "REDEMPTION",
    sessionDelta: -1,
    serviceId: "svc-facial",
    createdAt: "2026-09-08T16:00:00+08:00",
  }),
  entry({
    id: "plg-10",
    customerPackageId: "cpkg-2",
    customerId: "demo-002",
    type: "REDEMPTION",
    sessionDelta: -1,
    serviceId: "svc-facial",
    createdAt: "2026-09-10T16:00:00+08:00",
  }),
  entry({
    id: "plg-11",
    customerPackageId: "cpkg-3",
    customerId: "demo-003",
    type: "PURCHASE",
    sessionDelta: 8,
    createdAt: "2025-09-01T08:00:00+08:00",
  }),
  entry({
    id: "plg-12",
    customerPackageId: "cpkg-3",
    customerId: "demo-003",
    type: "REDEMPTION",
    sessionDelta: -1,
    createdAt: "2025-10-01T08:00:00+08:00",
  }),
];

function rowsFromFixture(): PackageWorkspaceRow[] {
  return buildPackageWorkspaceRows({
    organizationId: ORG_ENJOYE_ID,
    packages,
    ledger,
    customers: [wang, lin, chen],
    serviceNames: {
      "svc-breast": "性感美胸 SPA",
      "svc-facial": "臉部保養 SPA",
    },
    now: NOW,
  });
}

function seedDefinition() {
  return createPackageDefinition(ORG_ENJOYE_ID, {
    name: "美胸保養 10 堂",
    includedServiceIds: ["svc-breast"],
    sessionCount: 10,
    priceMinor: 18000,
    validityDays: 365,
    createdByStaffId: "staff-001",
  });
}

function makeEligibleAppointment() {
  const apt = createAppointment(ORG_ENJOYE_ID, {
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "demo-001",
    serviceId: "svc-breast",
    staffId: "staff-002",
    startAt: new Date(2026, 8, 21, 14, 0).toISOString(),
    endAt: new Date(2026, 8, 21, 15, 30).toISOString(),
    allowConflict: true,
  });
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "CONFIRMED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "ARRIVED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "IN_SERVICE");
  return apt;
}

describe("packages workspace derived", () => {
  it("maps customer packages with total / used / remaining from ledger", () => {
    const rows = rowsFromFixture();
    const wangRow = rows.find((row) => row.customerPackageId === "cpkg-1")!;
    expect(wangRow.customerName).toBe("王小美");
    expect(wangRow.totalSessions).toBe(10);
    expect(wangRow.usedSessions).toBe(3);
    expect(wangRow.ledgerBalance).toBe(7);
    expect(wangRow.remainingSessions).toBe(7);
    expect(wangRow.status).toEqual({
      kind: "active",
      title: "使用中",
      domainStatus: "ACTIVE",
    });
    expect(packageProgressLabel(wangRow.usedSessions, wangRow.totalSessions)).toBe(
      "已使用 3 / 10 堂",
    );
    expect(packageRemainingLabel(wangRow.remainingSessions)).toBe("剩餘 7 堂");
  });

  it("treats zero remaining as exhausted and expired packages as expired", () => {
    const rows = rowsFromFixture();
    const linRow = rows.find((row) => row.customerPackageId === "cpkg-2")!;
    expect(linRow.remainingSessions).toBe(0);
    expect(linRow.usedSessions).toBe(5);
    expect(linRow.status.kind).toBe("exhausted");
    const expired = rows.find((row) => row.customerPackageId === "cpkg-3")!;
    expect(expired.status.kind).toBe("expired");
    expect(expired.remainingSessions).toBe(0);
    expect(expired.ledgerBalance).toBe(7);
  });

  it("derives summary from existing package data", () => {
    const rows = rowsFromFixture();
    const summary = countPackageSummary(rows, ledger, NOW, ORG_ENJOYE_ID);
    expect(summary.holderCustomers).toBe(3);
    expect(summary.activePackages).toBe(1);
    expect(summary.remainingSessions).toBe(7);
    expect(summary.monthUsageSessions).toBe(6);
  });

  it("never uses CRM residue remainingSessions", () => {
    const rows = rowsFromFixture();
    const wangRow = rows.find((row) => row.customerId === "demo-001")!;
    expect(wang.packages[0]?.remainingSessions).toBe(99);
    expect(wangRow.remainingSessions).not.toBe(99);
    expect(PACKAGES_USES_CUSTOMER_RESIDUE_REMAINING).toBe(false);
  });

  it("search matches customer name, phone, and package name", () => {
    const rows = rowsFromFixture();
    expect(matchesPackageSearch(rows[0]!, "王小美")).toBe(true);
    expect(matchesPackageSearch(rows[0]!, "0912")).toBe(true);
    expect(
      filterPackageRows(rows, "all", "臉部").map((row) => row.customerPackageId),
    ).toEqual(["cpkg-2"]);
  });

  it("filters active / exhausted / expired", () => {
    const rows = rowsFromFixture();
    expect(filterPackageRows(rows, "active", "").map((row) => row.customerPackageId)).toEqual([
      "cpkg-1",
    ]);
    expect(
      filterPackageRows(rows, "exhausted", "").map((row) => row.customerPackageId),
    ).toEqual(["cpkg-2"]);
    expect(filterPackageRows(rows, "expired", "").map((row) => row.customerPackageId)).toEqual([
      "cpkg-3",
    ]);
  });

  it("sorts by remaining, purchased time, and recent use", () => {
    const rows = rowsFromFixture();
    expect(
      sortPackageRows(rows, "remaining_desc").map((row) => row.customerPackageId),
    ).toEqual(["cpkg-1", "cpkg-2", "cpkg-3"]);
    expect(
      sortPackageRows(rows, "purchased_desc").map((row) => row.customerPackageId),
    ).toEqual(["cpkg-1", "cpkg-2", "cpkg-3"]);
    expect(
      sortPackageRows(rows, "recent").map((row) => row.customerPackageId),
    ).toEqual(["cpkg-1", "cpkg-2", "cpkg-3"]);
  });

  it("selection, reset, and Quick View mapping", () => {
    const rows = rowsFromFixture();
    const selected = resolveSelectedPackageRow(rows, "cpkg-1");
    expect(selected?.packageName).toBe("美胸 SPA 套票");
    expect(shouldRenderPackageQuickView(selected)).toBe(true);
    expect(
      shouldResetPackageSelection({
        selectedPackageId: "cpkg-1",
        visibleRows: filterPackageRows(rows, "exhausted", ""),
      }),
    ).toBe(true);
    expect(
      shouldResetPackageSelection({
        selectedPackageId: "cpkg-2",
        visibleRows: filterPackageRows(rows, "exhausted", ""),
      }),
    ).toBe(false);
  });

  it("maps ledger running balance and expiration flags", () => {
    const views = ledgerWithRunningSessions(
      ledger.filter((entry) => entry.customerPackageId === "cpkg-1"),
    );
    expect(views.map((row) => row.runningBalance)).toEqual([10, 9, 8, 7]);
    expect(PACKAGES_HAS_EXPIRATION).toBe(true);
    expect(PACKAGES_HAS_ADJUSTMENT).toBe(true);
    expect(PACKAGES_HAS_VOID).toBe(true);
    expect(
      derivePackageWorkspaceStatus(packages[0]!, 4, NOW).domainStatus,
    ).toBe("ACTIVE");
  });

  it("keyboard, responsive contract, schedule href, sell picker", () => {
    expect(isPackageRowKeyboardActivation("Enter")).toBe(true);
    expect(isPackageRowKeyboardActivation(" ")).toBe(true);
    expect(isPackageRowKeyboardActivation("Tab")).toBe(false);
    expect(PACKAGE_PANEL_WIDTH_PX).toBe(400);
    expect(PACKAGE_WORKSPACE_GAP_PX).toBe(16);
    expect(PACKAGE_INLINE_MIN_PX).toBe(1200);
    expect(isInlinePackageQuickViewViewport(1536)).toBe(true);
    expect(packageListPresentation(390)).toBe("mobile-cards");
    const wangRow = rowsFromFixture().find((row) => row.customerPackageId === "cpkg-1")!;
    expect(canScheduleFromPackage(wangRow)).toBe(true);
    expect(packageScheduleHref(wangRow)).toBe(
      "/staff/calendar?create=1&customer=demo-001&service=svc-breast",
    );
    expect(
      filterCustomersForPackagePicker([wang, lin], "林").map((row) => row.id),
    ).toEqual(["demo-002"]);
    expect(
      canStartPackageSale({ customerId: "demo-001", definitionId: "pkgdef-1" }),
    ).toBe(true);
    expect(canStartPackageSale({ customerId: null, definitionId: "pkgdef-1" })).toBe(
      false,
    );
  });
});

describe("packages workspace checkout source of truth", () => {
  it("workspace remaining matches checkout usable balance for the same package", () => {
    const def = seedDefinition();
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-p",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-p:PACKAGE_PURCHASE:i",
    });
    const liveLedger = [
      {
        id: "live-1",
        organizationId: ORG_ENJOYE_ID,
        customerPackageId: customerPackage.id,
        customerId: "demo-001",
        type: "PURCHASE" as const,
        sessionDelta: 10,
        createdByStaffId: "staff-001",
        createdAt: customerPackage.purchasedAt,
      },
    ];
    const rows = buildPackageWorkspaceRows({
      organizationId: ORG_ENJOYE_ID,
      packages: [customerPackage],
      ledger: liveLedger,
      customers: [wang],
      now: NOW,
    });
    const store = getPackageUsableBalance(ORG_ENJOYE_ID, customerPackage.id);
    const usable = listUsablePackagesForService(
      ORG_ENJOYE_ID,
      "demo-001",
      "svc-breast",
    );
    expect(rows[0]?.remainingSessions).toBe(store.usableBalance);
    expect(usable.find((item) => item.id === customerPackage.id)?.usableBalance).toBe(
      rows[0]?.remainingSessions,
    );
    expect(packageLedgerBalance(liveLedger, customerPackage.id)).toBe(
      getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id),
    );
  });

  it("rejects incompatible service and keeps OPEN draft from deducting", () => {
    const def = seedDefinition();
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-live",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-live:PACKAGE_PURCHASE:i",
    });
    expect(
      listUsablePackagesForService(ORG_ENJOYE_ID, "demo-001", "svc-facial"),
    ).toEqual([]);
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    setPackageRedemption(ORG_ENJOYE_ID, draft.id, {
      customerPackageId: customerPackage.id,
      serviceId: "svc-breast",
      sessions: 1,
    });
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(10);
    expect(getPackageUsableBalance(ORG_ENJOYE_ID, customerPackage.id).usableBalance).toBe(
      10,
    );
  });

  it("completeCheckout deducts once and retries are idempotent", () => {
    const def = seedDefinition();
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-buy",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-buy:PACKAGE_PURCHASE:i",
    });
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    setPackageRedemption(ORG_ENJOYE_ID, draft.id, {
      customerPackageId: customerPackage.id,
      serviceId: "svc-breast",
      sessions: 1,
    });
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(9);
    const again = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(again.id).toBe(tx.id);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(9);
  });

  it("void / reversal restores sessions", () => {
    const def = seedDefinition();
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-v0",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-v0:PACKAGE_PURCHASE:i",
    });
    const apt = makeEligibleAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    setPackageRedemption(ORG_ENJOYE_ID, draft.id, {
      customerPackageId: customerPackage.id,
      serviceId: "svc-breast",
      sessions: 1,
    });
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(9);
    voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "測誤",
    });
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, customerPackage.id)).toBe(10);
    expect(usedSessionsFromSnapshot(10, 10)).toBe(0);
    expect(mapPackageLedgerViews([
      {
        id: "will-reverse",
        organizationId: ORG_ENJOYE_ID,
        customerPackageId: customerPackage.id,
        customerId: "demo-001",
        type: "REDEMPTION",
        sessionDelta: -1,
        createdByStaffId: "staff-001",
        createdAt: new Date().toISOString(),
      },
    ])[0]?.typeLabel).toBe("核銷");
    expect(reversePackageLedgerEntry).toEqual(expect.any(Function));
  });

  it("organization isolation and location is recorded not used as remaining split", () => {
    const def = seedDefinition();
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-org",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-org:PACKAGE_PURCHASE:i",
    });
    const rows = buildPackageWorkspaceRows({
      organizationId: ORG_LUMIERE_ID,
      packages: [customerPackage],
      ledger: [
        {
          id: "x",
          organizationId: ORG_ENJOYE_ID,
          customerPackageId: customerPackage.id,
          customerId: "demo-001",
          type: "PURCHASE",
          sessionDelta: 10,
          createdByStaffId: "staff-001",
          createdAt: customerPackage.purchasedAt,
        },
      ],
      customers: [{ ...wang, organizationId: ORG_LUMIERE_ID }],
      now: NOW,
    });
    expect(rows).toEqual([]);
    expect(listUsablePackagesForService(ORG_LUMIERE_ID, "demo-001", "svc-breast")).toEqual(
      [],
    );
  });

  it("sell package still goes through checkout purchase item", () => {
    const def = seedDefinition();
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const withItem = addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "PACKAGE_PURCHASE",
      referenceId: def.id,
      name: def.name,
      unitPrice: def.priceMinor,
    });
    expect(withItem.items[0]?.type).toBe("PACKAGE_PURCHASE");
    expect(
      filterDefinitionsForPackagePicker([def], "美胸"),
    ).toHaveLength(1);
    expect(getPackageLedgerBalance(ORG_ENJOYE_ID, "not-created-yet")).toBe(0);
  });
});

describe("packages workspace source guards", () => {
  it("does not invent a parallel remaining field or skip expiration domain", () => {
    const derived = readFileSync(
      path.join(process.cwd(), "lib/packages/packages-workspace-derived.ts"),
      "utf8",
    );
    const page = readFileSync(
      path.join(process.cwd(), "features/packages/PackagesPageClient.tsx"),
      "utf8",
    );
    const quickView = readFileSync(
      path.join(process.cwd(), "features/packages/PackageQuickView.tsx"),
      "utf8",
    );
    const modal = readFileSync(
      path.join(process.cwd(), "features/packages/PackageSellModal.tsx"),
      "utf8",
    );
    const shell = readFileSync(
      path.join(process.cwd(), "components/layout/StaffShell.tsx"),
      "utf8",
    );
    const panel = readFileSync(
      path.join(process.cwd(), "features/checkout/CheckoutPanel.tsx"),
      "utf8",
    );

    expect(derived).not.toMatch(/localStorage/);
    expect(derived).toMatch(/PACKAGES_HAS_EXPIRATION = true/);
    expect(derived).toMatch(/sessionCountSnapshot/);
    expect(derived).not.toMatch(/remainingSessions:\s*99/);
    expect(page).toMatch(/listCustomerPackages/);
    expect(page).toMatch(/listPackageLedger/);
    expect(page).toMatch(/getPackageUsableBalance/);
    expect(page).not.toMatch(/customer\.packages/);
    expect(quickView).toMatch(/adjustPackageSessions/);
    expect(quickView).toMatch(/packageScheduleHref/);
    expect(modal).toMatch(/createEmptyCheckoutDraft/);
    expect(modal).toMatch(/PACKAGE_PURCHASE/);
    expect(modal).not.toMatch(/completeCheckout/);
    expect(shell).toMatch(/isPackagesWorkbench/);
    expect(shell).toMatch(/w-\[254px\]/);
    expect(shell).toMatch(/w-\[232px\]/);
    expect(panel).toMatch(/listUsablePackagesForService/);
  });
});
