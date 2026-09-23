import { getCustomerById } from "@/data/mock-customers";
import { getServiceById } from "@/data/mock-services";
import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import { canAccessLocation } from "@/lib/tenant/access";
import {
  getCustomerPackagesKey,
  getPackageDefinitionsKey,
  getPackageLedgerKey,
} from "@/lib/tenant/storage-keys";
import { newId } from "@/lib/repositories/storage";
import { DEFAULT_CURRENCY } from "@/lib/commerce/domain";
import { assertNonNegativeMoney } from "@/lib/commerce/money";
import type {
  CustomerPackage,
  CustomerPackageStatus,
  PackageDefinition,
  PackageLedgerEntry,
  PackageLedgerType,
  PackageServiceEntitlement,
} from "./domain";

const CHANGE = "enjoye-commerce-change";

function emit(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("beauty-os:commerce-rev", String(Date.now()));
  window.dispatchEvent(new Event(CHANGE));
}

function readJson<T extends { organizationId: string }>(
  key: string,
  organizationId: string,
): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return (JSON.parse(raw) as T[]).filter((r) => r.organizationId === organizationId);
  } catch {
    return [];
  }
}

function writeJson<T extends { organizationId: string }>(
  key: string,
  organizationId: string,
  list: T[],
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    key,
    JSON.stringify(list.filter((r) => r.organizationId === organizationId)),
  );
  emit();
}

function assertStaff(organizationId: string, staffId: string): void {
  const m = SEED_MEMBERSHIPS.find(
    (x) => x.organizationId === organizationId && x.userId === staffId && x.isActive,
  );
  if (!m) throw new Error("Staff membership does not belong to this organization");
}

function assertCustomer(organizationId: string, customerId: string): void {
  const c = getCustomerById(customerId, organizationId);
  if (!c || c.organizationId !== organizationId) {
    throw new Error("Customer does not belong to this organization");
  }
}

function assertServices(
  organizationId: string,
  included: PackageServiceEntitlement[],
): void {
  if (included.length === 0) throw new Error("package requires at least one service");
  for (const row of included) {
    const s = getServiceById(row.serviceId, organizationId);
    if (!s || s.organizationId !== organizationId) {
      throw new Error("Service does not belong to this organization");
    }
  }
}

// ── Definitions ──────────────────────────────────────────────

export function listPackageDefinitions(
  organizationId: string,
  opts?: { activeOnly?: boolean },
): PackageDefinition[] {
  let list = readJson<PackageDefinition>(
    getPackageDefinitionsKey(organizationId),
    organizationId,
  );
  if (opts?.activeOnly) list = list.filter((d) => d.isActive);
  return list;
}

export function getPackageDefinition(
  organizationId: string,
  definitionId: string,
): PackageDefinition | undefined {
  return listPackageDefinitions(organizationId).find((d) => d.id === definitionId);
}

export function createPackageDefinition(
  organizationId: string,
  input: {
    name: string;
    description?: string;
    includedServiceIds: string[];
    sessionCount: number;
    priceMinor: number;
    validityDays?: number;
    createdByStaffId: string;
  },
): PackageDefinition {
  assertStaff(organizationId, input.createdByStaffId);
  if (!input.name.trim()) throw new Error("package name required");
  if (!Number.isInteger(input.sessionCount) || input.sessionCount < 1) {
    throw new Error("sessionCount must be integer >= 1");
  }
  assertNonNegativeMoney(input.priceMinor, "priceMinor");
  const includedServices: PackageServiceEntitlement[] = input.includedServiceIds.map(
    (serviceId) => ({ serviceId, sessionsPerRedemption: 1 as const }),
  );
  assertServices(organizationId, includedServices);
  const now = new Date().toISOString();
  const row: PackageDefinition = {
    id: newId("pkgdef"),
    organizationId,
    name: input.name.trim(),
    description: input.description,
    includedServices,
    sessionCount: input.sessionCount,
    priceMinor: input.priceMinor,
    currency: DEFAULT_CURRENCY,
    validityDays: input.validityDays,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  writeJson(getPackageDefinitionsKey(organizationId), organizationId, [
    row,
    ...listPackageDefinitions(organizationId),
  ]);
  return row;
}

export function updatePackageDefinition(
  organizationId: string,
  definitionId: string,
  patch: Partial<{
    name: string;
    description: string;
    includedServiceIds: string[];
    sessionCount: number;
    priceMinor: number;
    validityDays: number | null;
    isActive: boolean;
  }>,
  actorStaffId: string,
): PackageDefinition {
  assertStaff(organizationId, actorStaffId);
  const current = getPackageDefinition(organizationId, definitionId);
  if (!current || current.organizationId !== organizationId) {
    throw new Error("Package definition not found");
  }
  const includedServices = patch.includedServiceIds
    ? patch.includedServiceIds.map((serviceId) => ({
        serviceId,
        sessionsPerRedemption: 1 as const,
      }))
    : current.includedServices;
  assertServices(organizationId, includedServices);
  if (patch.sessionCount != null) {
    if (!Number.isInteger(patch.sessionCount) || patch.sessionCount < 1) {
      throw new Error("sessionCount must be integer >= 1");
    }
  }
  if (patch.priceMinor != null) assertNonNegativeMoney(patch.priceMinor, "priceMinor");
  const next: PackageDefinition = {
    ...current,
    name: patch.name?.trim() ?? current.name,
    description: patch.description ?? current.description,
    includedServices,
    sessionCount: patch.sessionCount ?? current.sessionCount,
    priceMinor: patch.priceMinor ?? current.priceMinor,
    validityDays:
      patch.validityDays === null
        ? undefined
        : (patch.validityDays ?? current.validityDays),
    isActive: patch.isActive ?? current.isActive,
    updatedAt: new Date().toISOString(),
  };
  writeJson(getPackageDefinitionsKey(organizationId), organizationId, [
    next,
    ...listPackageDefinitions(organizationId).filter((d) => d.id !== definitionId),
  ]);
  return next;
}

export function deactivatePackageDefinition(
  organizationId: string,
  definitionId: string,
  actorStaffId: string,
): PackageDefinition {
  return updatePackageDefinition(
    organizationId,
    definitionId,
    { isActive: false },
    actorStaffId,
  );
}

// ── Ledger ───────────────────────────────────────────────────

export function listPackageLedger(
  organizationId: string,
  opts?: { customerPackageId?: string; customerId?: string },
): PackageLedgerEntry[] {
  let list = readJson<PackageLedgerEntry>(
    getPackageLedgerKey(organizationId),
    organizationId,
  );
  if (opts?.customerPackageId) {
    list = list.filter((e) => e.customerPackageId === opts.customerPackageId);
  }
  if (opts?.customerId) list = list.filter((e) => e.customerId === opts.customerId);
  return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getPackageLedgerBalance(
  organizationId: string,
  customerPackageId: string,
): number {
  return listPackageLedger(organizationId, { customerPackageId }).reduce(
    (sum, e) => sum + e.sessionDelta,
    0,
  );
}

export function findPackageLedgerByEffectKey(
  organizationId: string,
  effectKey: string,
): PackageLedgerEntry | undefined {
  return listPackageLedger(organizationId).find((e) => e.effectKey === effectKey);
}

function appendPackageLedger(
  organizationId: string,
  entry: PackageLedgerEntry,
): PackageLedgerEntry {
  if (entry.organizationId !== organizationId) {
    throw new Error("ledger organization mismatch");
  }
  if (entry.effectKey) {
    const existing = findPackageLedgerByEffectKey(organizationId, entry.effectKey);
    if (existing) return existing;
  }
  writeJson(getPackageLedgerKey(organizationId), organizationId, [
    ...listPackageLedger(organizationId),
    entry,
  ]);
  return entry;
}

// ── Customer packages ────────────────────────────────────────

export function listCustomerPackages(
  organizationId: string,
  opts?: { customerId?: string; status?: CustomerPackageStatus },
): CustomerPackage[] {
  let list = readJson<CustomerPackage>(
    getCustomerPackagesKey(organizationId),
    organizationId,
  );
  if (opts?.customerId) list = list.filter((p) => p.customerId === opts.customerId);
  if (opts?.status) list = list.filter((p) => p.status === opts.status);
  return list;
}

export function getCustomerPackage(
  organizationId: string,
  customerPackageId: string,
): CustomerPackage | undefined {
  return listCustomerPackages(organizationId).find((p) => p.id === customerPackageId);
}

function deriveStatus(pkg: CustomerPackage, ledgerBalance: number): CustomerPackageStatus {
  if (pkg.status === "VOIDED") return "VOIDED";
  if (pkg.expiresAt && new Date(pkg.expiresAt).getTime() < Date.now()) return "EXPIRED";
  if (ledgerBalance <= 0) return "EXHAUSTED";
  return "ACTIVE";
}

export function getPackageUsableBalance(
  organizationId: string,
  customerPackageId: string,
): { ledgerBalance: number; usableBalance: number; status: CustomerPackageStatus } {
  const pkg = getCustomerPackage(organizationId, customerPackageId);
  if (!pkg || pkg.organizationId !== organizationId) {
    throw new Error("Customer package not found");
  }
  const ledgerBalance = getPackageLedgerBalance(organizationId, customerPackageId);
  const status = deriveStatus(pkg, ledgerBalance);
  const usableBalance =
    status === "ACTIVE" && ledgerBalance > 0 ? ledgerBalance : 0;
  return { ledgerBalance, usableBalance, status };
}

export function syncCustomerPackageStatus(
  organizationId: string,
  customerPackageId: string,
): CustomerPackage {
  const pkg = getCustomerPackage(organizationId, customerPackageId);
  if (!pkg) throw new Error("Customer package not found");
  const { status } = getPackageUsableBalance(organizationId, customerPackageId);
  if (status === pkg.status) return pkg;
  const next = { ...pkg, status, updatedAt: new Date().toISOString() };
  writeJson(getCustomerPackagesKey(organizationId), organizationId, [
    next,
    ...listCustomerPackages(organizationId).filter((p) => p.id !== customerPackageId),
  ]);
  return next;
}

export function createCustomerPackageFromPurchase(
  organizationId: string,
  input: {
    customerId: string;
    packageDefinitionId: string;
    purchaseTransactionId: string;
    locationId: string;
    createdByStaffId: string;
    effectKey: string;
  },
): { customerPackage: CustomerPackage; entry: PackageLedgerEntry } {
  assertStaff(organizationId, input.createdByStaffId);
  assertCustomer(organizationId, input.customerId);
  if (!canAccessLocation(organizationId, input.locationId)) {
    throw new Error("Location does not belong to this organization");
  }
  const def = getPackageDefinition(organizationId, input.packageDefinitionId);
  if (!def || !def.isActive) throw new Error("Package definition not found or inactive");

  const existingPurchase = findPackageLedgerByEffectKey(organizationId, input.effectKey);
  if (existingPurchase) {
    const pkg = getCustomerPackage(organizationId, existingPurchase.customerPackageId);
    if (!pkg) throw new Error("Customer package missing for existing purchase");
    return { customerPackage: pkg, entry: existingPurchase };
  }

  const now = new Date();
  const expiresAt =
    def.validityDays != null
      ? new Date(now.getTime() + def.validityDays * 86_400_000).toISOString()
      : undefined;
  const pkg: CustomerPackage = {
    id: newId("cpkg"),
    organizationId,
    customerId: input.customerId,
    packageDefinitionId: def.id,
    purchaseTransactionId: input.purchaseTransactionId,
    nameSnapshot: def.name,
    sessionCountSnapshot: def.sessionCount,
    priceSnapshot: def.priceMinor,
    includedServiceIdsSnapshot: def.includedServices.map((s) => s.serviceId),
    purchasedAt: now.toISOString(),
    activatedAt: now.toISOString(),
    expiresAt,
    status: "ACTIVE",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  writeJson(getCustomerPackagesKey(organizationId), organizationId, [
    pkg,
    ...listCustomerPackages(organizationId),
  ]);

  const entry = appendPackageLedger(organizationId, {
    id: newId("plg"),
    organizationId,
    customerPackageId: pkg.id,
    customerId: input.customerId,
    type: "PURCHASE",
    sessionDelta: def.sessionCount,
    transactionId: input.purchaseTransactionId,
    locationId: input.locationId,
    effectKey: input.effectKey,
    createdByStaffId: input.createdByStaffId,
    createdAt: now.toISOString(),
  });
  return { customerPackage: pkg, entry };
}

export function redeemPackageSession(
  organizationId: string,
  input: {
    customerPackageId: string;
    customerId: string;
    serviceId: string;
    locationId: string;
    appointmentId?: string;
    treatmentId?: string;
    transactionId: string;
    createdByStaffId: string;
    effectKey: string;
  },
): PackageLedgerEntry {
  assertStaff(organizationId, input.createdByStaffId);
  assertCustomer(organizationId, input.customerId);
  if (!canAccessLocation(organizationId, input.locationId)) {
    throw new Error("Location does not belong to this organization");
  }
  const existing = findPackageLedgerByEffectKey(organizationId, input.effectKey);
  if (existing) return existing;

  const pkg = getCustomerPackage(organizationId, input.customerPackageId);
  if (!pkg || pkg.organizationId !== organizationId) {
    throw new Error("Customer package not found");
  }
  if (pkg.customerId !== input.customerId) {
    throw new Error("Package customer mismatch");
  }
  const { usableBalance, status } = getPackageUsableBalance(
    organizationId,
    input.customerPackageId,
  );
  if (status === "EXPIRED") throw new Error("Package expired");
  if (status === "VOIDED") throw new Error("Package voided");
  if (usableBalance < 1) throw new Error("insufficient package sessions");
  if (!pkg.includedServiceIdsSnapshot.includes(input.serviceId)) {
    throw new Error("Service not eligible for this package");
  }
  const service = getServiceById(input.serviceId, organizationId);
  if (!service || service.organizationId !== organizationId) {
    throw new Error("Service does not belong to this organization");
  }

  const entry = appendPackageLedger(organizationId, {
    id: newId("plg"),
    organizationId,
    customerPackageId: pkg.id,
    customerId: input.customerId,
    type: "REDEMPTION",
    sessionDelta: -1,
    serviceId: input.serviceId,
    appointmentId: input.appointmentId,
    treatmentId: input.treatmentId,
    transactionId: input.transactionId,
    locationId: input.locationId,
    effectKey: input.effectKey,
    createdByStaffId: input.createdByStaffId,
    createdAt: new Date().toISOString(),
  });
  syncCustomerPackageStatus(organizationId, pkg.id);
  return entry;
}

export function adjustPackageSessions(
  organizationId: string,
  input: {
    customerPackageId: string;
    sessionDelta: number;
    reason: string;
    locationId?: string;
    createdByStaffId: string;
  },
): PackageLedgerEntry {
  assertStaff(organizationId, input.createdByStaffId);
  if (!input.reason.trim()) throw new Error("adjustment reason required");
  if (!Number.isInteger(input.sessionDelta) || input.sessionDelta === 0) {
    throw new Error("sessionDelta must be non-zero integer");
  }
  const pkg = getCustomerPackage(organizationId, input.customerPackageId);
  if (!pkg) throw new Error("Customer package not found");
  const balance = getPackageLedgerBalance(organizationId, pkg.id);
  if (balance + input.sessionDelta < 0) {
    throw new Error("adjustment would make balance negative");
  }
  const entry = appendPackageLedger(organizationId, {
    id: newId("plg"),
    organizationId,
    customerPackageId: pkg.id,
    customerId: pkg.customerId,
    type: "ADJUSTMENT",
    sessionDelta: input.sessionDelta,
    locationId: input.locationId,
    reason: input.reason.trim(),
    createdByStaffId: input.createdByStaffId,
    createdAt: new Date().toISOString(),
  });
  syncCustomerPackageStatus(organizationId, pkg.id);
  return entry;
}

export function reversePackageLedgerEntry(
  organizationId: string,
  entryId: string,
  actorStaffId: string,
  reason?: string,
): PackageLedgerEntry {
  assertStaff(organizationId, actorStaffId);
  const original = listPackageLedger(organizationId).find((e) => e.id === entryId);
  if (!original || original.organizationId !== organizationId) {
    throw new Error("Ledger entry not found");
  }
  if (original.type === "REVERSAL") {
    throw new Error("cannot reverse a reversal entry");
  }
  const already = listPackageLedger(organizationId).find(
    (e) => e.type === "REVERSAL" && e.reversesEntryId === entryId,
  );
  if (already) throw new Error("entry already reversed");

  const effectKey = `REV:PKG:${entryId}`;
  const existing = findPackageLedgerByEffectKey(organizationId, effectKey);
  if (existing) return existing;

  const entry = appendPackageLedger(organizationId, {
    id: newId("plg"),
    organizationId,
    customerPackageId: original.customerPackageId,
    customerId: original.customerId,
    type: "REVERSAL",
    sessionDelta: -original.sessionDelta,
    serviceId: original.serviceId,
    appointmentId: original.appointmentId,
    treatmentId: original.treatmentId,
    transactionId: original.transactionId,
    locationId: original.locationId,
    reason: reason ?? `Reversal of ${original.id}`,
    effectKey,
    reversesEntryId: entryId,
    createdByStaffId: actorStaffId,
    createdAt: new Date().toISOString(),
  });
  syncCustomerPackageStatus(organizationId, original.customerPackageId);
  return entry;
}

export function listUsablePackagesForService(
  organizationId: string,
  customerId: string,
  serviceId: string,
): Array<CustomerPackage & { usableBalance: number; ledgerBalance: number }> {
  return listCustomerPackages(organizationId, { customerId })
    .map((pkg) => {
      const bal = getPackageUsableBalance(organizationId, pkg.id);
      return { ...pkg, ...bal };
    })
    .filter(
      (p) =>
        p.usableBalance > 0 &&
        p.includedServiceIdsSnapshot.includes(serviceId) &&
        p.status === "ACTIVE",
    );
}

export type { PackageLedgerType };
