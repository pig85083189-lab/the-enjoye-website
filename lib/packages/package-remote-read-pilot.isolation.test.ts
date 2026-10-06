import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_REMOTE_READ_ONLY_MESSAGE } from "@/lib/persistence/authenticated-package-read-store";
import {
  PACKAGE_REMOTE_READ_PILOT_ENV,
  isPackageRemoteReadPilotEnabled,
} from "./package-remote-read-flag";
import { PACKAGE_REMOTE_WRITE_PILOT_ENV } from "./package-remote-write-flag";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("Phase 1C-6H.3A package remote read pilot", () => {
  it("fails closed unless the explicit Package READ env is 1", () => {
    expect(PACKAGE_REMOTE_READ_PILOT_ENV).toBe("BEAUTY_OS_PACKAGE_REMOTE_READ_PILOT");
    expect(isPackageRemoteReadPilotEnabled({})).toBe(false);
    expect(isPackageRemoteReadPilotEnabled({ [PACKAGE_REMOTE_READ_PILOT_ENV]: "true" })).toBe(
      false,
    );
    expect(isPackageRemoteReadPilotEnabled({ [PACKAGE_REMOTE_READ_PILOT_ENV]: "1" })).toBe(true);
  });

  it("keeps the read store write-refusing and independent of global persistence", () => {
    const store = read("lib/persistence/authenticated-package-read-store.ts");
    const pilot = read("lib/packages/package-remote-read-pilot.ts");
    const flag = read("lib/packages/package-remote-read-flag.ts");
    expect(store).toMatch(/Package remote path is read-only/);
    expect(store).toMatch(/insertDefinition\(\): never/);
    expect(store).toMatch(/insertCustomerPackage\(\): never/);
    expect(store).toMatch(/insertPackageLedger\(\): never/);
    expect(store).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(pilot).toMatch(/Does not enable BEAUTY_OS_PERSISTENCE/);
    expect(pilot).not.toMatch(/createPurchasedPackage|redeemSession/);
    expect(flag).not.toMatch(/AuthenticatedPackageReadStore|IdentitySupabaseClient/);
    expect(PACKAGE_REMOTE_READ_ONLY_MESSAGE).toBe("Package remote path is read-only");
    expect(PACKAGE_REMOTE_WRITE_PILOT_ENV).toBe("BEAUTY_OS_PACKAGE_REMOTE_WRITE_PILOT");
  });
});
