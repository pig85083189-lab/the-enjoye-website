import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMERCE_REPAIR_PACKAGE_RPC } from "@/lib/commerce/commerce-remote-engine";
import {
  listUsablePackagesForServiceFromRows,
  usedSessionsForCustomerPackage,
} from "@/lib/packages/package-eligibility";
import type { CustomerPackage, PackageLedgerEntry } from "@/lib/packages/domain";
import { PACKAGE_FULFILLMENT_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

const SERVICE_ID = "svc-muw54el4-7omtyn";

function pkg(over: Partial<CustomerPackage> = {}): CustomerPackage {
  return {
    id: "cpkg-owner-breast",
    organizationId: "org-the-enjoye",
    customerId: "cust-muvxogn2-cljfds",
    packageDefinitionId: "pkgdef-muwezfgv-piqais",
    purchaseTransactionId: "tx-c4f2a4cba49449",
    nameSnapshot: "性感美胸10堂",
    sessionCountSnapshot: 10,
    priceSnapshot: 22000,
    includedServiceIdsSnapshot: [SERVICE_ID],
    purchasedAt: "2026-10-06T00:00:00.000Z",
    status: "ACTIVE",
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
    ...over,
  };
}

function purchaseLedger(): PackageLedgerEntry {
  return {
    id: "plg-purchase",
    organizationId: "org-the-enjoye",
    customerPackageId: "cpkg-owner-breast",
    customerId: "cust-muvxogn2-cljfds",
    type: "PURCHASE",
    sessionDelta: 10,
    createdByStaffId: "staff-001",
    createdAt: "2026-10-06T00:00:00.000Z",
  };
}

describe("Phase 1C-6H.3B package fulfillment + redemption", () => {
  it("adds durable uniqueness before the first customer package", () => {
    const sql = read(PACKAGE_FULFILLMENT_MIGRATION_FILE);
    expect(sql).toMatch(/idx_customer_packages_org_purchase_tx/);
    expect(sql).toMatch(
      /unique index[\s\S]*customer_packages \(organization_id, purchase_transaction_id\)/,
    );
    expect(sql).toMatch(/purchase_transaction_id is not null/);
    expect(sql).toMatch(/create or replace function public\.fulfill_package_purchase_from_transaction/);
    expect(sql).toMatch(/create or replace function public\.repair_package_fulfillment/);
    expect(sql).toMatch(/create or replace function public\.redeem_package_from_checkout/);
    expect(sql).toMatch(/create or replace function public\.settle_checkout_draft/);
    expect(COMMERCE_REPAIR_PACKAGE_RPC).toBe("repair_package_fulfillment");
  });

  it("fulfills from package_definitions and writes an immutable purchase ledger", () => {
    const sql = read(PACKAGE_FULFILLMENT_MIGRATION_FILE);
    expect(sql).toMatch(/insert into public\.customer_packages/);
    expect(sql).toMatch(/insert into public\.package_ledger_entries/);
    expect(sql).toMatch(/from public\.package_definitions/);
    expect(sql).toMatch(/PACKAGE_PURCHASE/);
    expect(sql).toMatch(/session_count_snapshot/);
    expect(sql).toMatch(/included_service_ids_snapshot/);
    expect(sql).toMatch(/:PACKAGE_PURCHASE:/);
    expect(sql).toMatch(/:PACKAGE_REDEMPTION:/);
    expect(sql).not.toMatch(/remaining_sessions/);
    expect(sql).not.toMatch(/name\s*=\s*'性感美胸/);
    expect(sql).not.toMatch(/localStorage/);
    expect(sql).not.toMatch(/grant[\s\S]*service_role/);
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/\btruncate\s+table\b/i);
  });

  it("keeps settlement + redemption in one retry-safe function", () => {
    const sql = read(PACKAGE_FULFILLMENT_MIGRATION_FILE);
    expect(sql).toMatch(/perform public\.apply_package_effects_for_transaction/);
    expect(sql).toMatch(/perform public\.fulfill_package_purchase_from_transaction/);
    expect(sql).toMatch(/perform public\.redeem_package_from_checkout/);
    expect(sql).toMatch(/for update/);
    expect(sql).toMatch(/when unique_violation/);
    expect(sql).toMatch(/method in \('STORED_VALUE', 'PACKAGE'\)/);
    expect(sql).toMatch(/grant execute on function public\.repair_package_fulfillment/);
    expect(sql).toMatch(
      /revoke all on function public\.fulfill_package_purchase_from_transaction/,
    );
    expect(sql).toMatch(/staff_role_is_managerial/);
  });

  it("matches eligibility by canonical service app_id", () => {
    const usable = listUsablePackagesForServiceFromRows(
      [pkg()],
      [purchaseLedger()],
      SERVICE_ID,
    );
    expect(usable).toHaveLength(1);
    expect(usable[0]?.usableBalance).toBe(10);
    expect(
      listUsablePackagesForServiceFromRows([pkg()], [purchaseLedger()], "svc-other"),
    ).toHaveLength(0);
    expect(
      listUsablePackagesForServiceFromRows(
        [pkg({ customerId: "cust-other" })],
        [purchaseLedger()],
        SERVICE_ID,
      ),
    ).toHaveLength(1);
    expect(
      listUsablePackagesForServiceFromRows(
        [pkg({ includedServiceIdsSnapshot: ["svc-other"] })],
        [purchaseLedger()],
        SERVICE_ID,
      ),
    ).toHaveLength(0);
    expect(usedSessionsForCustomerPackage(pkg(), 10)).toBe(0);
    expect(usedSessionsForCustomerPackage(pkg(), 9)).toBe(1);
  });

  it("wires wallet and checkout onto remote entitlements", () => {
    const wallet = read("features/customers/tabs/WalletTab.tsx");
    const panel = read("features/checkout/CheckoutPanel.tsx");
    const page = read("app/staff/(app)/checkout/page.tsx");
    const checkout = read("features/checkout/CheckoutPageClient.tsx");
    expect(wallet).toMatch(/usePackageRemoteCustomerPackages/);
    expect(wallet).toMatch(/usedSessionsForCustomerPackage/);
    expect(wallet).toMatch(/總堂數/);
    expect(wallet).toMatch(/已使用/);
    expect(panel).toMatch(/listUsablePackagesForServiceFromRows/);
    expect(panel).toMatch(/packageRemoteRead/);
    expect(panel).toMatch(/persistRemotePackageRedemption/);
    expect(panel).toMatch(/目前沒有可用於本次服務的套票/);
    expect(page).toMatch(/isPackageRemoteReadPilotEnabled/);
    expect(checkout).toMatch(/packageRemoteReadPilot/);
    expect(read("lib/persistence/authenticated-commerce-store.ts")).toMatch(
      /p_package_redemption/,
    );
    expect(read("lib/persistence/commerce-mapping.ts")).toMatch(
      /packageRedemptionFromRemoteJson/,
    );
  });

  it("does not enable global persistence or service-role browser writes", () => {
    const sql = read(PACKAGE_FULFILLMENT_MIGRATION_FILE);
    expect(sql).not.toMatch(/BEAUTY_OS_PERSISTENCE/);
    expect(read("lib/commerce/commerce-remote-write-pilot.ts")).toMatch(
      /runAuthenticatedCommerceRepairPackageFulfillment/,
    );
    expect(read("lib/commerce/commerce-remote-write-pilot.ts")).not.toMatch(
      /createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/,
    );
    expect(read("features/checkout/CheckoutPanel.tsx")).not.toMatch(
      /createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/,
    );
    for (const file of [".env", ".env.local", ".env.preview", "vercel.json", ".cursor/environment.json"]) {
      if (!existsSync(path.join(process.cwd(), file))) continue;
      const source = read(file);
      expect(source).not.toMatch(/BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE/);
    }
  });
});
