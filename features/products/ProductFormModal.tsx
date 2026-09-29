"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { parseMoneyInput } from "@/lib/commerce/money";
import { PRODUCT_CATEGORY_SUGGESTIONS } from "@/lib/products/domain";
import { createProduct, updateProduct } from "@/lib/products/store";
import type { ProductWorkspaceRow } from "@/lib/products/products-workspace-derived";

type FormState = {
  name: string;
  price: string;
  sku: string;
  barcode: string;
  category: string;
  description: string;
  isActive: boolean;
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

function formFromRow(row: ProductWorkspaceRow): FormState {
  return {
    name: row.name,
    price: String(row.priceMinor),
    sku: row.sku,
    barcode: row.barcode,
    category: row.category,
    description: row.description,
    isActive: row.isActive,
  };
}

interface ProductFormModalProps {
  open: boolean;
  mode: "create" | "edit";
  organizationId: string;
  staffId: string;
  editing: ProductWorkspaceRow | null;
  onClose: () => void;
  onSaved: (productId: string) => void;
}

export function ProductFormModal({
  open,
  mode,
  organizationId,
  staffId,
  editing,
  onClose,
  onSaved,
}: ProductFormModalProps) {
  const [form, setForm] = useState<FormState>(() =>
    mode === "edit" && editing ? formFromRow(editing) : emptyForm(),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  function submit() {
    setError("");
    const price = parseMoneyInput(form.price);
    if (price == null || price < 0) {
      setError("售價須為非負整數（NT$）");
      return;
    }
    if (!form.name.trim()) {
      setError("請輸入商品名稱");
      return;
    }
    setBusy(true);
    try {
      if (mode === "edit" && editing) {
        updateProduct(
          organizationId,
          editing.productId,
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
        onSaved(editing.productId);
      } else {
        const created = createProduct(organizationId, {
          name: form.name,
          priceMinor: price,
          sku: form.sku || undefined,
          barcode: form.barcode || undefined,
          category: form.category || undefined,
          description: form.description || undefined,
          isActive: form.isActive,
          createdByStaffId: staffId,
        });
        onSaved(created.id);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center min-[720px]:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-text/30"
        aria-label="關閉商品表單"
        onClick={onClose}
      />
      <div
        data-products-form-modal
        data-products-form-mode={mode}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "edit" ? "編輯商品" : "新增商品"}
        className="relative z-10 max-h-[min(92vh,720px)] w-full overflow-y-auto rounded-t-3xl border border-border bg-surface px-5 py-5 min-[720px]:max-w-[480px] min-[720px]:rounded-3xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-text">
            {mode === "edit" ? "編輯商品" : "新增商品"}
          </h2>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-secondary-text hover:bg-primary-light/50"
            aria-label="關閉"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-[12px] text-secondary-text">
          商品只存目錄資料，庫存請使用入庫或盤點調整。
          <br />
          建立商品後，再使用「入庫」建立各分店的初始庫存。
        </p>
        <div className="mt-4 grid gap-3">
          <label className="text-[12px] text-secondary-text">
            商品名稱 *
            <input
              className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[14px] text-text"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>
          <div className="grid gap-3 min-[480px]:grid-cols-2">
            <label className="text-[12px] text-secondary-text">
              售價（NT$）*
              <input
                className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[14px] text-text"
                value={form.price}
                onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
                inputMode="numeric"
                required
              />
            </label>
            <label className="text-[12px] text-secondary-text">
              分類
              <input
                className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[14px] text-text"
                value={form.category}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, category: event.target.value }))
                }
                list="product-workspace-categories"
                placeholder="臉部保養"
              />
              <datalist id="product-workspace-categories">
                {PRODUCT_CATEGORY_SUGGESTIONS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="grid gap-3 min-[480px]:grid-cols-2">
            <label className="text-[12px] text-secondary-text">
              SKU
              <input
                className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[14px] text-text"
                value={form.sku}
                onChange={(event) => setForm((prev) => ({ ...prev, sku: event.target.value }))}
              />
            </label>
            <label className="text-[12px] text-secondary-text">
              Barcode
              <input
                className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[14px] text-text"
                value={form.barcode}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, barcode: event.target.value }))
                }
              />
            </label>
          </div>
          <label className="text-[12px] text-secondary-text">
            說明
            <textarea
              className="mt-1 min-h-20 w-full rounded-xl border border-border px-3 py-2 text-[14px] text-text"
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </label>
          <label className="flex min-h-10 items-center gap-2 text-[13px] text-text">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, isActive: event.target.checked }))
              }
            />
            啟用（停用後不可加入新結帳）
          </label>
        </div>
        {error ? (
          <p className="mt-3 text-[13px] text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <Button
            className="h-10 min-h-10 flex-1 rounded-full text-[13px]"
            disabled={busy}
            onClick={submit}
          >
            {busy ? "儲存中…" : "儲存"}
          </Button>
          <Button
            variant="outline"
            className="h-10 min-h-10 rounded-full px-4 text-[13px]"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
