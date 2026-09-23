/**
 * Phase 4.10A — Canonical full Transaction void + ledger reversal orchestration.
 * UI must not call reversePackage / reverseStoredValue / mark void directly for voids.
 */

import type { StaffRole } from "@/types/saas";
import {
  EXTERNAL_PAYMENT_METHODS,
  type PaymentMethod,
  type Transaction,
} from "@/lib/commerce/domain";
import {
  getTransaction,
  markTransactionVoided,
} from "@/lib/commerce/transaction-store";
import { getActiveMembership } from "@/lib/tenant/access";
import type { PackageLedgerEntry } from "@/lib/packages/domain";
import {
  getPackageLedgerBalance,
  listPackageLedger,
  markCustomerPackageVoided,
  reversePackageLedgerEntry,
} from "@/lib/packages/store";
import type { StoredValueLedgerEntry } from "@/lib/stored-value/domain";
import {
  getCustomerStoredValueBalance,
  listStoredValueLedger,
  reverseStoredValueLedgerEntry,
} from "@/lib/stored-value/store";
import type { InventoryMovement } from "@/lib/inventory/domain";
import {
  listSaleMovementsForTransaction,
  listInventoryMovements,
  reverseInventoryMovement,
} from "@/lib/inventory/store";

const VOID_ALLOWED_ROLES: ReadonlySet<StaffRole> = new Set(["OWNER", "MANAGER"]);

export interface VoidExternalTenderAction {
  method: PaymentMethod;
  amount: number;
  /** Prototype: no gateway — cash/card/transfer/other need manual store handling */
  status: "MANUAL_EXTERNAL_REQUIRED";
}

export interface VoidTransactionResult {
  transaction: Transaction;
  alreadyVoided: boolean;
  packageReversals: PackageLedgerEntry[];
  storedValueReversals: StoredValueLedgerEntry[];
  inventoryReversals: InventoryMovement[];
  externalTenderActions: VoidExternalTenderAction[];
}

export function canActorVoidTransaction(
  organizationId: string,
  actorStaffId: string,
): boolean {
  const membership = getActiveMembership(organizationId, actorStaffId);
  return Boolean(membership && VOID_ALLOWED_ROLES.has(membership.role));
}

export function buildExternalTenderActions(
  transaction: Transaction,
): VoidExternalTenderAction[] {
  return transaction.payments
    .filter((p) =>
      (EXTERNAL_PAYMENT_METHODS as PaymentMethod[]).includes(p.method),
    )
    .map((p) => ({
      method: p.method,
      amount: p.amount,
      status: "MANUAL_EXTERNAL_REQUIRED" as const,
    }));
}

function listOriginalPackageEffects(
  organizationId: string,
  transactionId: string,
): PackageLedgerEntry[] {
  return listPackageLedger(organizationId).filter(
    (e) =>
      e.transactionId === transactionId &&
      e.organizationId === organizationId &&
      e.type !== "REVERSAL",
  );
}

function listOriginalStoredValueEffects(
  organizationId: string,
  transactionId: string,
): StoredValueLedgerEntry[] {
  return listStoredValueLedger(organizationId).filter(
    (e) =>
      e.transactionId === transactionId &&
      e.organizationId === organizationId &&
      e.type !== "REVERSAL",
  );
}

function isAlreadyReversedPackage(
  organizationId: string,
  entryId: string,
): boolean {
  return listPackageLedger(organizationId).some(
    (e) => e.type === "REVERSAL" && e.reversesEntryId === entryId,
  );
}

function isAlreadyReversedStoredValue(
  organizationId: string,
  entryId: string,
): boolean {
  return listStoredValueLedger(organizationId).some(
    (e) => e.type === "REVERSAL" && e.reversesEntryId === entryId,
  );
}

function prevalidatePackageReversals(
  organizationId: string,
  originals: PackageLedgerEntry[],
): void {
  const pending = originals.filter((e) => !isAlreadyReversedPackage(organizationId, e.id));
  const sim = new Map<string, number>();
  for (const entry of pending) {
    if (!sim.has(entry.customerPackageId)) {
      sim.set(
        entry.customerPackageId,
        getPackageLedgerBalance(organizationId, entry.customerPackageId),
      );
    }
    const next = (sim.get(entry.customerPackageId) ?? 0) + -entry.sessionDelta;
    if (next < 0) {
      if (entry.type === "PURCHASE") {
        throw new Error(
          "此套票已有使用紀錄，無法直接作廢原購買交易。",
        );
      }
      throw new Error("package reversal would make balance negative");
    }
    sim.set(entry.customerPackageId, next);
  }
}

function prevalidateStoredValueReversals(
  organizationId: string,
  customerId: string,
  originals: StoredValueLedgerEntry[],
): void {
  const pending = originals.filter(
    (e) => !isAlreadyReversedStoredValue(organizationId, e.id),
  );
  let sim = getCustomerStoredValueBalance(organizationId, customerId);
  for (const entry of pending) {
    const next = sim + -entry.amountDelta;
    if (next < 0) {
      if (entry.type === "TOP_UP") {
        throw new Error(
          "此儲值已有消費紀錄，無法直接作廢原儲值交易。",
        );
      }
      throw new Error("stored-value reversal would make balance negative");
    }
    sim = next;
  }
}

function collectExistingReversals(
  organizationId: string,
  transactionId: string,
): {
  packageReversals: PackageLedgerEntry[];
  storedValueReversals: StoredValueLedgerEntry[];
  inventoryReversals: InventoryMovement[];
} {
  return {
    packageReversals: listPackageLedger(organizationId).filter(
      (e) =>
        e.transactionId === transactionId &&
        e.type === "REVERSAL" &&
        e.organizationId === organizationId,
    ),
    storedValueReversals: listStoredValueLedger(organizationId).filter(
      (e) =>
        e.transactionId === transactionId &&
        e.type === "REVERSAL" &&
        e.organizationId === organizationId,
    ),
    inventoryReversals: listInventoryMovements(organizationId, {
      transactionId,
    }).filter((m) => m.type === "REVERSAL"),
  };
}

/**
 * Full transaction void. Prevalidates all ledger safety, then writes reversals
 * and marks VOIDED. Failed validation leaves COMPLETED + ledgers unchanged.
 */
export function voidTransaction(
  organizationId: string,
  transactionId: string,
  input: { actorStaffId: string; reason: string },
): VoidTransactionResult {
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("void reason required");
  }

  // Membership first (tenant boundary), then TX lookup (same-id / wrong-org → not found),
  // then role authorization — so cross-tenant probes do not leak "Unauthorized".
  const membership = getActiveMembership(organizationId, input.actorStaffId);
  if (!membership) {
    throw new Error("Staff membership does not belong to this organization");
  }

  const tx = getTransaction(organizationId, transactionId);
  if (!tx || tx.organizationId !== organizationId) {
    throw new Error("Transaction not found");
  }

  if (!VOID_ALLOWED_ROLES.has(membership.role)) {
    throw new Error("Unauthorized to void transactions");
  }

  const externalTenderActions = buildExternalTenderActions(tx);

  if (tx.status === "VOIDED") {
    const existing = collectExistingReversals(organizationId, transactionId);
    return {
      transaction: tx,
      alreadyVoided: true,
      packageReversals: existing.packageReversals,
      storedValueReversals: existing.storedValueReversals,
      inventoryReversals: existing.inventoryReversals,
      externalTenderActions,
    };
  }

  if (tx.status !== "COMPLETED") {
    throw new Error("Only COMPLETED transactions can be voided");
  }

  const packageOriginals = listOriginalPackageEffects(organizationId, transactionId);
  const storedValueOriginals = listOriginalStoredValueEffects(
    organizationId,
    transactionId,
  );
  const saleMovements = listSaleMovementsForTransaction(
    organizationId,
    transactionId,
  );

  // Full prevalidation before any write
  prevalidatePackageReversals(organizationId, packageOriginals);
  prevalidateStoredValueReversals(
    organizationId,
    tx.customerId,
    storedValueOriginals,
  );
  // Inventory REVERSAL of SALE is always +qty; ownership already scoped by transactionId

  const packageReversals: PackageLedgerEntry[] = [];
  const storedValueReversals: StoredValueLedgerEntry[] = [];
  const inventoryReversals: InventoryMovement[] = [];
  const purchasePackageIds = new Set<string>();

  for (const entry of packageOriginals) {
    if (entry.type === "PURCHASE") {
      purchasePackageIds.add(entry.customerPackageId);
    }
    const rev = reversePackageLedgerEntry(
      organizationId,
      entry.id,
      input.actorStaffId,
      reason,
    );
    packageReversals.push(rev);
  }

  for (const entry of storedValueOriginals) {
    const rev = reverseStoredValueLedgerEntry(
      organizationId,
      entry.id,
      input.actorStaffId,
      reason,
    );
    storedValueReversals.push(rev);
  }

  for (const sale of saleMovements) {
    const rev = reverseInventoryMovement(
      organizationId,
      sale.id,
      input.actorStaffId,
      reason,
    );
    inventoryReversals.push(rev);
  }

  for (const packageId of purchasePackageIds) {
    if (getPackageLedgerBalance(organizationId, packageId) === 0) {
      markCustomerPackageVoided(organizationId, packageId, input.actorStaffId);
    }
  }

  const voided = markTransactionVoided(organizationId, transactionId, {
    voidedByStaffId: input.actorStaffId,
    voidReason: reason,
  });

  return {
    transaction: voided,
    alreadyVoided: false,
    packageReversals,
    storedValueReversals,
    inventoryReversals,
    externalTenderActions,
  };
}
