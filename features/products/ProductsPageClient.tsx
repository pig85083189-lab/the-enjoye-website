"use client";

import {
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { ChevronRight, PackageSearch, Plus, Search } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProductFormModal } from "@/features/products/ProductFormModal";
import { ProductQuickView } from "@/features/products/ProductQuickView";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { formatTwd } from "@/lib/commerce/money";
import {
  adjustInventory,
  canActorManageInventory,
  getProductStock,
  listInventoryMovements,
  receiveStock,
} from "@/lib/inventory/store";
import {
  PRODUCT_FILTER_OPTIONS,
  PRODUCTS_WORKSPACE_GAP_PX,
  buildProductWorkspaceRows,
  countProductSummary,
  filterProductRows,
  inventoryAdjustmentDelta,
  isProductRowKeyboardActivation,
  isValidActualCount,
  mapProductMovementViews,
  resolveSelectedProductRow,
  shouldRenderProductQuickView,
  shouldResetProductSelection,
  type ProductListFilter,
  type ProductWorkspaceRow,
} from "@/lib/products/products-workspace-derived";
import {
  canActorManageProducts,
  listProducts,
} from "@/lib/products/store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import { useIsClient } from "@/lib/repositories/use-crm-store";
import { cn } from "@/lib/utils";

const STOCK_PILL: Record<ProductWorkspaceRow["status"]["stockKind"], string> = {
  in_stock: "bg-[#F3EEEA] text-[#7A7272]",
  low: "bg-[#F8F1E8] text-[#C4A06A]",
  sold_out: "bg-[#F6EEEE] text-[#C49A9A]",
};

const STOCK_NUMBER: Record<ProductWorkspaceRow["status"]["stockKind"], string> = {
  in_stock: "text-text",
  low: "text-[#C4A06A]",
  sold_out: "text-[#C49A9A]",
};

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-[80px] animate-pulse rounded-2xl bg-primary-light/40" />
      ))}
    </div>
  );
}

function selectFromPointer(event: SyntheticEvent<HTMLElement>) {
  event.preventDefault();
}

export function ProductsPageClient() {
  const { organization, currentLocation, locations, membership } = useOrganization();
  const isClient = useIsClient();
  const commerceRev = useSyncExternalStore(
    subscribeCommerce,
    getCommerceRevision,
    () => "",
  );

  const staffId = membership?.userId ?? "";
  const locationId = currentLocation?.id ?? locations[0]?.id ?? "";
  const canManageCatalog =
    Boolean(staffId) && canActorManageProducts(organization.id, staffId);
  const canManageInventory =
    Boolean(staffId) && canActorManageInventory(organization.id, staffId);

  const [filters, setFilters] = useState<{
    status: ProductListFilter;
    query: string;
  }>({
    status: "all",
    query: "",
  });
  const statusFilter = filters.status;
  const query = filters.query;
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [inventoryBusy, setInventoryBusy] = useState(false);
  const [inventoryError, setInventoryError] = useState("");

  const locationHints = useMemo(
    () => locations.map((row) => ({ id: row.id, name: row.name })),
    [locations],
  );

  const products = useMemo(() => {
    void commerceRev;
    if (!isClient) return [];
    return listProducts(organization.id);
  }, [commerceRev, isClient, organization.id]);

  const movements = useMemo(() => {
    void commerceRev;
    if (!isClient) return [];
    return listInventoryMovements(organization.id);
  }, [commerceRev, isClient, organization.id]);

  const rows = useMemo(
    () =>
      buildProductWorkspaceRows({
        products,
        movements,
        locationId,
        locations: locationHints,
      }),
    [locationHints, locationId, movements, products],
  );

  const visible = useMemo(
    () => filterProductRows(rows, { status: statusFilter, query }),
    [query, rows, statusFilter],
  );

  const summary = useMemo(() => countProductSummary(rows), [rows]);

  const selectedStillVisible = !shouldResetProductSelection({
    selectedProductId,
    visibleRows: visible,
  });
  const selectedRow = selectedStillVisible
    ? resolveSelectedProductRow(rows, selectedProductId)
    : null;
  const showQuickView = shouldRenderProductQuickView(selectedRow);

  const liveStock = selectedRow
    ? getProductStock(organization.id, locationId, selectedRow.productId)
    : 0;

  const selectedMovements = useMemo(() => {
    if (!selectedProductId) return [];
    return mapProductMovementViews(movements, {
      productId: selectedProductId,
      locations: locationHints,
    });
  }, [locationHints, movements, selectedProductId]);

  function selectProduct(id: string) {
    setSelectedProductId(id);
    setInventoryError("");
  }

  function closeQuickView() {
    setSelectedProductId(null);
    setInventoryError("");
  }

  function applyFilters(next: { status?: ProductListFilter; query?: string }) {
    const merged = {
      status: next.status ?? filters.status,
      query: next.query ?? filters.query,
    };
    setFilters(merged);
    const nextVisible = filterProductRows(rows, merged);
    if (
      shouldResetProductSelection({
        selectedProductId,
        visibleRows: nextVisible,
      })
    ) {
      setSelectedProductId(null);
    }
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, id: string) {
    if (!isProductRowKeyboardActivation(event.key)) return;
    event.preventDefault();
    selectProduct(id);
  }

  function openCreate() {
    setFormMode("create");
    setFormOpen(true);
  }

  function openEdit() {
    if (!selectedRow) return;
    setFormMode("edit");
    setFormOpen(true);
  }

  function submitReceive(input: { locationId: string; quantity: number; note: string }) {
    if (!selectedRow || !canManageInventory) return;
    setInventoryBusy(true);
    setInventoryError("");
    try {
      receiveStock(organization.id, {
        productId: selectedRow.productId,
        locationId: input.locationId || locationId,
        quantity: input.quantity,
        note: input.note || undefined,
        createdByStaffId: staffId,
      });
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : "入庫失敗");
    } finally {
      setInventoryBusy(false);
    }
  }

  function submitAdjust(input: {
    locationId: string;
    actualCount: number;
    reason: string;
  }) {
    if (!selectedRow || !canManageInventory) return;
    setInventoryBusy(true);
    setInventoryError("");
    try {
      if (!isValidActualCount(input.actualCount)) {
        throw new Error("實際庫存須為非負整數");
      }
      const targetLocationId = input.locationId || locationId;
      const current = getProductStock(
        organization.id,
        targetLocationId,
        selectedRow.productId,
      );
      const quantityDelta = inventoryAdjustmentDelta(input.actualCount, current);
      if (quantityDelta === 0) {
        throw new Error("實際庫存與目前庫存相同，無需調整");
      }
      adjustInventory(organization.id, {
        productId: selectedRow.productId,
        locationId: targetLocationId,
        quantityDelta,
        reason: input.reason,
        createdByStaffId: staffId,
      });
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : "調整失敗");
    } finally {
      setInventoryBusy(false);
    }
  }

  const emptyAll = isClient && rows.length === 0;
  const emptyFiltered = isClient && rows.length > 0 && visible.length === 0;
  const contextLabel = [organization.name, currentLocation?.name]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      data-products-workspace
      data-has-quickview={showQuickView ? "true" : "false"}
      className="min-w-0"
    >
      <header className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">
            {PLATFORM_NAME}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            商品
          </h1>
          <p className="text-sm text-secondary-text">
            管理商品目錄與目前分店庫存
          </p>
          {contextLabel ? (
            <p className="text-[12px] text-secondary-text/80">{contextLabel}</p>
          ) : null}
        </div>
        {canManageCatalog ? (
          <div className="hidden shrink-0 min-[720px]:block">
            <Button
              data-products-add
              className="h-9 min-h-9 rounded-full px-4 text-[13px]"
              onClick={openCreate}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新增商品
            </Button>
          </div>
        ) : null}
      </header>

      <section className="mb-2.5 grid grid-cols-2 gap-2 min-[1200px]:grid-cols-4 min-[1200px]:gap-3">
        <SummaryCard
          label="目錄商品"
          value={isClient ? summary.catalogCount : "—"}
          emphasis="count"
        />
        <SummaryCard
          label="目前分店庫存"
          value={isClient ? summary.currentLocationStockTotal : "—"}
          emphasis="hero"
        />
        <SummaryCard
          label="低庫存"
          value={isClient ? summary.lowStockCount : "—"}
          emphasis="count"
          accent="warning"
        />
        <SummaryCard
          label="售罄"
          value={isClient ? summary.soldOutCount : "—"}
          emphasis="count"
          accent="danger"
        />
      </section>

      <div
        data-products-workspace-split
        data-products-gap={showQuickView ? PRODUCTS_WORKSPACE_GAP_PX : 0}
        className={cn("flex items-start", showQuickView && "min-[1200px]:gap-4")}
      >
        <div className="min-w-0 flex-1">
          <div
            data-products-toolbar
            className="mb-2.5 rounded-2xl border border-border bg-surface px-3 py-2"
          >
            <div className="flex flex-col gap-1.5 min-[720px]:flex-row min-[720px]:items-center min-[720px]:justify-between">
              <div className="flex min-w-0 flex-wrap gap-1">
                {PRODUCT_FILTER_OPTIONS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    data-products-filter={entry.id}
                    onClick={() => applyFilters({ status: entry.id })}
                    className={cn(
                      "h-7 min-h-7 shrink-0 rounded-full px-2.5 text-[12px] font-medium transition-colors",
                      statusFilter === entry.id
                        ? "bg-primary text-white"
                        : "bg-[#F6F1EE] text-text hover:bg-primary-light",
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <div className="relative min-w-0 flex-1 min-[720px]:max-w-md">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary-text"
                  aria-hidden
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => applyFilters({ query: event.target.value })}
                  placeholder="搜尋名稱、SKU、Barcode 或分類"
                  className="h-9 min-h-9 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[13px] text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
                  aria-label="搜尋名稱、SKU、Barcode 或分類"
                />
              </div>
            </div>
          </div>

          {!isClient ? (
            <ListSkeleton />
          ) : emptyAll ? (
            <Card data-products-empty padding="lg" className="text-center">
              <PackageSearch className="mx-auto h-10 w-10 text-primary/50" aria-hidden />
              <p className="mt-3 text-[15px] font-medium text-text">尚無商品</p>
              <p className="mt-1 text-sm text-secondary-text">
                先建立商品目錄，再使用「入庫」建立各分店的初始庫存。
              </p>
              {canManageCatalog ? (
                <div className="mt-4 inline-flex">
                  <Button
                    data-products-empty-add
                    className="h-10 min-h-10 rounded-full px-4 text-[13px]"
                    onClick={openCreate}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    新增商品
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : emptyFiltered ? (
            <Card padding="lg" className="text-center">
              <p className="text-[15px] font-medium text-text">找不到符合的商品</p>
              <p className="mt-1 text-sm text-secondary-text">
                試試調整搜尋或狀態篩選
              </p>
            </Card>
          ) : (
            <>
              <div
                data-products-list
                className="hidden overflow-hidden rounded-2xl border border-border bg-surface min-[1200px]:block"
              >
                <div className="grid grid-cols-[minmax(180px,1.4fr)_88px_88px_88px_72px_24px] bg-[#FAF7F5]/80 px-4 py-2 text-[11px] text-secondary-text">
                  <span>商品</span>
                  <span>分類</span>
                  <span>售價</span>
                  <span>目前分店庫存</span>
                  <span>狀態</span>
                  <span className="sr-only">開啟</span>
                </div>
                {visible.map((row) => (
                  <DesktopRow
                    key={row.productId}
                    row={row}
                    selected={selectedProductId === row.productId}
                    onSelect={selectProduct}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>

              <div
                data-products-mobile-list
                className="space-y-2.5 pb-[calc(8.75rem+env(safe-area-inset-bottom))] min-[720px]:pb-0 min-[1200px]:hidden"
              >
                {visible.map((row, index) => (
                  <MobileCard
                    key={row.productId}
                    row={row}
                    last={index === visible.length - 1}
                    selected={selectedProductId === row.productId}
                    onSelect={selectProduct}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {showQuickView && selectedRow ? (
          <div className="hidden min-[1200px]:block">
            <ProductQuickView
              key={selectedRow.productId}
              row={selectedRow}
              movements={selectedMovements}
              locations={locationHints}
              liveStock={liveStock}
              canManageCatalog={canManageCatalog}
              canManageInventory={canManageInventory}
              inventoryBusy={inventoryBusy}
              inventoryError={inventoryError}
              onClose={closeQuickView}
              onEdit={openEdit}
              onReceive={submitReceive}
              onAdjust={submitAdjust}
            />
          </div>
        ) : null}
      </div>

      {showQuickView && selectedRow ? (
        <div className="min-[1200px]:hidden">
          <ProductQuickView
            key={selectedRow.productId}
            row={selectedRow}
            movements={selectedMovements}
            locations={locationHints}
            liveStock={liveStock}
            canManageCatalog={canManageCatalog}
            canManageInventory={canManageInventory}
            inventoryBusy={inventoryBusy}
            inventoryError={inventoryError}
            onClose={closeQuickView}
            onEdit={openEdit}
            onReceive={submitReceive}
            onAdjust={submitAdjust}
          />
        </div>
      ) : null}

      {canManageCatalog && !showQuickView ? (
        <div
          data-products-add-mobile-wrap
          className="fixed inset-x-4 z-30 min-[720px]:hidden bottom-[calc(3.5rem+0.75rem+env(safe-area-inset-bottom))]"
        >
          <Button
            data-products-add-mobile
            className="h-12 min-h-12 w-full rounded-2xl text-[15px] shadow-[0_8px_24px_rgba(197,107,112,0.22)]"
            onClick={openCreate}
          >
            <Plus className="h-4 w-4" aria-hidden />
            新增商品
          </Button>
        </div>
      ) : null}

      <ProductFormModal
        key={formOpen ? `${formMode}-${selectedRow?.productId ?? "new"}` : "closed"}
        open={formOpen}
        mode={formMode}
        organizationId={organization.id}
        staffId={staffId}
        editing={formMode === "edit" ? selectedRow : null}
        onClose={() => setFormOpen(false)}
        onSaved={(productId) => setSelectedProductId(productId)}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent = "default",
  emphasis = "count",
}: {
  label: string;
  value: number | string;
  accent?: "default" | "warning" | "danger";
  emphasis?: "hero" | "count";
}) {
  return (
    <div
      data-products-summary
      data-emphasis={emphasis}
      className="flex h-[72px] min-h-[72px] max-h-[76px] min-w-0 flex-col justify-center rounded-2xl border border-border bg-surface px-3.5 py-2 shadow-[0_1px_1px_rgba(48,43,43,0.025)]"
    >
      <p
        className={cn(
          "leading-none tracking-tight tabular-nums",
          emphasis === "hero"
            ? "text-[22px] font-semibold text-text sm:text-[26px]"
            : "text-[16px] font-medium sm:text-[18px]",
          emphasis === "count" && accent === "warning" && "text-[#C4A06A]",
          emphasis === "count" && accent === "danger" && "text-[#C49A9A]",
          emphasis === "count" && accent === "default" && "text-secondary-text",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[10px] leading-tight text-secondary-text">{label}</p>
    </div>
  );
}

interface RowProps {
  row: ProductWorkspaceRow;
  selected: boolean;
  last?: boolean;
  onSelect: (id: string) => void;
  onPointerDown: (event: SyntheticEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void;
}

function DesktopRow({
  row,
  selected,
  onSelect,
  onPointerDown,
  onKeyDown,
}: RowProps) {
  return (
    <div
      data-products-row
      data-product-id={row.productId}
      aria-pressed={selected}
      className={cn(
        "relative grid min-h-[74px] cursor-pointer grid-cols-[minmax(180px,1.4fr)_88px_88px_88px_72px_24px] items-center border-b border-[#EFE8E4]/80 px-4 last:border-b-0",
        "hover:bg-[#F7F2F0]",
        selected && "bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.productId)}
    >
      {selected ? (
        <span
          data-products-row-accent
          className="pointer-events-none absolute inset-y-0 left-0 z-20 w-[3px] bg-[#C56B70]"
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        data-products-row-focus
        aria-label={`${row.name}，開啟商品詳情`}
        aria-pressed={selected}
        className="absolute inset-0 z-10 cursor-pointer rounded-none bg-transparent"
        onPointerDown={onPointerDown}
        onMouseDown={onPointerDown}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(row.productId);
        }}
        onKeyDown={(event) => onKeyDown(event, row.productId)}
      />
      <div className="pointer-events-none relative z-0 flex min-w-0 items-center gap-2.5 pr-2">
        <Avatar initials={row.initials} size="sm" className="gap-0" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-text">{row.name}</p>
          <p className="truncate text-[12px] text-secondary-text">
            {row.sku || row.barcode || "—"}
          </p>
        </div>
      </div>
      <div className="pointer-events-none relative z-0 truncate pr-2 text-[12px] text-secondary-text">
        {row.category || "—"}
      </div>
      <div className="pointer-events-none relative z-0 pr-2">
        <p className="text-[14px] font-semibold tabular-nums text-text">
          {formatTwd(row.priceMinor)}
        </p>
      </div>
      <div className="pointer-events-none relative z-0 pr-2">
        <p
          data-products-row-stock
          className={cn(
            "text-[15px] font-semibold tabular-nums",
            STOCK_NUMBER[row.status.stockKind],
          )}
        >
          {row.currentLocationStock}
        </p>
        <p className="text-[11px] text-secondary-text">{row.status.stockTitle}</p>
      </div>
      <div className="pointer-events-none relative z-0 pr-1">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
            row.isActive ? "bg-[#E7F0EA] text-[#5C7F66]" : "bg-[#F1EEEC] text-[#7A7272]",
          )}
        >
          {row.status.catalogTitle}
        </span>
      </div>
      <div className="pointer-events-none relative z-0 flex justify-end text-secondary-text">
        <ChevronRight className="h-4 w-4" aria-hidden />
      </div>
    </div>
  );
}

function MobileCard({
  row,
  selected,
  last = false,
  onSelect,
  onPointerDown,
  onKeyDown,
}: RowProps) {
  return (
    <div
      data-products-row
      data-products-last-row={last ? "true" : undefined}
      data-product-id={row.productId}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${row.name}，開啟商品詳情`}
      className={cn(
        "cursor-pointer rounded-2xl border border-border bg-surface px-3.5 py-3 outline-none transition-colors",
        "hover:border-primary/30 focus-visible:bg-primary-light/30",
        selected && "border-primary/40 bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.productId)}
      onKeyDown={(event) => onKeyDown(event, row.productId)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar initials={row.initials} size="sm" className="gap-0" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-text">{row.name}</p>
            <p className="truncate text-[12px] text-[#6E6666]">
              {[row.category || "未分類", row.sku].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <p className="shrink-0 text-[14px] font-semibold tabular-nums text-text">
          {formatTwd(row.priceMinor)}
        </p>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-[12px] text-secondary-text">
          {row.currentLocationName || "目前分店"}庫存
          <span
            data-products-row-stock
            className={cn(
              "ml-1.5 font-semibold tabular-nums",
              STOCK_NUMBER[row.status.stockKind],
            )}
          >
            {row.currentLocationStock}
          </span>
        </p>
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
            STOCK_PILL[row.status.stockKind],
          )}
        >
          {row.status.stockTitle}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
            row.isActive ? "bg-[#E7F0EA] text-[#5C7F66]" : "bg-[#F1EEEC] text-[#7A7272]",
          )}
        >
          {row.status.catalogTitle}
        </span>
        <ChevronRight className="h-4 w-4 text-secondary-text" aria-hidden />
      </div>
    </div>
  );
}
