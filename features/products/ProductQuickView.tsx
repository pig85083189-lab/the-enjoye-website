"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatTwd } from "@/lib/commerce/money";
import {
  PRODUCT_ADJUSTMENT_REASONS,
  PRODUCTS_PANEL_WIDTH_PX,
  formatProductTimestamp,
  inventoryAdjustmentDelta,
  isValidActualCount,
  type ProductLocationHint,
  type ProductMovementView,
  type ProductWorkspaceRow,
} from "@/lib/products/products-workspace-derived";
import { cn } from "@/lib/utils";

interface ProductQuickViewProps {
  row: ProductWorkspaceRow;
  movements: ProductMovementView[];
  locations: ProductLocationHint[];
  liveStock: number;
  canManageCatalog: boolean;
  canManageInventory: boolean;
  inventoryBusy?: boolean;
  inventoryError?: string;
  onClose: () => void;
  onEdit: () => void;
  onReceive: (input: {
    locationId: string;
    quantity: number;
    note: string;
  }) => void;
  onAdjust: (input: {
    locationId: string;
    actualCount: number;
    reason: string;
  }) => void;
}

const STOCK_PILL: Record<ProductWorkspaceRow["status"]["stockKind"], string> = {
  in_stock: "bg-[#F3EEEA] text-[#7A7272]",
  low: "bg-[#F8F1E8] text-[#C4A06A]",
  sold_out: "bg-[#F6EEEE] text-[#C49A9A]",
};

type InventoryPanel = "view" | "receive" | "adjust";

export function ProductQuickView({
  row,
  movements,
  locations,
  liveStock,
  canManageCatalog,
  canManageInventory,
  inventoryBusy = false,
  inventoryError = "",
  onClose,
  onEdit,
  onReceive,
  onAdjust,
}: ProductQuickViewProps) {
  const [panel, setPanel] = useState<InventoryPanel>("view");
  const [showAllMovements, setShowAllMovements] = useState(false);
  const [receiveLocationId, setReceiveLocationId] = useState(row.currentLocationId);
  const [receiveQty, setReceiveQty] = useState("10");
  const [receiveNote, setReceiveNote] = useState("");
  const [adjustLocationId, setAdjustLocationId] = useState(row.currentLocationId);
  const [actualCount, setActualCount] = useState(String(liveStock));
  const [adjustReasonId, setAdjustReasonId] = useState<string>(
    PRODUCT_ADJUSTMENT_REASONS[0].id,
  );
  const [adjustOther, setAdjustOther] = useState("");

  const visibleMovements = showAllMovements ? movements : movements.slice(0, 8);
  const adjustLocationStock =
    row.locationStocks.find((item) => item.locationId === adjustLocationId)?.stock ??
    liveStock;
  const parsedActual = Number.parseInt(actualCount, 10);
  const previewDelta = isValidActualCount(parsedActual)
    ? inventoryAdjustmentDelta(parsedActual, adjustLocationStock)
    : 0;
  const reasonLabel =
    adjustReasonId === "other"
      ? adjustOther.trim()
      : PRODUCT_ADJUSTMENT_REASONS.find((item) => item.id === adjustReasonId)?.label ?? "";

  const stockTone =
    liveStock <= 0 ? "text-[#C49A9A]" : liveStock <= 5 ? "text-[#C4A06A]" : "text-text";

  function openReceive() {
    setPanel("receive");
    setReceiveLocationId(row.currentLocationId);
    setReceiveQty("10");
    setReceiveNote("");
  }

  function openAdjust() {
    setPanel("adjust");
    setAdjustLocationId(row.currentLocationId);
    setActualCount(String(liveStock));
    setAdjustReasonId(PRODUCT_ADJUSTMENT_REASONS[0].id);
    setAdjustOther("");
  }

  function submitReceive() {
    const quantity = Number.parseInt(receiveQty, 10);
    if (!Number.isInteger(quantity) || quantity <= 0) return;
    onReceive({
      locationId: receiveLocationId || row.currentLocationId,
      quantity,
      note: receiveNote,
    });
    setPanel("view");
  }

  function submitAdjust() {
    if (!isValidActualCount(parsedActual) || previewDelta === 0 || !reasonLabel) return;
    onAdjust({
      locationId: adjustLocationId || row.currentLocationId,
      actualCount: parsedActual,
      reason: reasonLabel,
    });
    setPanel("view");
  }

  const locationOptions = useMemo(
    () => (locations.length > 0 ? locations : [{ id: row.currentLocationId, name: row.currentLocationName }]),
    [locations, row.currentLocationId, row.currentLocationName],
  );

  return (
    <>
      <button
        type="button"
        className="fixed inset-x-0 top-0 z-30 bg-text/25 min-[1200px]:hidden bottom-[calc(3.5rem+env(safe-area-inset-bottom))]"
        aria-label="關閉商品詳情"
        onClick={onClose}
      />
      <aside
        data-products-quickview
        data-products-panel-width={PRODUCTS_PANEL_WIDTH_PX}
        data-product-id={row.productId}
        role="dialog"
        aria-modal="true"
        aria-label={`${row.name}的商品詳情`}
        className={cn(
          "z-30 flex flex-col overflow-hidden border border-border bg-surface",
          "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-h-[min(88vh,calc(100dvh-4.5rem-env(safe-area-inset-bottom)))] rounded-t-3xl shadow-[0_-4px_24px_rgba(48,43,43,0.08)]",
          "min-[1200px]:relative min-[1200px]:inset-auto min-[1200px]:z-0 min-[1200px]:h-auto min-[1200px]:max-h-[calc(100dvh-6.5rem)] min-[1200px]:w-[400px] min-[1200px]:min-w-[400px] min-[1200px]:shrink-0 min-[1200px]:rounded-2xl min-[1200px]:shadow-none",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-5 pt-3.5 pb-1">
            <p className="text-[13px] font-medium tracking-wide text-secondary-text">
              商品詳情
            </p>
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary-text hover:bg-primary-light/50"
              aria-label="關閉"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-24 min-[1200px]:pb-8">
            <div className="flex items-start gap-3 pb-4">
              <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-light text-base font-medium text-primary">
                {row.initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 className="truncate text-[16px] font-semibold text-text">{row.name}</h2>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      row.isActive
                        ? "bg-[#E7F0EA] text-[#5C7F66]"
                        : "bg-[#F1EEEC] text-[#7A7272]",
                    )}
                  >
                    {row.status.catalogTitle}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      STOCK_PILL[row.status.stockKind],
                    )}
                  >
                    {row.status.stockTitle}
                  </span>
                </div>
                <p className="mt-0.5 text-[13px] text-secondary-text">
                  {row.category || "未分類"}
                  {row.sku ? ` · ${row.sku}` : ""}
                </p>
                {row.barcode ? (
                  <p className="mt-0.5 text-[12px] text-secondary-text">{row.barcode}</p>
                ) : null}
              </div>
            </div>

            <section className="rounded-2xl border border-border bg-[#FAF7F5]/70 px-3.5 py-3">
              <p className="text-[12px] text-secondary-text">
                {row.currentLocationName || "目前分店"}庫存
              </p>
              <p
                data-products-live-stock
                className={cn(
                  "mt-1 text-[28px] font-semibold leading-none tracking-tight tabular-nums",
                  stockTone,
                )}
              >
                {liveStock}
              </p>
              <p className="mt-1.5 text-[12px] text-secondary-text">
                依庫存異動自動計算
              </p>
              <p className="mt-0.5 text-[11px] text-secondary-text/80">
                入庫、銷售、盤點調整與交易作廢會自動更新庫存。
              </p>
              <p className="mt-2 text-[18px] font-semibold tabular-nums text-text">
                {formatTwd(row.priceMinor)}
              </p>
            </section>

            {row.description ? (
              <p className="mt-3 text-[13px] text-secondary-text">{row.description}</p>
            ) : null}

            {row.locationStocks.length > 1 ? (
              <ul className="mt-3 grid gap-1.5">
                {row.locationStocks.map((location) => (
                  <li
                    key={location.locationId}
                    data-products-location-stock={location.locationId}
                    className="flex items-baseline justify-between rounded-xl border border-border/80 px-3 py-2 text-[13px]"
                  >
                    <span className="text-secondary-text">{location.locationName}</span>
                    <span className="font-medium tabular-nums text-text">{location.stock}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {canManageInventory ? (
                <>
                  <Button
                    data-products-receive-open
                    className="h-9 min-h-9 rounded-full px-3.5 text-[12px]"
                    variant={panel === "receive" ? "primary" : "outline"}
                    onClick={openReceive}
                  >
                    入庫
                  </Button>
                  <Button
                    data-products-adjust-open
                    className="h-9 min-h-9 rounded-full px-3.5 text-[12px]"
                    variant={panel === "adjust" ? "primary" : "outline"}
                    onClick={openAdjust}
                  >
                    盤點調整
                  </Button>
                </>
              ) : null}
              {canManageCatalog ? (
                <Button
                  data-products-edit-open
                  variant="outline"
                  className="h-9 min-h-9 rounded-full px-3.5 text-[12px]"
                  onClick={onEdit}
                >
                  編輯商品
                </Button>
              ) : null}
            </div>
            {!canManageInventory ? (
              <p className="mt-2 text-[12px] text-secondary-text">
                僅 OWNER／MANAGER 可入庫或盤點調整。
              </p>
            ) : null}

            {panel === "receive" && canManageInventory ? (
              <form
                data-products-receive
                className="mt-4 space-y-3 rounded-2xl border border-border p-3.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitReceive();
                }}
              >
                <p className="text-[13px] font-medium text-text">入庫</p>
                <p className="text-[12px] text-secondary-text">
                  確認後會新增一筆入庫紀錄，不會直接覆蓋原庫存紀錄。
                </p>
                <label className="block text-[12px] text-secondary-text">
                  分店
                  <select
                    className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text"
                    value={receiveLocationId}
                    onChange={(event) => setReceiveLocationId(event.target.value)}
                    aria-label="入庫分店"
                  >
                    {locationOptions.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[12px] text-secondary-text">
                  入庫數量
                  <input
                    data-products-receive-qty
                    className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[13px] text-text"
                    value={receiveQty}
                    onChange={(event) => setReceiveQty(event.target.value)}
                    inputMode="numeric"
                    aria-label="入庫數量"
                  />
                </label>
                <label className="block text-[12px] text-secondary-text">
                  備註（選填）
                  <input
                    className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[13px] text-text"
                    value={receiveNote}
                    onChange={(event) => setReceiveNote(event.target.value)}
                  />
                </label>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    data-products-receive-submit
                    className="h-9 min-h-9 flex-1 rounded-full text-[12px]"
                    disabled={inventoryBusy}
                  >
                    {inventoryBusy ? "處理中…" : "確認入庫"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 min-h-9 rounded-full px-4 text-[12px]"
                    onClick={() => setPanel("view")}
                  >
                    取消
                  </Button>
                </div>
              </form>
            ) : null}

            {panel === "adjust" && canManageInventory ? (
              <form
                data-products-adjust
                className="mt-4 space-y-3 rounded-2xl border border-border p-3.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitAdjust();
                }}
              >
                <p className="text-[13px] font-medium text-text">盤點調整</p>
                <p className="text-[12px] text-secondary-text">
                  確認後會新增一筆盤點調整紀錄，不會直接覆蓋原庫存紀錄。
                </p>
                <label className="block text-[12px] text-secondary-text">
                  分店
                  <select
                    className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text"
                    value={adjustLocationId}
                    onChange={(event) => {
                      const next = event.target.value;
                      setAdjustLocationId(next);
                      const nextStock =
                        row.locationStocks.find((item) => item.locationId === next)?.stock ?? 0;
                      setActualCount(String(nextStock));
                    }}
                    aria-label="調整分店"
                  >
                    {locationOptions.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="space-y-2">
                  <p className="flex items-baseline justify-between rounded-xl bg-[#FAF7F5] px-3 py-2 text-[12px] text-secondary-text">
                    目前系統庫存
                    <span className="text-[16px] font-semibold tabular-nums text-text">
                      {adjustLocationStock}
                    </span>
                  </p>
                  <label className="block text-[12px] text-secondary-text">
                    實際盤點數量
                    <input
                      data-products-adjust-actual
                      className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[13px] text-text"
                      value={actualCount}
                      onChange={(event) => setActualCount(event.target.value)}
                      inputMode="numeric"
                      aria-label="實際盤點數量"
                    />
                  </label>
                  <p className="flex items-baseline justify-between rounded-xl bg-[#FAF7F5] px-3 py-2 text-[12px] text-secondary-text">
                    調整結果
                    <span
                      data-products-adjust-delta
                      className="text-[16px] font-semibold tabular-nums text-text"
                    >
                      {isValidActualCount(parsedActual) && previewDelta !== 0
                        ? `${previewDelta > 0 ? "+" : ""}${previewDelta}`
                        : "—"}
                    </span>
                  </p>
                </div>
                <label className="block text-[12px] text-secondary-text">
                  原因
                  <select
                    className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text"
                    value={adjustReasonId}
                    onChange={(event) => setAdjustReasonId(event.target.value)}
                    aria-label="調整原因"
                  >
                    {PRODUCT_ADJUSTMENT_REASONS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                {adjustReasonId === "other" ? (
                  <label className="block text-[12px] text-secondary-text">
                    其他原因
                    <input
                      className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[13px] text-text"
                      value={adjustOther}
                      onChange={(event) => setAdjustOther(event.target.value)}
                    />
                  </label>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    data-products-adjust-submit
                    className="h-9 min-h-9 flex-1 rounded-full text-[12px]"
                    disabled={
                      inventoryBusy ||
                      !isValidActualCount(parsedActual) ||
                      previewDelta === 0 ||
                      !reasonLabel
                    }
                  >
                    {inventoryBusy ? "處理中…" : "確認調整"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 min-h-9 rounded-full px-4 text-[12px]"
                    onClick={() => setPanel("view")}
                  >
                    取消
                  </Button>
                </div>
              </form>
            ) : null}

            {inventoryError ? (
              <p className="mt-3 text-[13px] text-danger" role="alert">
                {inventoryError}
              </p>
            ) : null}

            <section className="mt-5">
              <p className="text-[12px] font-medium tracking-wide text-secondary-text">
                最近庫存異動
              </p>
              {movements.length === 0 ? (
                <p className="mt-2 text-[13px] text-secondary-text">尚無庫存異動。</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {visibleMovements.map((movement) => {
                    const time = formatProductTimestamp(movement.createdAt);
                    return (
                      <li
                        key={movement.id}
                        data-products-movement={movement.type}
                        className="rounded-2xl border border-border px-3 py-2.5"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-[13px] font-medium text-text">
                            {movement.typeLabel}
                            <span className="ml-2 tabular-nums text-secondary-text">
                              {movement.quantityDelta > 0 ? "+" : ""}
                              {movement.quantityDelta}
                            </span>
                          </p>
                          <p className="text-[12px] tabular-nums text-secondary-text">
                            餘額 {movement.runningBalance}
                          </p>
                        </div>
                        <p className="mt-1 text-[12px] text-secondary-text">
                          {movement.locationName}
                          {time.dateLabel ? ` · ${time.dateLabel} ${time.timeLabel}` : ""}
                        </p>
                        {movement.reason || movement.note ? (
                          <p className="mt-0.5 text-[12px] text-secondary-text">
                            {movement.reason ?? movement.note}
                          </p>
                        ) : null}
                        {movement.transactionId ? (
                          <p className="mt-1">
                            <Link
                              className="text-[12px] font-medium text-[#C56B70]"
                              href={`/staff/transactions?id=${movement.transactionId}`}
                            >
                              關聯交易
                            </Link>
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {movements.length > 8 ? (
                <button
                  type="button"
                  className="mt-2 text-[12px] font-medium text-[#C56B70]"
                  onClick={() => setShowAllMovements((value) => !value)}
                >
                  {showAllMovements ? "收合異動" : `查看全部 ${movements.length} 筆`}
                </button>
              ) : null}
            </section>
          </div>
        </div>
      </aside>
    </>
  );
}
