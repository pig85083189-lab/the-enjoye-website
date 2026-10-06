import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("Package catalog source consistency", () => {
  it("uses the same remote package_definitions hook on every catalog surface", () => {
    const plans = read("features/packages/PackagePlansPageClient.tsx");
    const holdings = read("features/packages/PackagesPageClient.tsx");
    const wallet = read("features/customers/tabs/WalletTab.tsx");
    const checkout = read("features/checkout/CheckoutPageClient.tsx");
    expect(plans).toMatch(/usePackageRemoteDefinitions/);
    expect(plans).toMatch(/if \(packageRemoteReadPilot\) return rowsFromPackageRemoteState/);
    expect(plans).not.toMatch(/listPackageDefinitions\(organization\.id\).*packageRemoteReadPilot/);
    expect(holdings).toMatch(/usePackageRemoteDefinitions/);
    expect(holdings).toMatch(/if \(packageRemoteReadPilot\) return rowsFromPackageRemoteState\(remoteDefinitions\)/);
    expect(wallet).toMatch(/usePackageRemoteDefinitions/);
    expect(wallet).toMatch(/packageRemoteRead\s*\n\s*\? rowsFromPackageRemoteState\(remoteDefinitions\)/);
    expect(checkout).toMatch(/useCommerceRemotePackageDraft/);
    expect(checkout).not.toMatch(/listPackageDefinitions/);
  });

  it("does not seed, rematch by name, or dual-write local packages when remote is on", () => {
    const plans = read("features/packages/PackagePlansPageClient.tsx");
    const editor = read("features/packages/PackagePlanEditorDialog.tsx");
    const write = read("lib/packages/package-remote-write-pilot.ts");
    const hook = read("features/packages/use-package-remote-write.ts");
    expect(plans).not.toMatch(/createPackageDefinition\(/);
    expect(plans).not.toMatch(/性感美胸10堂/);
    expect(editor).toMatch(/if \(remoteWritePilot\)/);
    expect(editor).toMatch(/submitPackageRemoteCreate/);
    expect(write).not.toMatch(/localStorage\.setItem|from ["']@\/lib\/packages\/store["']/);
    expect(write).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(write).not.toMatch(/createPurchasedPackage|redeemSession|insertCustomerPackage/);
    expect(hook).toMatch(/emitPackageRemoteWriteRefresh/);
    expect(hook).not.toMatch(/createPackageDefinition\(/);
  });

  it("keeps Package WRITE create-only and out of repo env files", () => {
    expect(read("lib/packages/package-remote-write-flag.ts")).toMatch(
      /Package Definition CREATE only/,
    );
    expect(read("lib/packages/package-remote-write-pilot.ts")).toMatch(
      /No Customer Package fulfillment/,
    );
    for (const file of [".env", ".env.local", ".env.preview", "vercel.json", ".cursor/environment.json"]) {
      if (!existsSync(path.join(process.cwd(), file))) continue;
      expect(read(file)).not.toMatch(/BEAUTY_OS_PACKAGE_REMOTE_WRITE_PILOT/);
    }
  });
});
