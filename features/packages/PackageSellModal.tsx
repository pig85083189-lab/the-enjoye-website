"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import {
  addCheckoutItem,
  createEmptyCheckoutDraft,
} from "@/lib/commerce/checkout-store";
import { formatTwd } from "@/lib/commerce/money";
import type { PackageDefinition } from "@/lib/packages/domain";
import { planValidityLabel } from "@/lib/packages/package-plans-derived";
import {
  canStartPackageSale,
  filterCustomersForPackagePicker,
  filterDefinitionsForPackagePicker,
} from "@/lib/packages/packages-workspace-derived";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types";

interface PackageSellModalProps {
  open: boolean;
  organizationId: string;
  locationId: string;
  staffId: string;
  customers: Customer[];
  definitions: PackageDefinition[];
  serviceNames?: Record<string, string>;
  initialCustomerId?: string | null;
  onClose: () => void;
}

export function PackageSellModal({
  open,
  organizationId,
  locationId,
  staffId,
  customers,
  definitions,
  serviceNames = {},
  initialCustomerId = null,
  onClose,
}: PackageSellModalProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [defQuery, setDefQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(initialCustomerId);
  const [definitionId, setDefinitionId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const selected = customers.find((row) => row.id === customerId) ?? null;
  const definition = definitions.find((row) => row.id === definitionId) ?? null;
  const canGo = canStartPackageSale({ customerId, definitionId });
  const hits = useMemo(
    () => filterCustomersForPackagePicker(customers, query).slice(0, 8),
    [customers, query],
  );
  const defHits = useMemo(
    () => filterDefinitionsForPackagePicker(definitions, defQuery).slice(0, 8),
    [definitions, defQuery],
  );

  if (!open) return null;

  function close() {
    setQuery("");
    setDefQuery("");
    setError("");
    setDefinitionId(null);
    onClose();
  }

  function goToCheckout() {
    if (!selected || !definition) {
      setError("請選擇客戶與套票商品");
      return;
    }
    if (!locationId) {
      setError("請先選擇可存取的分店");
      return;
    }
    try {
      const draft = createEmptyCheckoutDraft(organizationId, {
        locationId,
        customerId: selected.id,
        createdByStaffId: staffId,
      });
      addCheckoutItem(organizationId, draft.id, {
        type: "PACKAGE_PURCHASE",
        referenceId: definition.id,
        name: definition.name,
        unitPrice: definition.priceMinor,
      });
      router.push(`/staff/checkout?draft=${draft.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法建立套票結帳");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(48,43,43,0.35)] min-[720px]:items-center min-[720px]:px-5"
      role="presentation"
      onClick={close}
    >
      <div
        data-package-sell
        role="dialog"
        aria-modal="true"
        aria-labelledby="package-sell-title"
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-[0_-4px_24px_rgba(48,43,43,0.08)] min-[720px]:rounded-2xl min-[720px]:shadow-[0_8px_32px_rgba(48,43,43,0.08)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-5 pt-4 pb-2">
          <h2 id="package-sell-title" className="text-[17px] font-semibold text-text">
            販售套票
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
                </div>
                <button
                  type="button"
                  className="text-[12px] text-primary"
                  onClick={() => {
                    setCustomerId(null);
                    setQuery("");
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
                <ul className="mt-2 max-h-48 overflow-y-auto">
                  {hits.length === 0 ? (
                    <li className="px-1 py-3 text-sm text-secondary-text">尚無符合的客戶</li>
                  ) : (
                    hits.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className="flex min-h-12 w-full items-center gap-2.5 rounded-xl px-1 py-2 text-left hover:bg-primary-light/40"
                          onClick={() => setCustomerId(row.id)}
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

          <section className="mt-4">
            <p className="text-[13px] font-semibold text-text">選擇套票商品</p>
            {definition ? (
              <div className="mt-2 rounded-2xl border border-border bg-[#FAF7F5] px-3 py-2.5">
                <p className="text-[14px] font-semibold text-text">{definition.name}</p>
                <p className="mt-0.5 text-[12px] tabular-nums text-secondary-text">
                  {definition.sessionCount} 堂 · {formatTwd(definition.priceMinor)} ·{" "}
                  {planValidityLabel(definition.validityDays)}
                </p>
                <p className="mt-1 truncate text-[12px] text-secondary-text">
                  {definition.includedServices
                    .map((row) => serviceNames[row.serviceId] ?? row.serviceId)
                    .join("、")}
                </p>
                <button
                  type="button"
                  className="mt-1 text-[12px] text-primary"
                  onClick={() => {
                    setDefinitionId(null);
                    setDefQuery("");
                  }}
                >
                  重選
                </button>
              </div>
            ) : defHits.length === 0 ? (
              <div className="mt-2 space-y-2">
                <p className="text-sm text-secondary-text">
                  尚無可售套票方案。請先建立套票方案後再販售。
                </p>
                <Link
                  href="/staff/packages/plans"
                  className="inline-flex text-[13px] font-medium text-primary"
                >
                  前往套票方案
                </Link>
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
                    value={defQuery}
                    onChange={(event) => setDefQuery(event.target.value)}
                    placeholder="搜尋套票名稱"
                    className="h-10 min-h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[14px] outline-none ring-primary/30 focus:ring-2"
                    aria-label="搜尋套票名稱"
                  />
                </div>
                <ul className="mt-2 max-h-48 overflow-y-auto">
                  {defHits.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        data-package-definition={row.id}
                        className="flex min-h-12 w-full items-center justify-between rounded-xl px-1 py-2 text-left hover:bg-primary-light/40"
                        onClick={() => setDefinitionId(row.id)}
                      >
                        <span className="min-w-0">
                          <span className="block text-[14px] font-medium text-text">
                            {row.name}
                          </span>
                          <span className="block text-[12px] text-secondary-text">
                            {row.sessionCount} 堂
                          </span>
                        </span>
                        <span className="shrink-0 text-[13px] tabular-nums text-text">
                          {formatTwd(row.priceMinor)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {selected && definition ? (
            <section className="mt-4 rounded-2xl bg-[#FAF7F5] px-3.5 py-3 text-[13px]">
              <div className="flex items-center justify-between py-1">
                <span className="text-secondary-text">客戶</span>
                <span className="text-text">{selected.name}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-secondary-text">套票</span>
                <span className="text-text">{definition.name}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-secondary-text">堂數</span>
                <span className="tabular-nums text-text">{definition.sessionCount} 堂</span>
              </div>
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="shrink-0 text-secondary-text">內容</span>
                <span className="min-w-0 truncate text-right text-text">
                  {definition.includedServices
                    .map((row) => serviceNames[row.serviceId] ?? row.serviceId)
                    .join("、")}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-secondary-text">有效期限</span>
                <span className="text-text">{planValidityLabel(definition.validityDays)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-secondary-text">應付</span>
                <span className="text-[15px] font-semibold tabular-nums text-text">
                  {formatTwd(definition.priceMinor)}
                </span>
              </div>
            </section>
          ) : null}

          {error ? (
            <p className="mt-3 text-sm text-[#B07A4A]" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            data-package-sell-confirm
            className={cn("mt-4 h-[50px] min-h-[50px] w-full rounded-2xl text-[15px]")}
            disabled={!canGo}
            onClick={goToCheckout}
          >
            前往結帳
          </Button>
          <p className="mt-2 text-center text-[12px] text-secondary-text">
            付款與套票建立走既有結帳流程，此處不會直接扣款。
          </p>
        </div>
      </div>
    </div>
  );
}
