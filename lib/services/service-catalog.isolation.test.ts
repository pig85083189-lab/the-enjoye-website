import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getServiceById, getServicesForOrganization } from "@/data/mock-services";
import { createEmptyDraft } from "@/lib/treatment-draft";
import {
  addCheckoutItem,
  completeCheckout,
  createCheckoutFromAppointment,
  createEmptyCheckoutDraft,
  setCheckoutPayments,
} from "@/lib/commerce/checkout-store";
import { createAppointment, transitionAppointmentStatus } from "@/lib/appointments/store";
import {
  createCustomerPackageFromPurchase,
  createPackageDefinition,
  getPackageUsableBalance,
  redeemPackageSession,
} from "@/lib/packages/store";
import {
  availablePlanServices,
  type PackagePlanServiceOption,
} from "@/lib/packages/package-plans-derived";
import {
  SERVICE_CATALOG_HAS_BOOKABLE_FLAG,
  SERVICE_CATALOG_HAS_DESCRIPTION,
  SERVICE_CATALOG_HAS_LOCATION_RESTRICTION,
  SERVICE_CATALOG_HAS_PACKAGE_ELIGIBLE_FLAG,
  SERVICE_CATALOG_HAS_PERSISTED_KPI,
  SERVICE_CATALOG_HAS_SECOND_STORE,
  SERVICE_CATALOG_HAS_SELLABLE_FLAG,
  SERVICE_CATALOG_HREF,
  SERVICE_CATALOG_PANEL_WIDTH_PX,
  SERVICE_CATALOG_USES_SHARED_SERVICE_ID,
  SERVICE_CATALOG_WORKSPACE_GAP_PX,
  buildServiceCatalogRows,
  canManageServices,
  countServiceCatalogSummary,
  parseServiceCatalogDraft,
  selectableServicesForBooking,
} from "@/lib/services/service-catalog-derived";
import {
  createService,
  deactivateService,
  getServicesForOrganization as listFromStore,
  listServices,
  reactivateService,
  updateService,
} from "@/lib/services/store";
import {
  LOC_ENJOYE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { NAVIGATION_ITEMS } from "@/lib/navigation/config";

beforeEach(() => {
  localStorage.clear();
});

function makeService(
  patch?: Partial<Parameters<typeof createService>[1]>,
  orgId = ORG_ENJOYE_ID,
) {
  return createService(orgId, {
    name: patch?.name ?? "新增熱石 SPA",
    category: patch?.category ?? "身體 SPA",
    durationMinutes: patch?.durationMinutes ?? 60,
    priceMinor: patch?.priceMinor ?? 2070,
    isActive: patch?.isActive,
    createdByStaffId: patch?.createdByStaffId ?? "staff-001",
  });
}

describe("Service Catalog isolation A–H", () => {
  it("A create Service via canonical overlay", () => {
    const created = makeService();
    expect(created.id).toMatch(/^svc-/);
    expect(created.organizationId).toBe(ORG_ENJOYE_ID);
    expect(getServiceById(created.id, ORG_ENJOYE_ID)?.name).toBe("新增熱石 SPA");
    expect(getServicesForOrganization(ORG_ENJOYE_ID).some((row) => row.id === created.id)).toBe(
      true,
    );
  });

  it("B update Service keeps canonical id", () => {
    const created = makeService();
    const updated = updateService(
      ORG_ENJOYE_ID,
      created.id,
      { name: "熱石循環 SPA", priceMinor: 1899, durationMinutes: 80 },
      "staff-001",
    );
    expect(updated.id).toBe(created.id);
    expect(getServiceById(created.id, ORG_ENJOYE_ID)?.name).toBe("熱石循環 SPA");
    expect(getServiceById(created.id, ORG_ENJOYE_ID)?.priceMinor).toBe(1899);
  });

  it("C deactivate Service uses isActive=false", () => {
    const created = makeService();
    const off = deactivateService(ORG_ENJOYE_ID, created.id, "staff-001");
    expect(off.isActive).toBe(false);
    expect(listServices(ORG_ENJOYE_ID, { activeOnly: true }).some((row) => row.id === created.id)).toBe(
      false,
    );
  });

  it("D reactivate Service", () => {
    const created = makeService();
    deactivateService(ORG_ENJOYE_ID, created.id, "staff-001");
    const on = reactivateService(ORG_ENJOYE_ID, created.id, "staff-001");
    expect(on.isActive).toBe(true);
    expect(listServices(ORG_ENJOYE_ID, { activeOnly: true }).some((row) => row.id === created.id)).toBe(
      true,
    );
  });

  it("E organization isolation", () => {
    const created = makeService();
    expect(getServiceById(created.id, ORG_LUMIERE_ID)).toBeUndefined();
    expect(getServicesForOrganization(ORG_LUMIERE_ID).some((row) => row.id === created.id)).toBe(
      false,
    );
    expect(() =>
      createService(ORG_LUMIERE_ID, {
        name: "跨店",
        durationMinutes: 60,
        priceMinor: 1000,
        createdByStaffId: "staff-001",
      }),
    ).toThrow(/Unauthorized|Staff membership/);
  });

  it("F active list excludes inactive and still lists seed services", () => {
    const active = listServices(ORG_ENJOYE_ID, { activeOnly: true });
    expect(active.map((row) => row.id)).toEqual(
      expect.arrayContaining(["svc-breast", "svc-facial", "svc-curve", "svc-womb"]),
    );
    deactivateService(ORG_ENJOYE_ID, "svc-womb", "staff-001");
    expect(listServices(ORG_ENJOYE_ID, { activeOnly: true }).map((row) => row.id)).not.toContain(
      "svc-womb",
    );
  });

  it("G get by canonical serviceId", () => {
    expect(getServiceById("svc-breast", ORG_ENJOYE_ID)?.organizationId).toBe(ORG_ENJOYE_ID);
    expect(getServiceById("svc-breast", ORG_LUMIERE_ID)).toBeUndefined();
    expect(listFromStore(ORG_ENJOYE_ID).find((row) => row.id === "svc-breast")?.name).toContain(
      "美胸",
    );
  });

  it("H rename keeps seed id", () => {
    const renamed = updateService(
      ORG_ENJOYE_ID,
      "svc-breast",
      { name: "美胸深層保養" },
      "staff-001",
    );
    expect(renamed.id).toBe("svc-breast");
    expect(getServiceById("svc-breast", ORG_ENJOYE_ID)?.name).toBe("美胸深層保養");
  });
});

describe("Service Catalog isolation I–P", () => {
  it("I PackageDefinition uses serviceId", () => {
    const created = makeService({ name: "淋巴代謝 SPA" });
    const def = createPackageDefinition(ORG_ENJOYE_ID, {
      name: "淋巴 10 堂",
      includedServiceIds: [created.id],
      sessionCount: 10,
      priceMinor: 18000,
      createdByStaffId: "staff-001",
    });
    expect(def.includedServices).toEqual([
      { serviceId: created.id, sessionsPerRedemption: 1 },
    ]);
  });

  it("J Package selector reads canonical Service", () => {
    const created = makeService({ name: "可選進方案" });
    deactivateService(ORG_ENJOYE_ID, "svc-womb", "staff-001");
    const options: PackagePlanServiceOption[] = getServicesForOrganization(ORG_ENJOYE_ID).map(
      (service) => ({
        id: service.id,
        name: service.name,
        isActive: service.isActive !== false,
      }),
    );
    const available = availablePlanServices(options, []);
    expect(available.some((row) => row.id === created.id)).toBe(true);
    expect(available.some((row) => row.id === "svc-womb")).toBe(false);
  });

  it("K inactive existing Service still resolves", () => {
    deactivateService(ORG_ENJOYE_ID, "svc-breast", "staff-001");
    const resolved = getServiceById("svc-breast", ORG_ENJOYE_ID);
    expect(resolved?.id).toBe("svc-breast");
    expect(resolved?.name).toContain("美胸");
    expect(resolved?.isActive).toBe(false);
  });

  it("L Appointment selector reads canonical Service", () => {
    const created = makeService();
    deactivateService(ORG_ENJOYE_ID, "svc-womb", "staff-001");
    const selectable = selectableServicesForBooking(
      getServicesForOrganization(ORG_ENJOYE_ID),
    );
    expect(selectable.some((row) => row.id === created.id)).toBe(true);
    expect(selectable.some((row) => row.id === "svc-womb")).toBe(false);
    const editing = selectableServicesForBooking(
      getServicesForOrganization(ORG_ENJOYE_ID),
      "svc-womb",
    );
    expect(editing.some((row) => row.id === "svc-womb")).toBe(true);
  });

  it("M Appointment persists canonical serviceId", () => {
    const created = makeService();
    const apt = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      serviceId: created.id,
      staffId: "staff-001",
      startAt: new Date(2026, 8, 29, 14, 0).toISOString(),
      endAt: new Date(2026, 8, 29, 15, 0).toISOString(),
      allowConflict: true,
    });
    expect(apt.serviceId).toBe(created.id);
    expect(apt.serviceName).toBe(created.name);
  });

  it("N Treatment relation uses serviceId not name join", () => {
    const created = makeService({ name: "原始名稱" });
    const apt = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      serviceId: created.id,
      staffId: "staff-001",
      startAt: new Date(2026, 8, 29, 16, 0).toISOString(),
      endAt: new Date(2026, 8, 29, 17, 0).toISOString(),
      allowConflict: true,
    });
    updateService(ORG_ENJOYE_ID, created.id, { name: "改名後" }, "staff-001");
    const draft = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      appointmentId: apt.id,
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: apt.serviceId,
    });
    expect(draft.serviceId).toBe(created.id);
    expect(getServiceById(draft.serviceId, ORG_ENJOYE_ID)?.name).toBe("改名後");
  });

  it("O Checkout SERVICE identity uses serviceId", () => {
    const created = makeService({ name: "結帳用服務", priceMinor: 1500 });
    const draft = createEmptyCheckoutDraft(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      createdByStaffId: "staff-001",
    });
    const next = addCheckoutItem(ORG_ENJOYE_ID, draft.id, {
      type: "SERVICE",
      referenceId: created.id,
      name: "ignored-name",
      unitPrice: 1,
    });
    const line = next.items.find((item) => item.type === "SERVICE");
    expect(line?.referenceId).toBe(created.id);
    expect(line?.nameSnapshot).toBe("結帳用服務");
    expect(line?.unitPrice).toBe(1500);
  });

  it("P Package redemption eligibility uses serviceId", () => {
    const created = makeService({ name: "核銷用服務" });
    const def = createPackageDefinition(ORG_ENJOYE_ID, {
      name: "核銷 5 堂",
      includedServiceIds: [created.id],
      sessionCount: 5,
      priceMinor: 8000,
      createdByStaffId: "staff-001",
    });
    const { customerPackage } = createCustomerPackageFromPurchase(ORG_ENJOYE_ID, {
      customerId: "demo-001",
      packageDefinitionId: def.id,
      purchaseTransactionId: "txn-svc-cat",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      createdByStaffId: "staff-001",
      effectKey: "txn-svc-cat:PACKAGE_PURCHASE:i",
    });
    expect(customerPackage.includedServiceIdsSnapshot).toEqual([created.id]);
    redeemPackageSession(ORG_ENJOYE_ID, {
      customerPackageId: customerPackage.id,
      customerId: "demo-001",
      serviceId: created.id,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      transactionId: "txn-svc-cat-use",
      createdByStaffId: "staff-001",
      effectKey: "txn-svc-cat-use:PACKAGE_REDEMPTION:cp",
    });
    expect(getPackageUsableBalance(ORG_ENJOYE_ID, customerPackage.id).usableBalance).toBe(4);
    expect(() =>
      redeemPackageSession(ORG_ENJOYE_ID, {
        customerPackageId: customerPackage.id,
        customerId: "demo-001",
        serviceId: "svc-breast",
        locationId: LOC_ENJOYE_PRIMARY_ID,
        transactionId: "txn-svc-cat-wrong",
        createdByStaffId: "staff-001",
        effectKey: "txn-svc-cat-wrong:PACKAGE_REDEMPTION:cp",
      }),
    ).toThrow(/not eligible/i);
  });
});

describe("Service Catalog isolation Q–T", () => {
  it("Q no persisted remainingSessions on Service", () => {
    const created = makeService();
    expect("remainingSessions" in created).toBe(false);
    const seed = getServiceById("svc-breast", ORG_ENJOYE_ID)!;
    expect("remainingSessions" in seed).toBe(false);
  });

  it("R no second Service store", () => {
    expect(SERVICE_CATALOG_HAS_SECOND_STORE).toBe(false);
    const root = process.cwd();
    expect(existsSync(path.join(root, "lib/services/service-catalog-store.ts"))).toBe(false);
    expect(existsSync(path.join(root, "lib/services/serviceManagementStore.ts"))).toBe(false);
    expect(existsSync(path.join(root, "features/services/service-v2.ts"))).toBe(false);
  });

  it("S UI does not localStorage.setItem", () => {
    const root = process.cwd();
    const page = readFileSync(
      path.join(root, "features/services/ServiceCatalogPageClient.tsx"),
      "utf8",
    );
    const form = readFileSync(path.join(root, "features/services/ServiceFormDialog.tsx"), "utf8");
    const quickView = readFileSync(
      path.join(root, "features/services/ServiceQuickView.tsx"),
      "utf8",
    );
    const derived = readFileSync(
      path.join(root, "lib/services/service-catalog-derived.ts"),
      "utf8",
    );
    expect(page).not.toMatch(/localStorage\.setItem/);
    expect(form).not.toMatch(/localStorage\.setItem/);
    expect(quickView).not.toMatch(/localStorage\.setItem/);
    expect(derived).not.toMatch(/localStorage/);
    expect(page).toMatch(/createService|ServiceFormDialog/);
    expect(form).toMatch(/createService/);
    expect(form).toMatch(/updateService/);
  });

  it("T Phase 5A source contract is untouched", () => {
    const root = process.cwd();
    const store = readFileSync(path.join(root, "lib/services/store.ts"), "utf8");
    const page = readFileSync(
      path.join(root, "features/services/ServiceCatalogPageClient.tsx"),
      "utf8",
    );
    const form = readFileSync(path.join(root, "features/services/ServiceFormDialog.tsx"), "utf8");
    expect(store).not.toMatch(/lib\/persistence/);
    expect(store).not.toMatch(/types\/database/);
    expect(page).not.toMatch(/lib\/persistence/);
    expect(form).not.toMatch(/lib\/persistence/);
    expect(page).toMatch(/useServiceRemoteList|remoteReadPilot/);
    expect(form).toMatch(/submitServiceRemoteCreate|createService/);
    expect(store).not.toMatch(/remainingSessions/);
    expect(SERVICE_CATALOG_HAS_PERSISTED_KPI).toBe(false);
    expect(SERVICE_CATALOG_HAS_LOCATION_RESTRICTION).toBe(false);
    expect(SERVICE_CATALOG_HAS_BOOKABLE_FLAG).toBe(false);
    expect(SERVICE_CATALOG_HAS_SELLABLE_FLAG).toBe(false);
    expect(SERVICE_CATALOG_HAS_PACKAGE_ELIGIBLE_FLAG).toBe(false);
    expect(SERVICE_CATALOG_HAS_DESCRIPTION).toBe(false);
  });
});

describe("Service Catalog workspace contracts", () => {
  it("permissions, layout, and derived summary", () => {
    expect(canManageServices("OWNER")).toBe(true);
    expect(canManageServices("MANAGER")).toBe(true);
    expect(canManageServices("STAFF")).toBe(false);
    expect(canManageServices("RECEPTIONIST")).toBe(false);
    expect(SERVICE_CATALOG_PANEL_WIDTH_PX).toBe(400);
    expect(SERVICE_CATALOG_WORKSPACE_GAP_PX).toBe(16);
    expect(SERVICE_CATALOG_HREF).toBe("/staff/services");
    expect(SERVICE_CATALOG_USES_SHARED_SERVICE_ID).toBe(true);
    const nav = NAVIGATION_ITEMS.find((item) => item.id === "services");
    expect(nav?.href).toBe("/staff/services");
    expect(nav?.label).toBe("服務項目");
    const rows = buildServiceCatalogRows(getServicesForOrganization(ORG_ENJOYE_ID));
    const summary = countServiceCatalogSummary(rows);
    expect(summary.total).toBeGreaterThanOrEqual(4);
    expect(summary.packageEligible).toBe(summary.total);
    const parsed = parseServiceCatalogDraft({
      name: " ",
      category: "",
      durationInput: "0",
      priceInput: "-1",
      isActive: true,
    });
    expect(parsed.ok).toBe(false);
  });

  it("STAFF cannot mutate catalog", () => {
    expect(() =>
      createService(ORG_ENJOYE_ID, {
        name: "越權",
        durationMinutes: 60,
        priceMinor: 1000,
        createdByStaffId: "staff-002",
      }),
    ).toThrow(/Unauthorized/);
  });

  it("inactive service cannot be newly booked", () => {
    deactivateService(ORG_ENJOYE_ID, "svc-breast", "staff-001");
    expect(() =>
      createAppointment(ORG_ENJOYE_ID, {
        locationId: LOC_ENJOYE_PRIMARY_ID,
        customerId: "demo-001",
        serviceId: "svc-breast",
        staffId: "staff-001",
        startAt: new Date(2026, 8, 29, 10, 0).toISOString(),
        endAt: new Date(2026, 8, 29, 11, 0).toISOString(),
        allowConflict: true,
      }),
    ).toThrow(/not available/i);
  });

  it("historical appointment checkout still uses canonical service id after rename", () => {
    const apt = createAppointment(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      customerId: "demo-001",
      serviceId: "svc-facial",
      staffId: "staff-001",
      startAt: new Date(2026, 8, 29, 11, 0).toISOString(),
      endAt: new Date(2026, 8, 29, 12, 30).toISOString(),
      allowConflict: true,
    });
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "CONFIRMED");
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "ARRIVED");
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "IN_SERVICE");
    updateService(ORG_ENJOYE_ID, "svc-facial", { name: "臉部改名" }, "staff-001");
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    expect(draft.items[0]?.referenceId).toBe("svc-facial");
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [{ method: "CASH", amount: draft.total }]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(tx.items[0]?.referenceId).toBe("svc-facial");
  });

  it("shell and page source keep 232px workbench", () => {
    const root = process.cwd();
    const shell = readFileSync(path.join(root, "components/layout/StaffShell.tsx"), "utf8");
    expect(shell).toMatch(/isServicesWorkbench/);
    expect(shell).toMatch(/w-\[232px\]/);
    expect(shell).toMatch(/w-\[254px\]/);
  });
});
