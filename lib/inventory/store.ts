/**
 * Inventory movement store — Phase 4.10C.
 * Balance = SUM(quantityDelta) per org + location + product.
 */

import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import { canAccessLocation } from "@/lib/tenant/access";
import { getInventoryMovementsKey } from "@/lib/tenant/storage-keys";
import { newId } from "@/lib/repositories/storage";
import { getProductById } from "@/lib/products/store";
import type { StaffRole } from "@/types/saas";
import type { InventoryMovement, InventoryMovementType } from "./domain";

const CHANGE = "enjoye-commerce-change";

const INVENTORY_MANAGE_ROLES: ReadonlySet<StaffRole> = new Set([
  "OWNER",
  "MANAGER",
]);

function emit(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("beauty-os:commerce-rev", String(Date.now()));
  window.dispatchEvent(new Event(CHANGE));
}

function readAll(organizationId: string): InventoryMovement[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getInventoryMovementsKey(organizationId));
    if (!raw) return [];
    return (JSON.parse(raw) as InventoryMovement[]).filter(
      (m) => m.organizationId === organizationId,
    );
  } catch {
    return [];
  }
}

function writeAll(organizationId: string, list: InventoryMovement[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    getInventoryMovementsKey(organizationId),
    JSON.stringify(list.filter((m) => m.organizationId === organizationId)),
  );
  emit();
}

function assertStaff(organizationId: string, staffId: string) {
  const m = SEED_MEMBERSHIPS.find(
    (x) =>
      x.organizationId === organizationId &&
      x.userId === staffId &&
      x.isActive,
  );
  if (!m) throw new Error("Staff membership does not belong to this organization");
  return m;
}

function assertCanManage(organizationId: string, staffId: string) {
  const m = assertStaff(organizationId, staffId);
  if (!INVENTORY_MANAGE_ROLES.has(m.role)) {
    throw new Error("Unauthorized to manage inventory");
  }
  return m;
}

function assertStaffLocation(
  organizationId: string,
  locationId: string,
  staffId: string,
): void {
  const m = assertStaff(organizationId, staffId);
  if (!canAccessLocation(organizationId, locationId)) {
    throw new Error("Location does not belong to this organization");
  }
  if (!m.locationIds.includes(locationId)) {
    throw new Error("Staff cannot access this location");
  }
}

function assertProduct(organizationId: string, productId: string) {
  const p = getProductById(organizationId, productId);
  if (!p || p.organizationId !== organizationId) {
    throw new Error("Product does not belong to this organization");
  }
  return p;
}

function assertIntegerQty(n: number, label: string): number {
  if (!Number.isInteger(n)) throw new Error(`${label} must be an integer`);
  return n;
}

function appendMovement(
  organizationId: string,
  entry: InventoryMovement,
): InventoryMovement {
  if (entry.organizationId !== organizationId) {
    throw new Error("Inventory movement organization mismatch");
  }
  if (entry.effectKey) {
    const existing = findMovementByEffectKey(organizationId, entry.effectKey);
    if (existing) return existing;
  }
  writeAll(organizationId, [entry, ...readAll(organizationId)]);
  return entry;
}

export function canActorManageInventory(
  organizationId: string,
  actorStaffId: string,
): boolean {
  const m = SEED_MEMBERSHIPS.find(
    (x) =>
      x.organizationId === organizationId &&
      x.userId === actorStaffId &&
      x.isActive,
  );
  return Boolean(m && INVENTORY_MANAGE_ROLES.has(m.role));
}

export function findMovementByEffectKey(
  organizationId: string,
  effectKey: string,
): InventoryMovement | undefined {
  return listInventoryMovements(organizationId).find(
    (m) => m.effectKey === effectKey,
  );
}

export function listInventoryMovements(
  organizationId: string,
  opts?: {
    locationId?: string;
    productId?: string;
    transactionId?: string;
  },
): InventoryMovement[] {
  let list = readAll(organizationId);
  if (opts?.locationId) {
    list = list.filter((m) => m.locationId === opts.locationId);
  }
  if (opts?.productId) {
    list = list.filter((m) => m.productId === opts.productId);
  }
  if (opts?.transactionId) {
    list = list.filter((m) => m.transactionId === opts.transactionId);
  }
  return [...list].sort((a, b) => {
    const t = a.createdAt.localeCompare(b.createdAt);
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
}

/** Canonical stock at a location — SUM(quantityDelta). Never UI-reduced. */
export function getProductStock(
  organizationId: string,
  locationId: string,
  productId: string,
): number {
  return listInventoryMovements(organizationId, { locationId, productId }).reduce(
    (sum, m) => sum + m.quantityDelta,
    0,
  );
}

export function listInventoryByLocation(
  organizationId: string,
  locationId: string,
): Array<{ productId: string; stock: number }> {
  const map = new Map<string, number>();
  for (const m of listInventoryMovements(organizationId, { locationId })) {
    map.set(m.productId, (map.get(m.productId) ?? 0) + m.quantityDelta);
  }
  return [...map.entries()]
    .map(([productId, stock]) => ({ productId, stock }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

export function listProductInventoryAcrossLocations(
  organizationId: string,
  productId: string,
): Array<{ locationId: string; stock: number }> {
  const map = new Map<string, number>();
  for (const m of listInventoryMovements(organizationId, { productId })) {
    map.set(m.locationId, (map.get(m.locationId) ?? 0) + m.quantityDelta);
  }
  return [...map.entries()]
    .map(([locationId, stock]) => ({ locationId, stock }))
    .sort((a, b) => a.locationId.localeCompare(b.locationId));
}

export function receiveStock(
  organizationId: string,
  input: {
    productId: string;
    locationId: string;
    quantity: number;
    note?: string;
    createdByStaffId: string;
  },
): InventoryMovement {
  assertCanManage(organizationId, input.createdByStaffId);
  assertStaffLocation(organizationId, input.locationId, input.createdByStaffId);
  assertProduct(organizationId, input.productId);
  const qty = assertIntegerQty(input.quantity, "receive quantity");
  if (qty <= 0) throw new Error("receive quantity must be > 0");

  return appendMovement(organizationId, {
    id: newId("inv"),
    organizationId,
    locationId: input.locationId,
    productId: input.productId,
    type: "RECEIVE",
    quantityDelta: qty,
    note: input.note?.trim() || undefined,
    createdAt: new Date().toISOString(),
    createdByStaffId: input.createdByStaffId,
  });
}

export function adjustInventory(
  organizationId: string,
  input: {
    productId: string;
    locationId: string;
    quantityDelta: number;
    reason: string;
    createdByStaffId: string;
  },
): InventoryMovement {
  assertCanManage(organizationId, input.createdByStaffId);
  assertStaffLocation(organizationId, input.locationId, input.createdByStaffId);
  assertProduct(organizationId, input.productId);
  const delta = assertIntegerQty(input.quantityDelta, "adjustment delta");
  if (delta === 0) throw new Error("adjustment delta cannot be zero");
  const reason = input.reason.trim();
  if (!reason) throw new Error("adjustment reason required");

  const current = getProductStock(
    organizationId,
    input.locationId,
    input.productId,
  );
  if (current + delta < 0) {
    throw new Error(
      `調整後庫存不可為負（${input.locationId} 目前 ${current}，調整 ${delta}）`,
    );
  }

  return appendMovement(organizationId, {
    id: newId("inv"),
    organizationId,
    locationId: input.locationId,
    productId: input.productId,
    type: "ADJUSTMENT",
    quantityDelta: delta,
    reason,
    createdAt: new Date().toISOString(),
    createdByStaffId: input.createdByStaffId,
  });
}

export interface ProductStockRequirement {
  productId: string;
  productName: string;
  quantity: number;
  itemIds: string[];
}

/** Aggregate PRODUCT lines by productId for stock prevalidation. */
export function aggregateProductRequirements(
  items: Array<{
    id: string;
    type: string;
    referenceId?: string;
    nameSnapshot: string;
    quantity: number;
  }>,
): ProductStockRequirement[] {
  const map = new Map<string, ProductStockRequirement>();
  for (const item of items) {
    if (item.type !== "PRODUCT" || !item.referenceId) continue;
    const cur = map.get(item.referenceId);
    if (cur) {
      cur.quantity += item.quantity;
      cur.itemIds.push(item.id);
    } else {
      map.set(item.referenceId, {
        productId: item.referenceId,
        productName: item.nameSnapshot,
        quantity: item.quantity,
        itemIds: [item.id],
      });
    }
  }
  return [...map.values()];
}

/**
 * Fail-closed stock check before any settle writes.
 * Uses location stock only — never org total.
 */
export function assertInventoryAvailableForSale(
  organizationId: string,
  locationId: string,
  items: Array<{
    id: string;
    type: string;
    referenceId?: string;
    nameSnapshot: string;
    quantity: number;
  }>,
): void {
  if (!canAccessLocation(organizationId, locationId)) {
    throw new Error("Location does not belong to this organization");
  }
  for (const req of aggregateProductRequirements(items)) {
    const available = getProductStock(
      organizationId,
      locationId,
      req.productId,
    );
    if (available < req.quantity) {
      throw new Error(
        `庫存不足：${req.productName}（分店可用 ${available}，需要 ${req.quantity}）`,
      );
    }
  }
}

/** Idempotent SALE movement for one transaction PRODUCT line. */
export function postInventorySale(
  organizationId: string,
  input: {
    productId: string;
    locationId: string;
    quantity: number;
    transactionId: string;
    transactionItemId: string;
    createdByStaffId: string;
    effectKey: string;
  },
): InventoryMovement {
  assertStaff(organizationId, input.createdByStaffId);
  if (!canAccessLocation(organizationId, input.locationId)) {
    throw new Error("Location does not belong to this organization");
  }
  assertProduct(organizationId, input.productId);
  const qty = assertIntegerQty(input.quantity, "sale quantity");
  if (qty < 1) throw new Error("sale quantity must be >= 1");

  const existing = findMovementByEffectKey(organizationId, input.effectKey);
  if (existing) return existing;

  const stock = getProductStock(
    organizationId,
    input.locationId,
    input.productId,
  );
  if (stock < qty) {
    throw new Error(
      `庫存不足：product ${input.productId}（分店可用 ${stock}，需要 ${qty}）`,
    );
  }

  return appendMovement(organizationId, {
    id: newId("inv"),
    organizationId,
    locationId: input.locationId,
    productId: input.productId,
    type: "SALE",
    quantityDelta: -qty,
    transactionId: input.transactionId,
    transactionItemId: input.transactionItemId,
    effectKey: input.effectKey,
    createdAt: new Date().toISOString(),
    createdByStaffId: input.createdByStaffId,
  });
}

export function reverseInventoryMovement(
  organizationId: string,
  movementId: string,
  actorStaffId: string,
  reason?: string,
): InventoryMovement {
  assertStaff(organizationId, actorStaffId);
  const original = listInventoryMovements(organizationId).find(
    (m) => m.id === movementId,
  );
  if (!original || original.organizationId !== organizationId) {
    throw new Error("Inventory movement not found");
  }
  if (original.type === "REVERSAL") {
    throw new Error("cannot reverse a reversal movement");
  }

  const already = listInventoryMovements(organizationId).find(
    (m) => m.type === "REVERSAL" && m.reversesMovementId === movementId,
  );
  if (already) return already;

  const effectKey = `REV:INV:${movementId}`;
  const existing = findMovementByEffectKey(organizationId, effectKey);
  if (existing) return existing;

  return appendMovement(organizationId, {
    id: newId("inv"),
    organizationId,
    locationId: original.locationId,
    productId: original.productId,
    type: "REVERSAL",
    quantityDelta: -original.quantityDelta,
    reason: reason ?? `Reversal of ${original.id}`,
    transactionId: original.transactionId,
    transactionItemId: original.transactionItemId,
    reversesMovementId: movementId,
    effectKey,
    createdAt: new Date().toISOString(),
    createdByStaffId: actorStaffId,
  });
}

export function listSaleMovementsForTransaction(
  organizationId: string,
  transactionId: string,
): InventoryMovement[] {
  return listInventoryMovements(organizationId, { transactionId }).filter(
    (m) => m.type === "SALE",
  );
}

export type { InventoryMovementType };
