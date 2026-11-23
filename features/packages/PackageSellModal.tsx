"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckoutPanel } from "@/features/checkout/CheckoutPanel";
import type { CheckoutDraft, Transaction } from "@/lib/commerce/domain";
import type { CheckoutWorkspaceItem } from "@/lib/commerce/checkout-workspace-derived";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { formatTwd } from "@/lib/commerce/money";
import type { PackageDefinition } from "@/lib/packages/domain";
import { planValidityLabel } from "@/lib/packages/package-plans-derived";
import {
  canStartPackageSale,
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
  serviceNames = {},
  initialCustomerId = null,
  onClose,
}: PackageSellModalProps) {
  const [query, setQuery] = useState("");
  const [defQuery, setDefQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(initialCustomerId);
  const [definitionId, setDefinitionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [previewOnly, setPreviewOnly] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentStatus, setPaymentStatus] = useState<"idle"|"busy"|"ready"|"done">("idle");
  const [financeDraft, setFinanceDraft] = useState<{id:string;updatedAt:string}|null>(null);
  const [paymentError, setPaymentError] = useState("");
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [purchaseCheckout, setPurchaseCheckout] = useState<{ draft: CheckoutDraft; transaction: Transaction | null } | null>(null);

  const [remoteDefinitions, setRemoteDefinitions] = useState<PackageDefinition[]>([]);
  const [remoteServiceNames, setRemoteServiceNames] = useState<Record<string, string>>({});
  const [catalogError, setCatalogError] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setRemoteDefinitions([]);
    setRemoteServiceNames({});
    setCatalogError(false);
    void (async () => {
      try {
        const response = await fetch("/api/staff/packages/overview?" + new URLSearchParams({ organizationId }), {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Package catalog unavailable");
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || !("definitions" in data) || !Array.isArray(data.definitions)) {
          throw new Error("Invalid package catalog");
        }
        const rows = data.definitions as Array<Record<string, unknown>>;
        const services = "services" in data && Array.isArray(data.services) ? data.services as Array<Record<string, unknown>> : [];
        const names: Record<string, string> = {};
        for (const service of services) {
          if (typeof service.id === "string" && typeof service.name === "string") names[service.id] = service.name;
          if (typeof service.app_id === "string" && typeof service.name === "string") names[service.app_id] = service.name;
        }
        const mapped: PackageDefinition[] = rows.filter(row =>
          typeof row.app_id === "string" && row.app_id.length > 0 &&
          typeof row.name === "string" && row.is_active === true &&
          typeof row.session_count === "number" && typeof row.price_minor === "number" &&
          Array.isArray(row.included_services) && row.included_services.length > 0 &&
          row.included_services.every((item: unknown) => item !== null &&
            typeof item === "object" && "serviceId" in item &&
            typeof item.serviceId === "string" && item.serviceId.length > 0 &&
            "sessionsPerRedemption" in item && item.sessionsPerRedemption === 1)
        ).map(row => ({
          id: row.app_id as string,
          organizationId,
          name: row.name as string,
          includedServices: (row.included_services as Array<{serviceId:string; sessionsPerRedemption?:number}>)
            .filter(item => typeof item.serviceId === "string" &&
              item.sessionsPerRedemption === 1)
            .map(item => ({ serviceId: item.serviceId, sessionsPerRedemption: 1 as const })),
          sessionCount: row.session_count as number,
          priceMinor: row.price_minor as number,
          currency: typeof row.currency === "string" ? row.currency : "TWD",
          validityDays: typeof row.validity_days === "number" ? row.validity_days : undefined,
          isActive: true,
          createdAt: "",
          updatedAt: "",
        }));
        if (!controller.signal.aborted) {
          setRemoteDefinitions(mapped);
          setRemoteServiceNames(names);
        }
      } catch {
        if (!controller.signal.aborted) setCatalogError(true);
      }
    })();
    return () => controller.abort();
  }, [open, organizationId]);
  const [eligibleIds, setEligibleIds] = useState<Set<string> | null>(null);
  const [verifiedCustomers, setVerifiedCustomers] = useState<Array<{ id: string; name: string; phone: string }>>([]);
  const [eligibilityError, setEligibilityError] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setEligibleIds(null);
    setVerifiedCustomers([]);
    setEligibilityError(false);
    setCustomerId(null);
    void (async () => {
      try {
        const response = await fetch("/api/staff/stored-value/eligible-customers?organizationId=" + encodeURIComponent(organizationId), {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("LINE eligibility unavailable");
        const result: unknown = await response.json();
        if (!result || typeof result !== "object" || !("customerIds" in result) ||
            !Array.isArray(result.customerIds) ||
            !result.customerIds.every((id: unknown) => typeof id === "string")) throw new Error("Invalid eligibility response");
        const rows = "eligibleCustomers" in result ? result.eligibleCustomers : null;
        if (!Array.isArray(rows) || !rows.every((row: unknown) =>
          row && typeof row === "object" && "id" in row && typeof row.id === "string" &&
          "name" in row && typeof row.name === "string" &&
          "phone" in row && typeof row.phone === "string")) throw new Error("Invalid verified customer list");
        if (!controller.signal.aborted) {
          setEligibleIds(new Set(result.customerIds as string[]));
          setVerifiedCustomers(rows as Array<{ id: string; name: string; phone: string }>);
        }
      } catch {
        if (!controller.signal.aborted) setEligibilityError(true);
      }
    })();
    return () => controller.abort();
  }, [open, organizationId]);
  const eligibleCustomers = verifiedCustomers.filter(row => eligibleIds?.has(row.id));
  const selected = eligibleCustomers.find(row => row.id === customerId) ?? null;
  const definition = remoteDefinitions.find((row) => row.id === definitionId) ?? null;
  const canGo = Boolean(selected && eligibleIds?.has(selected.id)) && canStartPackageSale({ customerId, definitionId });
  const hits = useMemo(
    () => eligibleCustomers.filter(row => (row.name + " " + row.phone).toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8),
    [eligibleCustomers, query],
  );
  const defHits = useMemo(
    () => filterDefinitionsForPackagePicker(remoteDefinitions, defQuery).slice(0, 8),
    [remoteDefinitions, defQuery],
  );

  if (!open) return null;

  function close() {
    setQuery("");
    setDefQuery("");
    setError("");
    setDefinitionId(null);
    setPurchaseCheckout(null);
    setPreviewOnly(false);
    setPaymentStatus("idle"); setFinanceDraft(null); setCheckoutId(null); setPaymentError("");
    onClose();
  }

  async function goToCheckout() {
    if (!selected || !eligibleIds?.has(selected.id) || !definition) {
      setError("請選擇客戶與套票商品");
      return;
    }
    if (!locationId) {
      setError("請先選擇可存取的分店");
      return;
    }
    // Read-only preview uses the already authenticated catalogue and LINE
    // eligibility endpoints. No finance checkout RPC is called.
    // Full cross-database branch authorization remains mandatory for payment.
    setError("");
    setPreviewOnly(true);
  }

  async function financeAction(payload: Record<string,unknown>) {
    const response = await fetch("/api/staff/packages/checkout-transaction", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: {"content-type":"application/json"}, body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "付款交易失敗");
    return result.bundle as {draft:{id:string;updatedAt:string};customerPackageDbId?:string};
  }
  async function savePayment() {
    if (!selected || !definition || paymentStatus !== "idle") return;
    setPaymentStatus("busy"); setPaymentError("");
    try {
      const opened = financeDraft ?? (await financeAction({
        action:"OPEN", checkoutAppId:checkoutId ?? (() => { const id="package-sale-"+crypto.randomUUID(); setCheckoutId(id); return id; })(),
        organizationId,locationId,customerId:selected.id,packageDefinitionId:definition.id,
      })).draft;
      setFinanceDraft(opened);
      const saved = await financeAction({
        action:"SAVE",checkoutAppId:opened.id,expectedUpdatedAt:opened.updatedAt,
        payments:[{method:paymentMethod,amount:definition.priceMinor}],
      });
      setFinanceDraft(saved.draft); setPaymentStatus("ready");
    } catch(e) { setPaymentError(e instanceof Error?e.message:"付款資料無法儲存"); setPaymentStatus("idle"); }
  }
  async function settlePayment() {
    if (!financeDraft || paymentStatus !== "ready") return;
    setPaymentStatus("busy");setPaymentError("");
    try {
      const result=await financeAction({action:"SETTLE",checkoutAppId:financeDraft.id,expectedUpdatedAt:financeDraft.updatedAt});
      if (!result.customerPackageDbId) throw new Error("未收到套票入帳確認");
      setPaymentStatus("done");
    } catch(e) {
      setPaymentError((e instanceof Error?e.message:"交易結果不明")+"，請先核對交易紀錄，勿重複收款。");
      setPaymentStatus("busy");
    }
  }
  if (previewOnly && selected && definition) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(48,43,43,0.35)] min-[720px]:items-center min-[720px]:px-5">
        <div role="dialog" aria-modal="true" aria-labelledby="package-preview-title"
          className="w-full max-w-lg rounded-t-3xl border border-border bg-surface p-5 shadow-xl min-[720px]:rounded-2xl">
          <div className="flex items-center justify-between">
            <h2 id="package-preview-title" className="text-[17px] font-semibold text-text">套票結帳預覽</h2>
            <button type="button" aria-label="關閉" onClick={close}><X className="h-5 w-5" /></button>
          </div>
          <p role="status" className="mt-3 rounded-xl bg-[#FAF7F5] p-3 text-[13px] text-[#986B58]">
            請確認顧客與付款金額，確認收款後才會執行套票入帳。
          </p>
          <div className="mt-4 space-y-3 text-[14px]">
            <div className="flex justify-between"><span className="text-secondary-text">顧客</span><span>{selected.name}</span></div>
            <div className="flex justify-between"><span className="text-secondary-text">套票名稱</span><span>{definition.name}</span></div>
            <div className="flex justify-between"><span className="text-secondary-text">購買堂數</span><span>{definition.sessionCount} 堂</span></div>
            <div><p className="text-secondary-text">指定療程</p><p className="mt-1">{definition.includedServices.map(row => remoteServiceNames[row.serviceId] ?? serviceNames[row.serviceId] ?? "療程名稱待確認").join("、")}</p></div>
            <div className="flex justify-between"><span className="text-secondary-text">有效期限</span><span>{planValidityLabel(definition.validityDays)}</span></div>
            <div className="flex justify-between border-t border-border pt-3 font-semibold"><span>應付金額</span><span>{formatTwd(definition.priceMinor)}</span></div>
          </div>
          <div className="mt-5 space-y-3">
            <label className="block text-sm" htmlFor="package-tender">付款方式</label>
            <select id="package-tender" className="w-full rounded-xl border border-border bg-surface p-3"
              value={paymentMethod} disabled={paymentStatus!=="idle" || Boolean(financeDraft)}
              onChange={event=>setPaymentMethod(event.target.value)}>
              <option value="CASH">現金</option><option value="CARD">刷卡</option>
              <option value="TRANSFER">轉帳</option><option value="OTHER">其他</option>
            </select>
            {paymentError ? <p role="alert" className="text-sm text-[#B07A4A]">{paymentError}</p> : null}
            {paymentStatus==="done" ? <p role="status">套票已完成付款入帳</p> :
              paymentStatus==="ready" ? <Button className="w-full" onClick={()=>{void settlePayment();}}>確認已收款並入帳</Button> :
              <Button className="w-full" disabled={paymentStatus==="busy" || Boolean(financeDraft)}
                onClick={()=>{void savePayment();}}>{paymentStatus==="busy"?"正在處理…":"建立付款明細"}</Button>}
          </div>
          <button type="button" className="mt-3 w-full text-center text-[13px] text-secondary-text"
            onClick={() => setPreviewOnly(false)}>返回選擇套票</button>
        </div>
      </div>
    );
  }

  const checkoutItem: CheckoutWorkspaceItem | null = purchaseCheckout && selected && definition ? {
    id: `draft:${purchaseCheckout.draft.id}`,
    kind: "draft",
    appointmentId: "",
    draftId: purchaseCheckout.draft.id,
    transactionId: purchaseCheckout.transaction?.id ?? "",
    customerId: selected.id,
    customerName: selected.name,
    customerPhone: selected.phone,
    customerInitials: selected.name.slice(0, 1),
    membership: null,
    serviceName: definition.name,
    serviceCategory: "套票",
    durationMinutes: null,
    staffName: "",
    staffInitials: "",
    startAt: null,
    amountMinor: purchaseCheckout.draft.total,
    paid: Boolean(purchaseCheckout.transaction),
    status: { kind: purchaseCheckout.transaction ? "paid" : "pending", title: purchaseCheckout.transaction ? "已結帳" : "待結帳" },
    appointment: null,
    draft: purchaseCheckout.draft,
    transaction: purchaseCheckout.transaction,
  } : null;

  if (checkoutItem && purchaseCheckout) {
    return (
      <CheckoutPanel
        item={checkoutItem}
        customer={null}
        organizationId={organizationId}
        staffId={staffId}
        commerceRemoteRead
        commerceRemoteWrite
        remoteDraft={purchaseCheckout.draft}
        remoteTransaction={purchaseCheckout.transaction}
        onClose={close}
        onCompleted={() => close()}
      />
    );
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
            <p className="text-[13px] font-semibold text-text">選擇已綁定 LINE 會員</p>
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
                    placeholder="搜尋已綁定會員姓名 / 電話"
                    className="h-10 min-h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[14px] outline-none ring-primary/30 focus:ring-2"
                    aria-label="搜尋客戶姓名或電話"
                  />
                </div>
                {!eligibleIds && !eligibilityError ? <p className="mt-2 text-xs text-secondary-text">正在驗證 LINE 會員綁定…</p> : null}
                {eligibilityError ? <p className="mt-2 text-xs text-[#986B58]" role="alert">LINE 會員資格查詢失敗，暫時無法販售套票。</p> : null}
                <ul className="mt-2 max-h-48 overflow-y-auto">
                  {hits.length === 0 ? (
                    <li className="px-1 py-3 text-sm text-secondary-text">尚無符合的已綁定 LINE 會員</li>
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

          <p className="mt-3 text-[12px] leading-relaxed text-[#986B58]">僅限已透過 LINE 登入會員中心、完成顧客綁定且驗證成功的會員購買套票。</p>
          <section className="mt-4">
            <p className="text-[13px] font-semibold text-text">選擇套票商品</p>
            {catalogError ? <p role="alert" className="mt-2 text-sm text-[#986B58]">無法讀取正式套票商品，請重新開啟販售視窗。</p> : null}
            {definition ? (
              <div className="mt-2 rounded-2xl border border-border bg-[#FAF7F5] px-3 py-2.5">
                <p className="text-[14px] font-semibold text-text">{definition.name}</p>
                <p className="mt-0.5 text-[12px] tabular-nums text-secondary-text">
                  {definition.sessionCount} 堂 · {formatTwd(definition.priceMinor)} ·{" "}
                  {planValidityLabel(definition.validityDays)}
                </p>
                <p className="mt-1 truncate text-[12px] text-secondary-text">
                  {definition.includedServices
                    .map((row) => remoteServiceNames[row.serviceId] ?? row.serviceId)
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
                    .map((row) => remoteServiceNames[row.serviceId] ?? serviceNames[row.serviceId] ?? "療程名稱待確認")
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
            onClick={() => { void goToCheckout(); }}
          >
            前往結帳
          </Button>
          <p className="mt-2 text-center text-[12px] text-secondary-text">
            目前提供結帳預覽，尚未開放正式付款。
          </p>
        </div>
      </div>
    </div>
  );
}
