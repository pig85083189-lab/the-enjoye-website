/**
 * Checkout package eligibility — same rules for local and remote rows.
 * Identity matching is org + customer + ACTIVE + remaining > 0 + included
 * canonical service app_id. Never name / phone / service-name matching.
 */

import {
  deriveCustomerPackageStatus,
  type CustomerPackage,
  type PackageLedgerEntry,
} from "./domain";

export type UsableCustomerPackage = CustomerPackage & {
  usableBalance: number;
  ledgerBalance: number;
};

export function ledgerBalanceForCustomerPackage(
  ledger: PackageLedgerEntry[],
  customerPackageId: string,
): number {
  return ledger
    .filter((entry) => entry.customerPackageId === customerPackageId)
    .reduce((sum, entry) => sum + entry.sessionDelta, 0);
}

export function usedSessionsForCustomerPackage(
  pkg: Pick<CustomerPackage, "sessionCountSnapshot">,
  ledgerBalance: number,
): number {
  return Math.max(0, pkg.sessionCountSnapshot - Math.max(ledgerBalance, 0));
}

export function listUsablePackagesForServiceFromRows(
  packages: CustomerPackage[],
  ledger: PackageLedgerEntry[],
  serviceId: string,
  nowMs: number = Date.now(),
): UsableCustomerPackage[] {
  if (!serviceId) return [];
  return packages
    .map((pkg) => {
      const ledgerBalance = ledgerBalanceForCustomerPackage(ledger, pkg.id);
      const status = deriveCustomerPackageStatus(pkg, ledgerBalance, nowMs);
      const usableBalance =
        status === "ACTIVE" && ledgerBalance > 0 ? ledgerBalance : 0;
      return { ...pkg, status, ledgerBalance, usableBalance };
    })
    .filter(
      (pkg) =>
        pkg.usableBalance > 0 &&
        pkg.status === "ACTIVE" &&
        pkg.includedServiceIdsSnapshot.includes(serviceId),
    );
}
