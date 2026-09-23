import { getCustomerById } from "@/data/mock-customers";
import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import { canAccessLocation } from "@/lib/tenant/access";
import {
  getStoredValueAccountsKey,
  getStoredValueLedgerKey,
} from "@/lib/tenant/storage-keys";
import { newId } from "@/lib/repositories/storage";
import { DEFAULT_CURRENCY } from "@/lib/commerce/domain";
import { assertNonNegativeMoney } from "@/lib/commerce/money";
import type {
  StoredValueAccount,
  StoredValueLedgerEntry,
  StoredValueLedgerType,
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

export function listStoredValueAccounts(
  organizationId: string,
  opts?: { customerId?: string },
): StoredValueAccount[] {
  let list = readJson<StoredValueAccount>(
    getStoredValueAccountsKey(organizationId),
    organizationId,
  );
  if (opts?.customerId) list = list.filter((a) => a.customerId === opts.customerId);
  return list;
}

export function getStoredValueAccount(
  organizationId: string,
  accountId: string,
): StoredValueAccount | undefined {
  return listStoredValueAccounts(organizationId).find((a) => a.id === accountId);
}

export function getOrCreateStoredValueAccount(
  organizationId: string,
  customerId: string,
  actorStaffId: string,
): StoredValueAccount {
  assertStaff(organizationId, actorStaffId);
  assertCustomer(organizationId, customerId);
  const existing = listStoredValueAccounts(organizationId, { customerId }).find(
    (a) => a.status === "ACTIVE",
  );
  if (existing) return existing;
  const now = new Date().toISOString();
  const row: StoredValueAccount = {
    id: newId("sva"),
    organizationId,
    customerId,
    currency: DEFAULT_CURRENCY,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  };
  writeJson(getStoredValueAccountsKey(organizationId), organizationId, [
    row,
    ...listStoredValueAccounts(organizationId),
  ]);
  return row;
}

export function listStoredValueLedger(
  organizationId: string,
  opts?: { accountId?: string; customerId?: string },
): StoredValueLedgerEntry[] {
  let list = readJson<StoredValueLedgerEntry>(
    getStoredValueLedgerKey(organizationId),
    organizationId,
  );
  if (opts?.accountId) list = list.filter((e) => e.accountId === opts.accountId);
  if (opts?.customerId) list = list.filter((e) => e.customerId === opts.customerId);
  return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getStoredValueBalance(
  organizationId: string,
  accountId: string,
): number {
  const account = getStoredValueAccount(organizationId, accountId);
  if (!account || account.organizationId !== organizationId) {
    throw new Error("Stored value account not found");
  }
  return listStoredValueLedger(organizationId, { accountId }).reduce(
    (sum, e) => sum + e.amountDelta,
    0,
  );
}

export function getCustomerStoredValueBalance(
  organizationId: string,
  customerId: string,
): number {
  assertCustomer(organizationId, customerId);
  const account = listStoredValueAccounts(organizationId, { customerId }).find(
    (a) => a.status === "ACTIVE",
  );
  if (!account) return 0;
  return getStoredValueBalance(organizationId, account.id);
}

export function findStoredValueLedgerByEffectKey(
  organizationId: string,
  effectKey: string,
): StoredValueLedgerEntry | undefined {
  return listStoredValueLedger(organizationId).find((e) => e.effectKey === effectKey);
}

function appendLedger(
  organizationId: string,
  entry: StoredValueLedgerEntry,
): StoredValueLedgerEntry {
  if (entry.effectKey) {
    const existing = findStoredValueLedgerByEffectKey(organizationId, entry.effectKey);
    if (existing) return existing;
  }
  const balance = listStoredValueLedger(organizationId, {
    accountId: entry.accountId,
  }).reduce((sum, e) => sum + e.amountDelta, 0);
  if (balance + entry.amountDelta < 0) {
    throw new Error("insufficient stored value balance");
  }
  writeJson(getStoredValueLedgerKey(organizationId), organizationId, [
    ...listStoredValueLedger(organizationId),
    entry,
  ]);
  return entry;
}

export function postStoredValueTopUp(
  organizationId: string,
  input: {
    customerId: string;
    amount: number;
    transactionId: string;
    locationId: string;
    createdByStaffId: string;
    effectKey: string;
  },
): StoredValueLedgerEntry {
  assertStaff(organizationId, input.createdByStaffId);
  assertCustomer(organizationId, input.customerId);
  if (!canAccessLocation(organizationId, input.locationId)) {
    throw new Error("Location does not belong to this organization");
  }
  assertNonNegativeMoney(input.amount, "top-up amount");
  if (input.amount === 0) throw new Error("top-up amount cannot be zero");
  const account = getOrCreateStoredValueAccount(
    organizationId,
    input.customerId,
    input.createdByStaffId,
  );
  return appendLedger(organizationId, {
    id: newId("svl"),
    organizationId,
    accountId: account.id,
    customerId: input.customerId,
    type: "TOP_UP",
    amountDelta: input.amount,
    transactionId: input.transactionId,
    locationId: input.locationId,
    effectKey: input.effectKey,
    createdByStaffId: input.createdByStaffId,
    createdAt: new Date().toISOString(),
  });
}

export function postStoredValuePayment(
  organizationId: string,
  input: {
    customerId: string;
    amount: number;
    transactionId: string;
    appointmentId?: string;
    locationId: string;
    createdByStaffId: string;
    effectKey: string;
  },
): StoredValueLedgerEntry {
  assertStaff(organizationId, input.createdByStaffId);
  assertCustomer(organizationId, input.customerId);
  if (!canAccessLocation(organizationId, input.locationId)) {
    throw new Error("Location does not belong to this organization");
  }
  assertNonNegativeMoney(input.amount, "payment amount");
  if (input.amount === 0) throw new Error("payment amount cannot be zero");
  const account = getOrCreateStoredValueAccount(
    organizationId,
    input.customerId,
    input.createdByStaffId,
  );
  if (account.customerId !== input.customerId) {
    throw new Error("Stored value customer mismatch");
  }
  const balance = getStoredValueBalance(organizationId, account.id);
  if (balance < input.amount) throw new Error("insufficient stored value balance");
  return appendLedger(organizationId, {
    id: newId("svl"),
    organizationId,
    accountId: account.id,
    customerId: input.customerId,
    type: "PAYMENT",
    amountDelta: -input.amount,
    transactionId: input.transactionId,
    appointmentId: input.appointmentId,
    locationId: input.locationId,
    effectKey: input.effectKey,
    createdByStaffId: input.createdByStaffId,
    createdAt: new Date().toISOString(),
  });
}

export function adjustStoredValue(
  organizationId: string,
  input: {
    customerId: string;
    amountDelta: number;
    reason: string;
    locationId?: string;
    createdByStaffId: string;
  },
): StoredValueLedgerEntry {
  assertStaff(organizationId, input.createdByStaffId);
  if (!input.reason.trim()) throw new Error("adjustment reason required");
  if (!Number.isInteger(input.amountDelta) || input.amountDelta === 0) {
    throw new Error("amountDelta must be non-zero integer");
  }
  const account = getOrCreateStoredValueAccount(
    organizationId,
    input.customerId,
    input.createdByStaffId,
  );
  return appendLedger(organizationId, {
    id: newId("svl"),
    organizationId,
    accountId: account.id,
    customerId: input.customerId,
    type: "ADJUSTMENT",
    amountDelta: input.amountDelta,
    locationId: input.locationId,
    reason: input.reason.trim(),
    createdByStaffId: input.createdByStaffId,
    createdAt: new Date().toISOString(),
  });
}

export function reverseStoredValueLedgerEntry(
  organizationId: string,
  entryId: string,
  actorStaffId: string,
  reason?: string,
): StoredValueLedgerEntry {
  assertStaff(organizationId, actorStaffId);
  const original = listStoredValueLedger(organizationId).find((e) => e.id === entryId);
  if (!original || original.organizationId !== organizationId) {
    throw new Error("Ledger entry not found");
  }
  if (original.type === "REVERSAL") {
    throw new Error("cannot reverse a reversal entry");
  }
  const already = listStoredValueLedger(organizationId).find(
    (e) => e.type === "REVERSAL" && e.reversesEntryId === entryId,
  );
  if (already) throw new Error("entry already reversed");
  const effectKey = `REV:SV:${entryId}`;
  const existing = findStoredValueLedgerByEffectKey(organizationId, effectKey);
  if (existing) return existing;
  return appendLedger(organizationId, {
    id: newId("svl"),
    organizationId,
    accountId: original.accountId,
    customerId: original.customerId,
    type: "REVERSAL",
    amountDelta: -original.amountDelta,
    transactionId: original.transactionId,
    appointmentId: original.appointmentId,
    locationId: original.locationId,
    reason: reason ?? `Reversal of ${original.id}`,
    effectKey,
    reversesEntryId: entryId,
    createdByStaffId: actorStaffId,
    createdAt: new Date().toISOString(),
  });
}

export type { StoredValueLedgerType };
