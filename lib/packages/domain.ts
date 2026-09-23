/**
 * Package domain — Phase 4.9B.
 * Balance is ALWAYS derived from immutable ledger entries.
 */

export type CustomerPackageStatus = "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "VOIDED";

export type PackageLedgerType =
  | "PURCHASE"
  | "REDEMPTION"
  | "ADJUSTMENT"
  | "REVERSAL";

export interface PackageServiceEntitlement {
  serviceId: string;
  /** Phase 4.9B: always 1 session per redemption */
  sessionsPerRedemption: 1;
}

export interface PackageDefinition {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  includedServices: PackageServiceEntitlement[];
  sessionCount: number;
  priceMinor: number;
  currency: string;
  validityDays?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Purchase-time snapshots — never mutated by definition edits */
export interface CustomerPackage {
  id: string;
  organizationId: string;
  customerId: string;
  packageDefinitionId: string;
  purchaseTransactionId?: string;
  nameSnapshot: string;
  sessionCountSnapshot: number;
  priceSnapshot: number;
  includedServiceIdsSnapshot: string[];
  purchasedAt: string;
  activatedAt?: string;
  expiresAt?: string;
  status: CustomerPackageStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PackageLedgerEntry {
  id: string;
  organizationId: string;
  customerPackageId: string;
  customerId: string;
  type: PackageLedgerType;
  sessionDelta: number;
  serviceId?: string;
  appointmentId?: string;
  treatmentId?: string;
  transactionId?: string;
  locationId?: string;
  reason?: string;
  /** Deterministic idempotency key */
  effectKey?: string;
  reversesEntryId?: string;
  createdByStaffId: string;
  createdAt: string;
}

export const PACKAGE_LEDGER_TYPE_LABEL: Record<PackageLedgerType, string> = {
  PURCHASE: "購買",
  REDEMPTION: "核銷",
  ADJUSTMENT: "調整",
  REVERSAL: "作廢回沖",
};
