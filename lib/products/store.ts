/**
 * Product catalog store — Phase 4.10B.
 * Organization-owned; no inventory / stock.
 */

import { SEED_MEMBERSHIPS } from "@/data/seed-organizations";
import { DEFAULT_CURRENCY } from "@/lib/commerce/domain";
import { assertNonNegativeMoney } from "@/lib/commerce/money";
import { newId } from "@/lib/repositories/storage";
import { getProductsKey } from "@/lib/tenant/storage-keys";
import type { StaffRole } from "@/types/saas";
import type { Product } from "./domain";

const CHANGE = "enjoye-commerce-change";

const PRODUCT_MANAGE_ROLES: ReadonlySet<StaffRole> = new Set(["OWNER", "MANAGER"]);

function emit(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("beauty-os:commerce-rev", String(Date.now()));
  window.dispatchEvent(new Event(CHANGE));
}

function readAll(organizationId: string): Product[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getProductsKey(organizationId));
    if (!raw) return [];
    return (JSON.parse(raw) as Product[]).filter(
      (p) => p.organizationId === organizationId,
    );
  } catch {
    return [];
  }
}

function writeAll(organizationId: string, list: Product[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    getProductsKey(organizationId),
    JSON.stringify(list.filter((p) => p.organizationId === organizationId)),
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

function assertCanManage(organizationId: string, staffId: string): void {
  const m = assertStaff(organizationId, staffId);
  if (!PRODUCT_MANAGE_ROLES.has(m.role)) {
    throw new Error("Unauthorized to manage products");
  }
}

function normalizeOptionalCode(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function assertSkuUnique(
  organizationId: string,
  sku: string | undefined,
  exceptProductId?: string,
): void {
  if (!sku) return;
  const hit = readAll(organizationId).find(
    (p) =>
      p.sku &&
      p.sku.toLowerCase() === sku.toLowerCase() &&
      p.id !== exceptProductId,
  );
  if (hit) {
    throw new Error("SKU already exists in this organization");
  }
}

export function listProducts(
  organizationId: string,
  opts?: { activeOnly?: boolean },
): Product[] {
  let list = readAll(organizationId);
  if (opts?.activeOnly) list = list.filter((p) => p.isActive);
  return list;
}

export function getProductById(
  organizationId: string,
  productId: string,
): Product | undefined {
  return readAll(organizationId).find((p) => p.id === productId);
}

export function searchProducts(
  organizationId: string,
  query: string,
  opts?: { activeOnly?: boolean },
): Product[] {
  const q = query.trim().toLowerCase();
  const list = listProducts(organizationId, opts);
  if (!q) return list;
  return list.filter((p) => {
    if (p.name.toLowerCase().includes(q)) return true;
    if (p.sku && p.sku.toLowerCase().includes(q)) return true;
    if (p.barcode && p.barcode.toLowerCase() === q) return true;
    if (p.barcode && p.barcode.toLowerCase().includes(q)) return true;
    if (p.category && p.category.toLowerCase().includes(q)) return true;
    return false;
  });
}

export function createProduct(
  organizationId: string,
  input: {
    name: string;
    description?: string;
    sku?: string;
    barcode?: string;
    category?: string;
    priceMinor: number;
    isActive?: boolean;
    createdByStaffId: string;
  },
): Product {
  assertCanManage(organizationId, input.createdByStaffId);
  const name = input.name.trim();
  if (!name) throw new Error("product name required");
  assertNonNegativeMoney(input.priceMinor, "priceMinor");
  const sku = normalizeOptionalCode(input.sku);
  const barcode = normalizeOptionalCode(input.barcode);
  assertSkuUnique(organizationId, sku);
  const now = new Date().toISOString();
  const row: Product = {
    id: newId("prd"),
    organizationId,
    name,
    description: input.description?.trim() || undefined,
    sku,
    barcode,
    category: input.category?.trim() || undefined,
    priceMinor: input.priceMinor,
    currency: DEFAULT_CURRENCY,
    isActive: input.isActive !== false,
    createdAt: now,
    updatedAt: now,
  };
  writeAll(organizationId, [row, ...readAll(organizationId)]);
  return row;
}

export function updateProduct(
  organizationId: string,
  productId: string,
  patch: Partial<{
    name: string;
    description: string | null;
    sku: string | null;
    barcode: string | null;
    category: string | null;
    priceMinor: number;
    isActive: boolean;
  }>,
  actorStaffId: string,
): Product {
  assertCanManage(organizationId, actorStaffId);
  const existing = getProductById(organizationId, productId);
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Product not found");
  }
  const nextName =
    patch.name !== undefined ? patch.name.trim() : existing.name;
  if (!nextName) throw new Error("product name required");
  const nextPrice =
    patch.priceMinor !== undefined
      ? assertNonNegativeMoney(patch.priceMinor, "priceMinor")
      : existing.priceMinor;
  const nextSku =
    patch.sku === null
      ? undefined
      : patch.sku !== undefined
        ? normalizeOptionalCode(patch.sku)
        : existing.sku;
  const nextBarcode =
    patch.barcode === null
      ? undefined
      : patch.barcode !== undefined
        ? normalizeOptionalCode(patch.barcode)
        : existing.barcode;
  assertSkuUnique(organizationId, nextSku, productId);
  const updated: Product = {
    ...existing,
    name: nextName,
    description:
      patch.description === null
        ? undefined
        : patch.description !== undefined
          ? patch.description.trim() || undefined
          : existing.description,
    sku: nextSku,
    barcode: nextBarcode,
    category:
      patch.category === null
        ? undefined
        : patch.category !== undefined
          ? patch.category.trim() || undefined
          : existing.category,
    priceMinor: nextPrice,
    isActive: patch.isActive ?? existing.isActive,
    updatedAt: new Date().toISOString(),
  };
  writeAll(
    organizationId,
    readAll(organizationId).map((p) => (p.id === productId ? updated : p)),
  );
  return updated;
}

export function deactivateProduct(
  organizationId: string,
  productId: string,
  actorStaffId: string,
): Product {
  return updateProduct(
    organizationId,
    productId,
    { isActive: false },
    actorStaffId,
  );
}

export function canActorManageProducts(
  organizationId: string,
  actorStaffId: string,
): boolean {
  const m = SEED_MEMBERSHIPS.find(
    (x) =>
      x.organizationId === organizationId &&
      x.userId === actorStaffId &&
      x.isActive,
  );
  return Boolean(m && PRODUCT_MANAGE_ROLES.has(m.role));
}
