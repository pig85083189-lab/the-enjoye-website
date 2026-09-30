/**
 * Product Workspace — presentation helpers only.
 * Product remains catalog-only. Stock is always SUM(quantityDelta)
 * via Inventory Ledger / getProductStock. Product catalog has no persisted stock.
 */
import type { InventoryMovement } from "@/lib/inventory/domain";
import { sortInventoryMovementsChronologically } from "@/lib/inventory/ordering";
import type { Product } from "@/lib/products/domain";

export const PRODUCTS_PANEL_WIDTH_PX = 400;
export const PRODUCTS_INLINE_MIN_PX = 1200;
export const PRODUCTS_WORKSPACE_GAP_PX = 16;
export const PRODUCTS_LOW_STOCK_THRESHOLD = 5;

export const PRODUCTS_HAS_PERSISTED_STOCK = false;
export const PRODUCTS_HAS_SECOND_INVENTORY_STORE = false;
export const PRODUCTS_HAS_STOCK_CALCULATOR = false;

export const PRODUCTS_DISPLAY_TIMEZONE = "Asia/Taipei";

export type ProductListFilter =
  | "all"
  | "active"
  | "inactive"
  | "low"
  | "sold_out";

export type ProductStockKind = "in_stock" | "low" | "sold_out";
export type ProductCatalogStatusKind = "active" | "inactive";

export const PRODUCT_FILTER_OPTIONS: Array<{
  id: ProductListFilter;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "active", label: "啟用" },
  { id: "inactive", label: "停用" },
  { id: "low", label: "低庫存" },
  { id: "sold_out", label: "售罄" },
];

export const PRODUCT_ADJUSTMENT_REASONS = [
  { id: "count", label: "盤點更正" },
  { id: "damage", label: "破損耗損" },
  { id: "other", label: "其他" },
] as const;

/** User-facing movement labels. Technical types stay on InventoryMovement.type. */
export const PRODUCT_MOVEMENT_TYPE_LABEL: Record<InventoryMovement["type"], string> = {
  RECEIVE: "入庫",
  SALE: "銷售扣庫",
  ADJUSTMENT: "盤點調整",
  REVERSAL: "交易作廢回補",
};

export interface ProductLocationHint {
  id: string;
  name: string;
}

export interface ProductLocationStockView {
  locationId: string;
  locationName: string;
  stock: number;
}

export interface ProductWorkspaceStatusView {
  catalogKind: ProductCatalogStatusKind;
  catalogTitle: string;
  stockKind: ProductStockKind;
  stockTitle: string;
}

export interface ProductWorkspaceRow {
  productId: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  description: string;
  priceMinor: number;
  isActive: boolean;
  initials: string;
  currentLocationId: string;
  currentLocationName: string;
  currentLocationStock: number;
  locationStocks: ProductLocationStockView[];
  status: ProductWorkspaceStatusView;
}

export interface ProductWorkspaceSummary {
  catalogCount: number;
  activeCount: number;
  currentLocationStockTotal: number;
  lowStockCount: number;
  soldOutCount: number;
}

export interface ProductMovementView {
  id: string;
  createdAt: string;
  type: InventoryMovement["type"];
  typeLabel: string;
  quantityDelta: number;
  runningBalance: number;
  locationId: string;
  locationName: string;
  reason?: string;
  note?: string;
  transactionId?: string;
  staffId: string;
}

export function productInitials(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "商";
}

export function deriveProductStockKind(stock: number): ProductStockKind {
  if (stock <= 0) return "sold_out";
  if (stock <= PRODUCTS_LOW_STOCK_THRESHOLD) return "low";
  return "in_stock";
}

export function productStockTitle(kind: ProductStockKind): string {
  if (kind === "sold_out") return "售罄";
  if (kind === "low") return "低庫存";
  return "有庫存";
}

export function deriveCatalogStatus(isActive: boolean): {
  kind: ProductCatalogStatusKind;
  title: string;
} {
  return isActive
    ? { kind: "active", title: "啟用" }
    : { kind: "inactive", title: "停用" };
}

/** Same formula as getProductStock — SUM(quantityDelta) at one location. */
export function sumLocationProductStock(
  movements: InventoryMovement[],
  locationId: string,
  productId: string,
): number {
  return movements
    .filter(
      (row) => row.locationId === locationId && row.productId === productId,
    )
    .reduce((sum, row) => sum + row.quantityDelta, 0);
}

export function inventoryAdjustmentDelta(
  actualCount: number,
  ledgerStock: number,
): number {
  return actualCount - ledgerStock;
}

export function isValidActualCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function matchesProductSearch(row: ProductWorkspaceRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.name.toLowerCase().includes(q)) return true;
  if (row.sku && row.sku.toLowerCase().includes(q)) return true;
  if (row.barcode && row.barcode.toLowerCase().includes(q)) return true;
  if (row.category && row.category.toLowerCase().includes(q)) return true;
  return false;
}

export function buildProductWorkspaceRows(input: {
  products: Product[];
  movements: InventoryMovement[];
  locationId: string;
  locations: ProductLocationHint[];
}): ProductWorkspaceRow[] {
  const locationName =
    input.locations.find((row) => row.id === input.locationId)?.name ?? "";

  return input.products
    .filter((product) => product.organizationId)
    .map((product) => {
      const currentLocationStock = sumLocationProductStock(
        input.movements,
        input.locationId,
        product.id,
      );
      const stockKind = deriveProductStockKind(currentLocationStock);
      const catalog = deriveCatalogStatus(product.isActive);
      return {
        productId: product.id,
        name: product.name,
        sku: product.sku ?? "",
        barcode: product.barcode ?? "",
        category: product.category ?? "",
        description: product.description ?? "",
        priceMinor: product.priceMinor,
        isActive: product.isActive,
        initials: productInitials(product.name),
        currentLocationId: input.locationId,
        currentLocationName: locationName,
        currentLocationStock,
        locationStocks: input.locations.map((location) => ({
          locationId: location.id,
          locationName: location.name,
          stock: sumLocationProductStock(
            input.movements,
            location.id,
            product.id,
          ),
        })),
        status: {
          catalogKind: catalog.kind,
          catalogTitle: catalog.title,
          stockKind,
          stockTitle: productStockTitle(stockKind),
        },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
}

export function countProductSummary(
  rows: ProductWorkspaceRow[],
): ProductWorkspaceSummary {
  return {
    catalogCount: rows.length,
    activeCount: rows.filter((row) => row.isActive).length,
    currentLocationStockTotal: rows.reduce(
      (sum, row) => sum + row.currentLocationStock,
      0,
    ),
    lowStockCount: rows.filter(
      (row) => row.isActive && row.status.stockKind === "low",
    ).length,
    soldOutCount: rows.filter(
      (row) => row.isActive && row.status.stockKind === "sold_out",
    ).length,
  };
}

export function filterProductRows(
  rows: ProductWorkspaceRow[],
  input: { status: ProductListFilter; query: string },
): ProductWorkspaceRow[] {
  return rows.filter((row) => {
    if (input.status === "active" && !row.isActive) return false;
    if (input.status === "inactive" && row.isActive) return false;
    if (input.status === "low" && row.status.stockKind !== "low") return false;
    if (input.status === "sold_out" && row.status.stockKind !== "sold_out") {
      return false;
    }
    return matchesProductSearch(row, input.query);
  });
}

export function mapProductMovementViews(
  movements: InventoryMovement[],
  input: {
    productId: string;
    locationId?: string;
    locations: ProductLocationHint[];
    limit?: number;
  },
): ProductMovementView[] {
  const scoped = sortInventoryMovementsChronologically(
    movements
      .filter((row) => row.productId === input.productId)
      .filter((row) => !input.locationId || row.locationId === input.locationId),
  );

  const running = new Map<string, number>();
  const views = scoped.map((row) => {
    const next = (running.get(row.locationId) ?? 0) + row.quantityDelta;
    running.set(row.locationId, next);
    return {
      id: row.id,
      createdAt: row.createdAt,
      type: row.type,
      typeLabel: PRODUCT_MOVEMENT_TYPE_LABEL[row.type],
      quantityDelta: row.quantityDelta,
      runningBalance: next,
      locationId: row.locationId,
      locationName:
        input.locations.find((location) => location.id === row.locationId)?.name ??
        row.locationId,
      reason: row.reason,
      note: row.note,
      transactionId: row.transactionId,
      staffId: row.createdByStaffId,
    };
  });

  const newestFirst = [...views].reverse();
  return input.limit ? newestFirst.slice(0, input.limit) : newestFirst;
}

export function formatProductTimestamp(iso: string | null | undefined): {
  dateLabel: string;
  timeLabel: string;
} {
  if (!iso) return { dateLabel: "", timeLabel: "" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { dateLabel: "", timeLabel: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRODUCTS_DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    dateLabel: `${get("year")}/${get("month")}/${get("day")}`,
    timeLabel: `${get("hour")}:${get("minute")}`,
  };
}

export function resolveSelectedProductRow(
  rows: ProductWorkspaceRow[],
  selectedProductId: string | null,
): ProductWorkspaceRow | null {
  if (!selectedProductId) return null;
  return rows.find((row) => row.productId === selectedProductId) ?? null;
}

export function shouldResetProductSelection(input: {
  selectedProductId: string | null;
  visibleRows: ProductWorkspaceRow[];
}): boolean {
  if (!input.selectedProductId) return false;
  return !input.visibleRows.some((row) => row.productId === input.selectedProductId);
}

export function shouldRenderProductQuickView(
  selected: ProductWorkspaceRow | null,
): boolean {
  return selected !== null;
}

export function isInlineProductQuickViewViewport(widthPx: number): boolean {
  return widthPx >= PRODUCTS_INLINE_MIN_PX;
}

export function productListPresentation(
  widthPx: number,
): "desktop-rows" | "mobile-cards" {
  return isInlineProductQuickViewViewport(widthPx)
    ? "desktop-rows"
    : "mobile-cards";
}

export function isProductRowKeyboardActivation(key: string): boolean {
  return key === "Enter" || key === " ";
}

const FORBIDDEN_PRODUCT_STOCK_KEYS = ["stock", "current" + "Stock", "inventory" + "Count"] as const;

export function productHasPersistedStockField(product: Product): boolean {
  return FORBIDDEN_PRODUCT_STOCK_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(product, key),
  );
}
