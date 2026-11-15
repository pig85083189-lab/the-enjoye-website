"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useCustomerRemoteList } from "@/features/customers/use-customer-remote-read";
import { Button } from "@/components/ui/Button";
import {
  EXTERNAL_PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from "@/lib/commerce/domain";
import { formatTwd, parseMoneyInput } from "@/lib/commerce/money";
import { getCustomerStoredValueBalance } from "@/lib/stored-value/store";
import {
  canConfirmStoredValueTopUp,
  filterCustomersForStoredValuePicker,
  previewStoredValueTopUp,
} from "@/lib/stored-value/stored-value-workspace-derived";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types";

interface StoredValueTopUpModalProps {
  open: boolean;
  organizationId: string;
  locationId: string;
  staffId: string;
  customers: Customer[];
  initialCustomerId?: string | null;
  onClose: () => void;
}

export function StoredValueTopUpModal({
  open,
  organizationId,
  locationId,
  staffId,
  customers,
  initialCustomerId = null,
  onClose,
}: StoredValueTopUpModalProps) {
  const [query, setQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(initialCustomerId);
  const [amountRaw, setAmountRaw] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [error, setError] = useState("");
  const [received, setReceived] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [effectKey, setEffectKey] = useState<string | null>(null);

  // Remote lookup is read-only; only rows authorized by the authenticated customer adapter are returned.
  const remote = useCustomerRemoteList(organizationId, open);
  const remoteCustomerIds = useMemo(() => new Set(
    remote.status === "data" ? remote.value.map((customer) => customer.id).filter(Boolean) : [],
  ), [remote]);
  const searchableCustomers = useMemo(() => {
    const byId = new Map(customers.map((customer) => [customer.id, customer]));
    if (remote.status === "data") {
      for (const customer of remote.value) {
        if (customer.id && customer.organizationId === organizationId && !byId.has(customer.id)) {
          byId.set(customer.id, customer);
        }
      }
    }
    return Array.from(byId.values());
  }, [customers, remote, organizationId]);
  const selected = searchableCustomers.find((row) => row.id === customerId) ?? null;
  // A remotely read customer is not yet supported by the local-only ledger. Never charge it locally.
  const isRemoteOnlyCustomer = Boolean(selected && remoteCustomerIds.has(selected.id));
  const currentBalance = selected && !isRemoteOnlyCustomer
    ? getCustomerStoredValueBalance(organizationId, selected.id)
    : 0;
  const amountMinor = parseMoneyInput(amountRaw);
  const preview = previewStoredValueTopUp({
    currentBalanceMinor: currentBalance,
    amountMinor: amountMinor && amountMinor > 0 ? amountMinor : 0,
  });
  const canConfirm = canConfirmStoredValueTopUp({
    customerId: remote.status === "data" && remoteCustomerIds.has(customerId ?? "") ? customerId : null,
    amountMinor,
  });
  const hits = useMemo(
    () => filterCustomersForStoredValuePicker(searchableCustomers, query).slice(0, 8),
    [searchableCustomers, query],
  );

  if (!open) return null;

  function close() {
    setQuery("");
    setAmountRaw("");
    setError("");
    setMethod("CASH");
    setReceived(false);
    setEffectKey(null);
    onClose();
  }

  async function confirm() {
    if (submitting) return;
    if (remote.status !== "data" || !selected || !remoteCustomerIds.has(selected.id)) {
      setError("正式顧客資料尚未確認，禁止本機入帳。");
      return;
    }
    if (!received || amountMinor == null || amountMinor <= 0 || !locationId ||
        !(EXTERNAL_PAYMENT_METHODS as PaymentMethod[]).includes(method)) {
      setError("請確認顧客、金額、付款方式及已實際收款");
      return;
    }
    // Reuse the same idempotency key after a network failure or uncertain response.
    const key = effectKey ?? `manual-topup:${crypto.randomUUID()}`;
    setEffectKey(key);
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/staff/stored-value/top-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          organizationId, locationId, customerId: selected.id,
          amountMinor, method, effectKey: key, manualPaymentConfirmed: true,
        }),
      });
      const result = await response.json() as { error?: string; entryId?: string };
      if (!response.ok || !result.entryId) {
        throw new Error(result.error ?? "儲值入帳未確認，請勿重複收款");
      }
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲值入帳未確認，請勿重複收款");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(48,43,43,0.35)] min-[720px]:items-center min-[720px]:px-5"
      role="presentation"
      onClick={close}
    >
      <div
        data-stored-value-topup
        role="dialog"
        aria-modal="true"
        aria-labelledby="stored-value-topup-title"
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-[0_-4px_24px_rgba(48,43,43,0.08)] min-[720px]:rounded-2xl min-[720px]:shadow-[0_8px_32px_rgba(48,43,43,0.08)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-5 pt-4 pb-2">
          <h2 id="stored-value-topup-title" className="text-[17px] font-semibold text-text">
            新增儲值
          </h2>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-secondary-text hover:bg-primary-light/50"
            aria-label="關閉"
            onClick={close}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <section>
            <p className="text-[13px] font-semibold text-text">選擇客戶</p>
            {selected ? (
              <div className="mt-2 flex items-center gap-3 rounded-2xl border border-border bg-[#FAF7F5] px-3 py-2.5">
                <Avatar initials={selected.name.slice(0, 1)} size="sm" className="gap-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-text">{selected.name}</p>
                  <p className="text-[12px] text-secondary-text">{selected.phone}</p>
                  <p className="text-[12px] tabular-nums text-secondary-text">
                    {isRemoteOnlyCustomer ? "正式帳務餘額尚未連線，無法顯示" : `目前餘額 ${formatTwd(currentBalance)}`}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-[12px] text-primary"
                  onClick={() => {
                    setCustomerId(null);
                    setQuery("");
                    setReceived(false);
                    setEffectKey(null);
                  }}
                >
                  重選
                </button>
              </div>
            ) : (
              <>
                <div className="relative mt-2">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary-text"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜尋姓名 / 電話"
                    className="h-10 min-h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[14px] outline-none ring-primary/30 focus:ring-2"
                    aria-label="搜尋客戶姓名或電話"
                  />
                </div>
                {remote.status === "loading" ? <p className="mt-2 text-xs text-secondary-text">正在查詢正式顧客資料…</p> : null}
                {remote.status === "error" ? <p className="mt-2 text-xs text-[#986B58]" role="status">正式顧客資料暫時無法讀取，目前僅顯示本機清單。</p> : null}
                <ul className="mt-2 max-h-48 overflow-y-auto">
                  {hits.length === 0 ? (
                    <li className="px-1 py-3 text-sm text-secondary-text">尚無符合的客戶</li>
                  ) : (
                    hits.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className="flex min-h-12 w-full items-center gap-2.5 rounded-xl px-1 py-2 text-left hover:bg-primary-light/40"
                          onClick={() => { setCustomerId(row.id); setReceived(false); setEffectKey(null); }}
                        >
                          <Avatar initials={row.name.slice(0, 1)} size="sm" className="gap-0" />
                          <span className="min-w-0">
                            <span className="block text-[14px] font-medium text-text">
                              {row.name}
                            </span>
                            <span className="block text-[12px] text-secondary-text">
                              {row.phone}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </>
            )}
          </section>

          <p className="mt-3 text-[12px] leading-relaxed text-[#986B58]" role="note">\n            此功能僅在隔離測試環境啟用正式資料庫入帳。未完成 LINE 綁定前，會員中心可能無法顯示餘額。\n          </p>\n\n          {isRemoteOnlyCustomer ? (
            <p role="alert" className="mt-2 text-[12px] text-[#986B58]">正式顧客的餘額須由伺服器查詢，不能使用本機餘額作為依據。</p>
          ) : null}

          <section className="mt-4">
            <p className="text-[13px] font-semibold text-text">本次儲值</p>
            <label className="mt-2 block text-[12px] text-secondary-text">
              實收金額
              <div className="relative mt-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-secondary-text">
                  NT$
                </span>
                <input
                  value={amountRaw}
                  onChange={(event) => { setAmountRaw(event.target.value); setReceived(false); setEffectKey(null); }}
                  inputMode="numeric"
                  placeholder="0"
                  aria-label="實收金額"
                  className="h-11 min-h-11 w-full rounded-xl border border-border bg-surface pl-12 pr-3 text-[15px] tabular-nums outline-none ring-primary/30 focus:ring-2"
                />
              </div>
            </label>
          </section>

          <section className="mt-4">
            <p className="text-[13px] font-semibold text-text">付款方式</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXTERNAL_PAYMENT_METHODS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => { setMethod(item); setReceived(false); setEffectKey(null); }}
                  className={cn(
                    "h-8 min-h-8 rounded-full px-3 text-[12px] font-medium",
                    method === item
                      ? "bg-primary text-white"
                      : "bg-[#F6F1EE] text-text hover:bg-primary-light",
                  )}
                >
                  {PAYMENT_METHOD_LABEL[item]}
                </button>
              ))}
            </div>
          </section>

          {selected && !isRemoteOnlyCustomer ? <section className="mt-4 rounded-2xl bg-[#FAF7F5] px-3.5 py-3 text-[13px]">
            <PreviewLine label="目前餘額" value={formatTwd(preview.currentBalanceMinor)} />
            <PreviewLine
              label="本次儲值"
              value={`+${formatTwd(preview.amountMinor)}`}
              emphasize
            />
            <PreviewLine
              label="完成後餘額"
              value={formatTwd(preview.afterBalanceMinor)}
              strong
            />
          </section> : null}

          {error ? (
            <p className="mt-3 text-sm text-[#B07A4A]" role="alert">
              {error}
            </p>
          ) : null}

          <label className="mt-4 flex items-start gap-2 text-[13px] text-text">
            <input type="checkbox" checked={received} disabled={submitting}
              onChange={(event) => setReceived(event.target.checked)}
              className="mt-0.5" />
            我已實際收到本筆款項，確認由本人負責此筆手動收款紀錄
          </label>
          <Button
            data-stored-value-topup-confirm
            className="mt-4 h-[50px] min-h-[50px] w-full rounded-2xl text-[15px]"
            disabled={!canConfirm || !received || submitting}
            onClick={() => { void confirm(); }}
          >
            {submitting ? "正在確認入帳…" : amountMinor && amountMinor > 0
              ? `確認儲值 ${formatTwd(amountMinor)}`
              : "確認儲值"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreviewLine({
  label,
  value,
  emphasize = false,
  strong = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-secondary-text">{label}</span>
      <span
        className={cn(
          "tabular-nums",
          strong && "text-[15px] font-semibold text-text",
          emphasize && "font-medium text-[#5C7F66]",
          !strong && !emphasize && "text-text",
        )}
      >
        {value}
      </span>
    </div>
  );
}
