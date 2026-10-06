import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FUTURE_QA_APPOINTMENT } from "@/lib/appointments/remote-readiness";
import {
  COMMERCE_PACKAGE_HYDRATE_RPC,
  hydrateCheckoutFromPackage,
  type CommerceEnginePackageSnapshot,
} from "@/lib/commerce/commerce-remote-engine";
import { COMMERCE_WRITE_PILOT_OFF_MESSAGE } from "@/lib/commerce/commerce-remote-write-errors";
import { COMMERCE_REMOTE_READ_PILOT_ENV } from "@/lib/commerce/commerce-remote-read-flag";
import { COMMERCE_REMOTE_WRITE_PILOT_ENV } from "@/lib/commerce/commerce-remote-write-flag";
import { runAuthenticatedCommerceHydrateFromPackage } from "@/lib/commerce/commerce-remote-write-pilot";
import { PACKAGE_PURCHASE_CHECKOUT_HYDRATE_MIGRATION_FILE } from "@/lib/persistence/schema-contract";
import { PACKAGE_REMOTE_READ_PILOT_ENV } from "./package-remote-read-flag";
import { PACKAGE_REMOTE_WRITE_PILOT_ENV } from "./package-remote-write-flag";
import { isPackageRemoteReadPilotEnabled } from "./package-remote-read-flag";
import { isPackageRemoteWritePilotEnabled } from "./package-remote-write-flag";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function packageSnapshot(
  overrides: Partial<CommerceEnginePackageSnapshot> = {},
): CommerceEnginePackageSnapshot {
  return {
    now: new Date("2026-10-06T07:00:00.000Z"),
    actor: {
      authUserId: AUTH_UUID,
      organizationAppId: FUTURE_QA_APPOINTMENT.organizationAppId,
      organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
      operationalStaffId: FUTURE_QA_APPOINTMENT.staffAppId,
      role: "OWNER",
      isActive: true,
      allowedLocationAppIds: null,
    },
    customer: {
      appId: FUTURE_QA_APPOINTMENT.customerAppId,
      dbId: FUTURE_QA_APPOINTMENT.customerDbId,
      organizationAppId: FUTURE_QA_APPOINTMENT.organizationAppId,
      organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
    },
    location: {
      appId: FUTURE_QA_APPOINTMENT.locationAppId,
      dbId: FUTURE_QA_APPOINTMENT.locationDbId,
      organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
    },
    packageDefinition: {
      appId: "pkgdef-breast-10",
      dbId: "11111111-2222-4333-8444-555555555555",
      organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
      name: "性感美胸10堂",
      sessionCount: 10,
      priceMinor: 22000,
      isActive: true,
    },
    drafts: [],
    transactions: [],
    ...overrides,
  };
}

describe("Phase 1C-6H.3A package purchase checkout hydrate", () => {
  it("creates one OPEN PACKAGE_PURCHASE draft and reuses it", () => {
    const snapshot = packageSnapshot();
    const first = hydrateCheckoutFromPackage(snapshot);
    expect(first.draft.status).toBe("OPEN");
    expect(first.transaction).toBeNull();
    expect(first.draft.items).toHaveLength(1);
    expect(first.draft.items[0]?.type).toBe("PACKAGE_PURCHASE");
    expect(first.draft.items[0]?.referenceId).toBe("pkgdef-breast-10");
    expect(first.draft.items[0]?.nameSnapshot).toBe("性感美胸10堂");
    expect(first.draft.items[0]?.sessionCountSnapshot).toBe(10);
    expect(first.draft.items[0]?.unitPrice).toBe(22000);
    expect(first.draft.total).toBe(22000);
    expect(first.draft.customerId).toBe(FUTURE_QA_APPOINTMENT.customerAppId);
    expect(first.draft.locationId).toBe(FUTURE_QA_APPOINTMENT.locationAppId);
    expect(first.draft.createdByStaffId).toBe(FUTURE_QA_APPOINTMENT.staffAppId);
    expect(first.draft.appointmentId).toBeUndefined();
    const second = hydrateCheckoutFromPackage(snapshot);
    expect(second.draft.id).toBe(first.draft.id);
    expect(snapshot.drafts.filter((row) => row.status === "OPEN")).toHaveLength(1);
  });

  it("refuses inactive package definitions", () => {
    expect(() =>
      hydrateCheckoutFromPackage(
        packageSnapshot({
          packageDefinition: {
            appId: "pkgdef-inactive",
            dbId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
            name: "停用套票",
            sessionCount: 10,
            priceMinor: 22000,
            isActive: false,
          },
        }),
      ),
    ).toThrow("套票方案已停用，無法結帳");
  });

  it("keeps package hydrate on Commerce WRITE and does not open Package WRITE", async () => {
    await expect(
      runAuthenticatedCommerceHydrateFromPackage(
        {
          auth: { getUser: async () => ({ data: { user: { id: AUTH_UUID } }, error: null }) },
          from: () => {
            throw new Error("unexpected table read");
          },
          rpc: async () => ({ data: null, error: { message: "off" } }),
        },
        {
          customerId: FUTURE_QA_APPOINTMENT.customerAppId,
          packageId: "pkgdef-breast-10",
          locationId: FUTURE_QA_APPOINTMENT.locationAppId,
        },
      ),
    ).rejects.toThrow(COMMERCE_WRITE_PILOT_OFF_MESSAGE);
    expect(
      isPackageRemoteReadPilotEnabled({ [PACKAGE_REMOTE_READ_PILOT_ENV]: "1" }),
    ).toBe(true);
    expect(
      isPackageRemoteWritePilotEnabled({
        [PACKAGE_REMOTE_READ_PILOT_ENV]: "1",
        [PACKAGE_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isPackageRemoteWritePilotEnabled({ [PACKAGE_REMOTE_WRITE_PILOT_ENV]: "1" }),
    ).toBe(false);
    expect(isPackageRemoteWritePilotEnabled({})).toBe(false);
  });

  it("keeps the hydrate migration additive and entitlement-free", () => {
    const sql = read(PACKAGE_PURCHASE_CHECKOUT_HYDRATE_MIGRATION_FILE);
    expect(sql).toMatch(/create or replace function public\.hydrate_checkout_from_package/);
    expect(sql).toMatch(/idx_checkout_drafts_open_unscheduled/);
    expect(sql).toMatch(/PACKAGE_PURCHASE/);
    expect(sql).toMatch(/session_count_snapshot/);
    expect(sql).toMatch(/grant execute on function public\.hydrate_checkout_from_package/);
    expect(sql).not.toMatch(/insert into public\.customer_packages/i);
    expect(sql).not.toMatch(/insert into public\.package_ledger_entries/i);
    expect(sql).not.toMatch(/settle_checkout_draft/);
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/\btruncate\s+table\b/i);
    expect(sql).not.toMatch(/service_role/);
    expect(COMMERCE_PACKAGE_HYDRATE_RPC).toBe("hydrate_checkout_from_package");
  });

  it("wires sell modal and checkout onto official hydrate without local drafts", () => {
    const modal = read("features/packages/PackageSellModal.tsx");
    const page = read("features/packages/PackagesPageClient.tsx");
    const checkout = read("features/checkout/CheckoutPageClient.tsx");
    const panel = read("features/checkout/CheckoutPanel.tsx");
    const wallet = read("features/customers/tabs/WalletTab.tsx");
    expect(modal).toMatch(/remoteCheckout/);
    expect(modal).toMatch(/customer: selected\.id/);
    expect(modal).toMatch(/package: definition\.id/);
    expect(modal).toMatch(/createEmptyCheckoutDraft/);
    expect(modal).not.toMatch(/completeCheckout/);
    expect(page).toMatch(/usePackageRemoteDefinitions/);
    expect(page).toMatch(/useCustomerRemoteList/);
    expect(page).toMatch(/remoteCheckout/);
    expect(checkout).toMatch(/useCommerceRemotePackageDraft/);
    expect(checkout).toMatch(/toRemotePackageCheckoutItem/);
    expect(checkout).toMatch(/packagePurchaseFlow/);
    expect(panel).toMatch(/PACKAGE PURCHASE/);
    expect(panel).toMatch(/sessionCountSnapshot/);
    expect(wallet).toMatch(/packageRemoteRead/);
    expect(wallet).toMatch(/usePackageRemoteCustomerPackages/);
    expect(wallet).toMatch(/usePackageRemoteDefinitions/);
    expect(wallet).not.toMatch(/hydrate_checkout_from_package/);
    expect(read("app/staff/(app)/packages/page.tsx")).toMatch(/isPackageRemoteReadPilotEnabled/);
    expect(read("app/staff/(app)/packages/page.tsx")).not.toMatch(/package-remote-read-pilot/);
    expect(read("app/staff/(app)/packages/plans/page.tsx")).toMatch(/isPackageRemoteReadPilotEnabled/);
    expect(read("app/staff/(app)/packages/plans/page.tsx")).toMatch(/isPackageRemoteWritePilotEnabled/);
    expect(read("app/staff/(app)/packages/plans/page.tsx")).not.toMatch(
      /package-remote-read-pilot|package-remote-write-pilot/,
    );
    expect(read("features/packages/PackagePlansPageClient.tsx")).toMatch(
      /usePackageRemoteDefinitions/,
    );
    expect(read("lib/packages/package-remote-read-flag.ts")).toMatch(
      /Does not enable BEAUTY_OS_PERSISTENCE/,
    );
    expect(read("lib/packages/package-remote-write-flag.ts")).toMatch(
      /isPackageRemoteReadPilotEnabled/,
    );
  });

  it("does not enable Package WRITE or global persistence in env files", () => {
    for (const file of [".env", ".env.local", ".env.preview", "vercel.json", ".cursor/environment.json"]) {
      if (!existsSync(path.join(process.cwd(), file))) continue;
      const source = read(file);
      expect(source).not.toMatch(/BEAUTY_OS_PACKAGE_REMOTE_WRITE_PILOT/);
      expect(source).not.toMatch(/BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE/);
    }
    expect(read("lib/packages/package-remote-read-flag.ts")).not.toMatch(
      /IdentitySupabaseClient|AuthenticatedPackageReadStore/,
    );
    expect(
      isPackageRemoteReadPilotEnabled({
        [COMMERCE_REMOTE_READ_PILOT_ENV]: "1",
        [COMMERCE_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(false);
  });
});
