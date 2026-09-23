"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatHm, formatYmd } from "@/lib/appointments/domain";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { formatTwd, parseMoneyInput } from "@/lib/commerce/money";
import {
  INVENTORY_MOVEMENT_TYPE_LABEL,
  type InventoryMovement,
} from "@/lib/inventory/domain";
import {
  adjustInventory,
  canActorManageInventory,
  getProductStock,
  listInventoryMovements,
  listProductInventoryAcrossLocations,
  receiveStock,
} from "@/lib/inventory/store";
import {
  PRODUCT_CATEGORY_SUGGESTIONS,
  type Product,
} from "@/lib/products/domain";
import {
  canActorManageProducts,
  createProduct,
  deactivateProduct,
  listProducts,
  searchProducts,
  updateProduct,
} from "@/lib/products/store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { cn } from "@/lib/utils";

type FormState = {
  name: string;
  price: string;
  sku: string;
  barcode: string;
  category: string;
  description: string;
  isActive: boolean;
};

type StockPanel = {
  productId: string;
  mode: "view" | "receive" | "adjust";
};

const emptyForm = (): FormState => ({
  name: "",
  price: "",
  sku: "",
  barcode: "",
  category: "",
  description: "",
  isActive: true,
});

function formFromProduct(p: Product): FormState {
  return {
    name: p.name,
    price: String(p.priceMinor),
    sku: p.sku ?? "",
    barcode: p.barcode ?? "",
    category: p.category ?? "",
    description: p.description ?? "",
    isActive: p.isActive,
  };
}

function runningBalances(
  movements: InventoryMovement[],
): Array<InventoryMovement & { balanceAfter: number }> {
  let bal = 0;
  return movements.map((m) => {
    bal += m.quantityDelta;
    return { ...m, balanceAfter: bal };
  });
}

export function ProductsPageClient() {
  const { organization, membership, currentLocation, locations } =
    useOrganization();
  const revision = useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  const staffId = membership?.userId ?? "";
  const canManage =
    Boolean(staffId) && canActorManageProducts(organization.id, staffId);
  const canInventory =
    Boolean(staffId) && canActorManageInventory(organization.id, staffId);
  const locationId = currentLocation?.id ?? "";
  const locationName = currentLocation?.name ?? "目前分店";

  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [stockPanel, setStockPanel] = useState<StockPanel | null>(null);
  const [receiveQty, setReceiveQty] = useState("10");
  const [receiveNote, setReceiveNote] = useState("");
  const [receiveLocationId, setReceiveLocationId] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("-1");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustLocationId, setAdjustLocationId] = useState("");

  const products = useMemo(() => {
    void revision;
    return query.trim()
      ? searchProducts(organization.id, query)
      : listProducts(organization.id);
  }, [organization.id, query, revision]);

  const selectedProduct = stockPanel
    ? products.find((p) => p.id === stockPanel.productId) ??
      listProducts(organization.id).find((p) => p.id === stockPanel.productId)
    : undefined;

  const locationStocks = useMemo(() => {
    void revision;
    if (!stockPanel) return [];
    return listProductInventoryAcrossLocations(
      organization.id,
      stockPanel.productId,
    );
  }, [organization.id, stockPanel, revision]);

  const movements = useMemo(() => {
    void revision;
    if (!stockPanel) return [];
    return runningBalances(
      listInventoryMovements(organization.id, {
        productId: stockPanel.productId,
      }),
    );
  }, [organization.id, stockPanel, revision]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setError("");
    setShowForm(true);
  }

  function openEdit(p: Product) {
    setEditingId(p.id);
    setForm(formFromProduct(p));
    setError("");
    setShowForm(true);
  }

  function openStock(p: Product, mode: StockPanel["mode"] = "view") {
    setStockPanel({ productId: p.id, mode });
    setReceiveQty("10");
    setReceiveNote("");
    setReceiveLocationId(locationId);
    setAdjustDelta("-1");
    setAdjustReason("");
    setAdjustLocationId(locationId);
    setError("");
  }

  function submit() {
    setError("");
    if (!canManage) {
      setError("無權限管理商品");
      return;
    }
    const price = parseMoneyInput(form.price);
    if (price == null || price < 0) {
      setError("售價須為非負整數（NT$）");
      return;
    }
    try {
      if (editingId) {
        updateProduct(
          organization.id,
          editingId,
          {
            name: form.name,
            priceMinor: price,
            sku: form.sku || null,
            barcode: form.barcode || null,
            category: form.category || null,
            description: form.description || null,
            isActive: form.isActive,
          },
          staffId,
        );
      } else {
        createProduct(organization.id, {
          name: form.name,
          priceMinor: price,
          sku: form.sku || undefined,
          barcode: form.barcode || undefined,
          category: form.category || undefined,
          description: form.description || undefined,
          isActive: form.isActive,
          createdByStaffId: staffId,
        });
      }
      setShowForm(false);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    }
  }

  function deactivate(p: Product) {
    setError("");
    try {
      deactivateProduct(organization.id, p.id, staffId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "停用失敗");
    }
  }

  function submitReceive() {
    setError("");
    if (!stockPanel || !canInventory) return;
    const qty = Number.parseInt(receiveQty, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError("入庫數量須為正整數");
      return;
    }
    try {
      receiveStock(organization.id, {
        productId: stockPanel.productId,
        locationId: receiveLocationId || locationId,
        quantity: qty,
        note: receiveNote || undefined,
        createdByStaffId: staffId,
      });
      setStockPanel({ ...stockPanel, mode: "view" });
      setReceiveNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "入庫失敗");
    }
  }

  function submitAdjust() {
    setError("");
    if (!stockPanel || !canInventory) return;
    const delta = Number.parseInt(adjustDelta, 10);
    if (!Number.isInteger(delta) || delta === 0) {
      setError("調整數量須為非零整數（可正可負）");
      return;
    }
    if (!adjustReason.trim()) {
      setError("盤點調整必須填寫原因");
      return;
    }
    try {
      adjustInventory(organization.id, {
        productId: stockPanel.productId,
        locationId: adjustLocationId || locationId,
        quantityDelta: delta,
        reason: adjustReason,
        createdByStaffId: staffId,
      });
      setStockPanel({ ...stockPanel, mode: "view" });
      setAdjustReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "調整失敗");
    }
  }

  function locationLabel(id: string): string {
    return locations.find((l) => l.id === id)?.name ?? id;
  }

  function currentLocStock(productId: string): number | null {
    if (!locationId) return null;
    return getProductStock(organization.id, locationId, productId);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text">商品</h1>
          <p className="mt-1 text-sm text-secondary-text">
            {organization.name} · 目錄 org-wide · 庫存依分店（目前：
            {locationName}）
          </p>
        </div>
        {canManage ? (
          <Button className="min-h-11" onClick={openCreate}>
            新增商品
          </Button>
        ) : null}
      </header>

      <label className="block text-sm text-secondary-text">
        搜尋名稱／SKU／Barcode
        <input
          className="mt-1 min-h-11 w-full max-w-md rounded-2xl border border-border bg-surface px-3"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例如：按摩霜、SKU-01、471…"
          aria-label="搜尋商品"
        />
      </label>

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {showForm && canManage ? (
        <Card padding="lg" className="space-y-3">
          <h2 className="text-lg font-medium text-text">
            {editingId ? "編輯商品" : "新增商品"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-secondary-text sm:col-span-2">
              商品名稱 *
              <input
                className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </label>
            <label className="text-sm text-secondary-text">
              售價（NT$）*
              <input
                className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                inputMode="numeric"
                required
              />
            </label>
            <label className="text-sm text-secondary-text">
              分類
              <input
                className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                list="product-categories"
                placeholder="臉部保養"
              />
              <datalist id="product-categories">
                {PRODUCT_CATEGORY_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="text-sm text-secondary-text">
              SKU
              <input
                className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              />
            </label>
            <label className="text-sm text-secondary-text">
              Barcode
              <input
                className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                value={form.barcode}
                onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
              />
            </label>
            <label className="text-sm text-secondary-text sm:col-span-2">
              說明
              <textarea
                className="mt-1 min-h-20 w-full rounded-2xl border border-border px-3 py-2"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isActive: e.target.checked }))
                }
              />
              啟用（停用後不可加入新結帳）
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" onClick={submit}>
              儲存
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            >
              取消
            </Button>
          </div>
        </Card>
      ) : null}

      {stockPanel && selectedProduct ? (
        <Card padding="lg" className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-text">
                庫存 · {selectedProduct.name}
              </h2>
              <p className="mt-1 text-sm text-secondary-text">
                各分店餘額 = SUM(異動)；非組織總庫存授權銷售
              </p>
            </div>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setStockPanel(null)}
            >
              關閉
            </Button>
          </div>

          <ul className="grid gap-2 sm:grid-cols-2">
            {locations.map((loc) => {
              const row = locationStocks.find((s) => s.locationId === loc.id);
              const stock = row?.stock ?? 0;
              return (
                <li
                  key={loc.id}
                  className="rounded-2xl border border-border px-4 py-3 text-sm"
                >
                  <p className="font-medium text-text">{loc.name}</p>
                  <p className="mt-1 tabular-nums text-secondary-text">
                    目前庫存 {stock}
                    {stock === 0 ? "（缺貨）" : ""}
                  </p>
                </li>
              );
            })}
          </ul>

          {canInventory ? (
            <div className="flex flex-wrap gap-2">
              <Button
                className="min-h-11"
                variant={stockPanel.mode === "receive" ? "primary" : "outline"}
                onClick={() =>
                  setStockPanel({ ...stockPanel, mode: "receive" })
                }
              >
                入庫
              </Button>
              <Button
                className="min-h-11"
                variant={stockPanel.mode === "adjust" ? "primary" : "outline"}
                onClick={() =>
                  setStockPanel({ ...stockPanel, mode: "adjust" })
                }
              >
                盤點調整
              </Button>
            </div>
          ) : (
            <p className="text-sm text-secondary-text">
              僅 OWNER／MANAGER 可入庫或盤點調整；您可查看庫存與異動。
            </p>
          )}

          {stockPanel.mode === "receive" && canInventory ? (
            <div className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-2">
              <label className="text-sm text-secondary-text">
                分店 *
                <select
                  className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                  value={receiveLocationId}
                  onChange={(e) => setReceiveLocationId(e.target.value)}
                  aria-label="入庫分店"
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-secondary-text">
                數量 *
                <input
                  className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                  value={receiveQty}
                  onChange={(e) => setReceiveQty(e.target.value)}
                  inputMode="numeric"
                  aria-label="入庫數量"
                />
              </label>
              <label className="text-sm text-secondary-text sm:col-span-2">
                備註（選填）
                <input
                  className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                  value={receiveNote}
                  onChange={(e) => setReceiveNote(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button className="min-h-11" onClick={submitReceive}>
                  確認入庫
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() =>
                    setStockPanel({ ...stockPanel, mode: "view" })
                  }
                >
                  取消
                </Button>
              </div>
            </div>
          ) : null}

          {stockPanel.mode === "adjust" && canInventory ? (
            <div className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-2">
              <label className="text-sm text-secondary-text">
                分店 *
                <select
                  className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                  value={adjustLocationId}
                  onChange={(e) => setAdjustLocationId(e.target.value)}
                  aria-label="調整分店"
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-secondary-text">
                數量變化（可負）*
                <input
                  className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(e.target.value)}
                  inputMode="numeric"
                  aria-label="調整數量變化"
                />
              </label>
              <label className="text-sm text-secondary-text sm:col-span-2">
                原因 *
                <input
                  className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="例如：盤點短缺、破損"
                  aria-label="調整原因"
                />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button className="min-h-11" onClick={submitAdjust}>
                  確認調整
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() =>
                    setStockPanel({ ...stockPanel, mode: "view" })
                  }
                >
                  取消
                </Button>
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="text-sm font-medium text-secondary-text">異動紀錄</h3>
            {movements.length === 0 ? (
              <p className="mt-2 text-sm text-secondary-text">尚無庫存異動。</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {[...movements].reverse().map((m) => (
                  <li
                    key={m.id}
                    className="rounded-2xl border border-border px-3 py-3 text-sm"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-text">
                        {INVENTORY_MOVEMENT_TYPE_LABEL[m.type]}
                        <span className="ml-2 tabular-nums text-secondary-text">
                          {m.quantityDelta > 0 ? "+" : ""}
                          {m.quantityDelta}
                        </span>
                      </p>
                      <p className="tabular-nums text-secondary-text">
                        餘額 {m.balanceAfter}
                      </p>
                    </div>
                    <p className="mt-1 text-secondary-text">
                      {locationLabel(m.locationId)} ·{" "}
                      {formatYmd(new Date(m.createdAt))}{" "}
                      {formatHm(new Date(m.createdAt))}
                    </p>
                    {m.reason || m.note ? (
                      <p className="mt-1 text-secondary-text">
                        {m.reason ?? m.note}
                      </p>
                    ) : null}
                    {m.transactionId ? (
                      <p className="mt-1">
                        <Link
                          className="text-primary"
                          href={`/staff/transactions?id=${m.transactionId}`}
                        >
                          關聯交易
                        </Link>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : null}

      {products.length === 0 ? (
        <Card padding="lg" className="text-sm text-secondary-text">
          尚無商品。請先新增商品後再於結帳加入。
        </Card>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-secondary-text">
                  <th className="px-3 py-3 font-medium">商品名稱</th>
                  <th className="px-3 py-3 font-medium">SKU</th>
                  <th className="px-3 py-3 font-medium">分類</th>
                  <th className="px-3 py-3 font-medium">售價</th>
                  <th className="px-3 py-3 font-medium">{locationName}庫存</th>
                  <th className="px-3 py-3 font-medium">狀態</th>
                  <th className="px-3 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const stock = currentLocStock(p.id);
                  return (
                    <tr key={p.id} className="border-b border-border/70">
                      <td className="px-3 py-3 font-medium text-text">{p.name}</td>
                      <td className="px-3 py-3 text-secondary-text">
                        {p.sku ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-secondary-text">
                        {p.category ?? "—"}
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {formatTwd(p.priceMinor)}
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {stock == null ? "—" : stock === 0 ? "缺貨 0" : stock}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={cn(
                            "font-medium",
                            p.isActive ? "text-text" : "text-secondary-text",
                          )}
                        >
                          {p.isActive ? "啟用" : "停用"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            className="min-h-11"
                            onClick={() => openStock(p)}
                          >
                            庫存
                          </Button>
                          {canManage ? (
                            <>
                              <Button
                                variant="outline"
                                className="min-h-11"
                                onClick={() => openEdit(p)}
                              >
                                編輯
                              </Button>
                              {p.isActive ? (
                                <Button
                                  variant="ghost"
                                  className="min-h-11"
                                  onClick={() => deactivate(p)}
                                >
                                  停用
                                </Button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {products.map((p) => {
              const stock = currentLocStock(p.id);
              return (
                <li key={p.id}>
                  <Card padding="lg" className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-text">{p.name}</p>
                        <p className="mt-1 text-sm text-secondary-text">
                          {p.category ?? "未分類"}
                          {p.sku ? ` · ${p.sku}` : ""}
                        </p>
                      </div>
                      <p className="tabular-nums font-medium">
                        {formatTwd(p.priceMinor)}
                      </p>
                    </div>
                    <p className="text-sm text-text">
                      狀態：{p.isActive ? "啟用" : "停用"}
                    </p>
                    <p className="text-sm text-secondary-text">
                      {locationName}庫存：
                      <span className="font-medium text-text">
                        {stock == null ? "—" : stock === 0 ? "缺貨 0" : stock}
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() => openStock(p)}
                      >
                        庫存
                      </Button>
                      {canManage ? (
                        <>
                          <Button
                            variant="outline"
                            className="min-h-11"
                            onClick={() => openEdit(p)}
                          >
                            編輯
                          </Button>
                          {p.isActive ? (
                            <Button
                              variant="ghost"
                              className="min-h-11"
                              onClick={() => deactivate(p)}
                            >
                              停用
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
