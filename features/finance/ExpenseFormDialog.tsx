"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_CATEGORY_ORDER,
  EXPENSE_PAYMENT_METHOD_LABEL,
  EXPENSE_PAYMENT_METHOD_ORDER,
} from "@/lib/finance/domain";
import {
  parseExpenseFormDraft,
  type ExpenseFormDraft,
} from "@/lib/finance/expense-form";
import { isGeneratedExpenseAppId } from "@/lib/finance/expense";
import { expenseWriteUserMessage } from "@/lib/finance/expense-write-ui-error";
import { newId } from "@/lib/repositories/storage";
import { submitExpenseRemoteCreate } from "./use-expense-remote-write";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const fieldClass =
  "mt-1 block min-h-11 w-full min-w-0 rounded-2xl border border-border bg-surface px-3 text-sm text-text outline-none ring-primary/30 focus-visible:ring-2";
const labelClass = "block text-sm text-secondary-text";

export type ExpenseFormDialogProps = {
  open: boolean;
  organizationId: string;
  locationId: string;
  defaultDate: string;
  canCreate: boolean;
  writeEnabled: boolean;
  onClose: () => void;
  onCreated: () => void;
};

function emptyDraft(defaultDate: string): ExpenseFormDraft {
  return {
    expenseDate: defaultDate,
    category: "",
    name: "",
    amount: "",
    paymentMethod: "",
    vendor: "",
    note: "",
  };
}

export function ExpenseFormDialog({
  open,
  organizationId,
  locationId,
  defaultDate,
  canCreate,
  writeEnabled,
  onClose,
  onCreated,
}: ExpenseFormDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const appIdRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<ExpenseFormDraft>(() => emptyDraft(defaultDate));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const first = node?.querySelector<HTMLElement>("input[name='expense-date']");
    first?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy) onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => !item.hasAttribute("disabled") && item.tabIndex !== -1,
      );
      if (items.length === 0) return;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open, onClose, busy]);

  if (!open) return null;

  function setField<K extends keyof ExpenseFormDraft>(key: K, value: ExpenseFormDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError("");
  }

  async function submit() {
    if (busy) return;
    if (!writeEnabled || !canCreate) {
      setError("你沒有新增支出的權限");
      return;
    }
    const parsed = parseExpenseFormDraft(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError("");
    const appId = appIdRef.current ?? newId("exp");
    if (!isGeneratedExpenseAppId(appId)) {
      setBusy(false);
      setError("無法建立支出，請稍後再試");
      return;
    }
    appIdRef.current = appId;
    try {
      await submitExpenseRemoteCreate({
        organizationId,
        locationId,
        expenseDate: parsed.value.expenseDate,
        category: parsed.value.category,
        name: parsed.value.name,
        amountMinor: parsed.value.amountMinor,
        paymentMethod: parsed.value.paymentMethod,
        vendor: parsed.value.vendor,
        note: parsed.value.note,
        appId,
      });
      appIdRef.current = null;
      onCreated();
      onClose();
    } catch (caught) {
      setError(expenseWriteUserMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-text/30"
        aria-label="關閉"
        disabled={busy}
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-expense-form-dialog
        className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto overflow-x-hidden rounded-t-3xl bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] min-[720px]:inset-auto min-[720px]:left-1/2 min-[720px]:top-1/2 min-[720px]:w-[min(100%-2rem,28rem)] min-[720px]:max-h-[90vh] min-[720px]:-translate-x-1/2 min-[720px]:-translate-y-1/2 min-[720px]:rounded-3xl"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-base font-semibold text-text">
            新增支出
          </h2>
          <button
            type="button"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl text-secondary-text"
            aria-label="關閉"
            disabled={busy}
            onClick={() => {
              if (!busy) onClose();
            }}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className={labelClass}>
            日期 *
            <input
              required
              name="expense-date"
              type="date"
              value={draft.expenseDate}
              onChange={(event) => setField("expenseDate", event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className={labelClass}>
            分類 *
            <select
              required
              name="expense-category"
              value={draft.category}
              onChange={(event) => setField("category", event.target.value)}
              className={fieldClass}
            >
              <option value="">請選擇分類</option>
              {EXPENSE_CATEGORY_ORDER.map((category) => (
                <option key={category} value={category}>
                  {EXPENSE_CATEGORY_LABEL[category]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            支出名稱 *
            <input
              required
              name="expense-name"
              value={draft.name}
              onChange={(event) => setField("name", event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className={labelClass}>
            金額 *
            <input
              required
              name="expense-amount"
              inputMode="numeric"
              placeholder="整數金額"
              value={draft.amount}
              onChange={(event) => setField("amount", event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className={labelClass}>
            付款方式
            <select
              name="expense-payment-method"
              value={draft.paymentMethod}
              onChange={(event) => setField("paymentMethod", event.target.value)}
              className={fieldClass}
            >
              <option value="">（未填）</option>
              {EXPENSE_PAYMENT_METHOD_ORDER.map((method) => (
                <option key={method} value={method}>
                  {EXPENSE_PAYMENT_METHOD_LABEL[method]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            廠商 / 收款人
            <input
              name="expense-vendor"
              value={draft.vendor}
              onChange={(event) => setField("vendor", event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className={labelClass}>
            備註
            <textarea
              name="expense-note"
              value={draft.note}
              onChange={(event) => setField("note", event.target.value)}
              className="mt-1 block min-h-24 w-full min-w-0 rounded-2xl border border-border bg-surface px-3 py-2 text-sm text-text"
            />
          </label>
          {error ? <p className="text-sm text-[#B15B5B]">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              className="flex-1"
              variant={writeEnabled && canCreate ? "primary" : "outline"}
              disabled={busy || !writeEnabled || !canCreate}
              aria-disabled={busy || !writeEnabled || !canCreate}
              aria-busy={busy}
            >
              {busy ? "儲存中…" : "儲存"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
