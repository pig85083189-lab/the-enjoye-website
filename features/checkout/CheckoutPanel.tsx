"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Crown, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  addCheckoutItem,
  completeCheckout,
  createCheckoutFromAppointment,
  getCheckoutDraft,
  getCommerceRevision,
  getOpenDraftForAppointment,
  removeCheckoutItem,
  setCheckoutDiscounts,
  setCheckoutPayments,
  setPackageRedemption,
  subscribeCommerce,
  updateCheckoutItemQuantity,
} from "@/lib/commerce/checkout-store";
import {
  ACTIVE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type DiscountType,
  type PaymentMethod,
} from "@/lib/commerce/domain";
import { formatTwd, parseMoneyInput } from "@/lib/commerce/money";
import {
  CHECKOUT_PANEL_WIDTH_PX,
  canConfirmCheckoutPayment,
  checkoutRemainingDue,
  checkoutVisitCountLabel,
  mixedPaymentRemaining,
  packageRedemptionDiscountMinor,
  promotionDiscountMinor,
  storedValuePaymentMinor,
  type CheckoutWorkspaceItem,
} from "@/lib/commerce/checkout-workspace-derived";
import { getServicesForOrganization } from "@/data/mock-services";
import { listUsablePackagesForService } from "@/lib/packages/store";
import { CHECKOUT_ITEM_TYPE_LABEL } from "@/lib/products/domain";
import { searchProducts } from "@/lib/products/store";
import { getProductStock } from "@/lib/inventory/store";
import { getCustomerStoredValueBalance } from "@/lib/stored-value/store";
import { MEMBERSHIP_LABEL, cn } from "@/lib/utils";
import type { Customer } from "@/types";

type PanelTab = "consume" | "wallet" | "notes";

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: "consume", label: "本次消費" },
  { id: "wallet", label: "套票 / 儲值" },
  { id: "notes", label: "客戶備註" },
];

interface CheckoutPanelProps {
  item: CheckoutWorkspaceItem;
  customer: Customer | null;
  organizationId: string;
  staffId: string;
  onClose: () => void;
  onCompleted?: (transactionId: string) => void;
}

export function CheckoutPanel({
  item,
  customer,
  organizationId,
  staffId,
  onClose,
  onCompleted,
}: CheckoutPanelProps) {
  useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  const liveDraft =
    (item.draftId
      ? getCheckoutDraft(organizationId, item.draftId)
      : undefined) ??
    (item.appointmentId
      ? getOpenDraftForAppointment(organizationId, item.appointmentId)
      : undefined) ??
    item.draft;
  const transaction = item.transaction;
  const readOnly =
    item.paid || item.kind === "transaction" || liveDraft?.status === "COMPLETED";

  useEffect(() => {
    if (item.kind !== "appointment" || item.paid || liveDraft?.id) return;
    if (!item.appointmentId) return;
    try {
      if (getOpenDraftForAppointment(organizationId, item.appointmentId)) return;
      createCheckoutFromAppointment(organizationId, {
        appointmentId: item.appointmentId,
        createdByStaffId: staffId,
      });
    } catch {
      /* catalog preview remains until a draft can be created */
    }
  }, [
    item.kind,
    item.paid,
    item.appointmentId,
    liveDraft?.id,
    organizationId,
    staffId,
  ]);

  const [tab, setTab] = useState<PanelTab>("consume");
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("ORDER_FIXED");
  const [discountValue, setDiscountValue] = useState("");
  const [mixedOpen, setMixedOpen] = useState(false);
  const [mixedCash, setMixedCash] = useState("");
  const [mixedCard, setMixedCard] = useState("");
  const [mixedStored, setMixedStored] = useState("");

  const membership = item.membership;
  const membershipText = customer
    ? MEMBERSHIP_LABEL[customer.membership]
    : membership?.id === "vip"
      ? "VIP會員"
      : membership?.id === "new"
        ? "新客"
        : null;
  const visitLabel = checkoutVisitCountLabel(customer?.totalVisits);
  const profileHref = item.customerId ? `/staff/customers/${item.customerId}` : "";

  const services = useMemo(
    () => getServicesForOrganization(organizationId),
    [organizationId],
  );
  const svBalance = item.customerId
    ? getCustomerStoredValueBalance(organizationId, item.customerId)
    : 0;
  const primaryService =
    liveDraft?.items.find((row) => row.type === "SERVICE") ?? null;
  const usablePackages =
    !readOnly && primaryService?.referenceId
      ? listUsablePackagesForService(
          organizationId,
          liveDraft!.customerId,
          primaryService.referenceId,
        )
      : [];

  const lineItems = readOnly && transaction ? transaction.items : liveDraft?.items ?? [];
  const subtotal = readOnly && transaction ? transaction.subtotal : liveDraft?.subtotal ?? item.amountMinor ?? 0;
  const discountTotal =
    readOnly && transaction ? transaction.discountTotal : liveDraft?.discountTotal ?? 0;
  const total = readOnly && transaction ? transaction.total : liveDraft?.total ?? item.amountMinor ?? 0;
  const payments = readOnly && transaction ? transaction.payments : liveDraft?.payments ?? [];
  const remaining = readOnly ? 0 : checkoutRemainingDue(total, liveDraft?.payments ?? []);
  const packageDiscount = packageRedemptionDiscountMinor(liveDraft);
  const promoDiscount = promotionDiscountMinor(liveDraft);
  const svPaid = storedValuePaymentMinor(liveDraft?.payments ?? []);
  const canConfirm =
    !readOnly &&
    canConfirmCheckoutPayment({
      itemCount: liveDraft?.items.length ?? 0,
      total,
      payments: liveDraft?.payments ?? [],
    });

  const productHits = productQuery.trim()
    ? searchProducts(organizationId, productQuery, { activeOnly: true }).slice(0, 8)
    : [];

  const notes = [
    ...(customer?.lastServiceNotes ?? []),
    ...(item.appointment?.notes ?? []),
    item.appointment?.customerNote,
    item.appointment?.internalNote,
  ].filter((row): row is string => Boolean(row && row.trim()));

  function run(action: () => void) {
    try {
      action();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法更新結帳");
    }
  }

  function applySinglePayment(method: PaymentMethod) {
    if (!liveDraft || readOnly) return;
    if (total === 0) {
      run(() => setCheckoutPayments(organizationId, liveDraft.id, []));
      return;
    }
    run(() =>
      setCheckoutPayments(organizationId, liveDraft.id, [{ method, amount: total }]),
    );
  }

  function applyMixedPayments() {
    if (!liveDraft || readOnly) return;
    const cash = parseMoneyInput(mixedCash) ?? 0;
    const card = parseMoneyInput(mixedCard) ?? 0;
    const stored = parseMoneyInput(mixedStored) ?? 0;
    const leftover = mixedPaymentRemaining(total, {
      CASH: cash,
      CARD: card,
      STORED_VALUE: stored,
    });
    if (leftover !== 0) {
      setError(`混合付款剩餘 ${formatTwd(Math.abs(leftover))}，須恰好等於本次應收`);
      return;
    }
    const next: Array<{ method: PaymentMethod; amount: number }> = [];
    if (cash > 0) next.push({ method: "CASH", amount: cash });
    if (card > 0) next.push({ method: "CARD", amount: card });
    if (stored > 0) next.push({ method: "STORED_VALUE", amount: stored });
    run(() => setCheckoutPayments(organizationId, liveDraft.id, next));
  }

  const selectedMethods = new Set(payments.map((row) => row.method));

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-text/25 min-[1200px]:hidden"
        aria-label="關閉結帳面板"
        onClick={onClose}
      />
      <aside
        data-checkout-panel
        data-checkout-panel-width={CHECKOUT_PANEL_WIDTH_PX}
        role="dialog"
        aria-modal="true"
        aria-label={`${item.customerName}的結帳`}
        className={cn(
          "z-50 flex w-full flex-col overflow-hidden border border-border bg-surface",
          "fixed inset-x-0 bottom-0 max-h-[92vh] rounded-t-3xl shadow-[0_-4px_24px_rgba(48,43,43,0.08)]",
          "min-[1200px]:relative min-[1200px]:inset-auto min-[1200px]:z-10 min-[1200px]:sticky min-[1200px]:top-6 min-[1200px]:h-auto min-[1200px]:max-h-[calc(100dvh-3rem)] min-[1200px]:w-[400px] min-[1200px]:min-w-[400px] min-[1200px]:shrink-0 min-[1200px]:rounded-2xl min-[1200px]:shadow-none",
        )}
      >
        <div className="flex shrink-0 items-center justify-between px-5 pt-3.5 pb-2">
          <h2 className="text-[16px] font-semibold text-text">結帳</h2>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary-text hover:bg-primary-light/50"
            aria-label="關閉"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex shrink-0 items-start gap-3 px-5 pb-3">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[15px] font-semibold text-primary"
              aria-hidden
            >
              {item.customerInitials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-[16px] font-semibold text-text">{item.customerName}</p>
                {membership ? (
                  <Badge
                    tone={membership.id === "vip" ? "vip" : "new"}
                    className="px-1.5 py-px text-[10px]"
                  >
                    {membership.id === "vip" ? (
                      <Crown className="mr-0.5 h-2.5 w-2.5" aria-hidden />
                    ) : null}
                    {membership.label}
                  </Badge>
                ) : null}
              </div>
              {membershipText ? (
                <p className="mt-0.5 text-[12px] text-[#6E6666]">{membershipText}</p>
              ) : null}
              {item.customerPhone ? (
                <p className="text-[12px] text-[#6E6666]">{item.customerPhone}</p>
              ) : null}
              {visitLabel ? (
                <p className="text-[12px] text-[#6E6666]">{visitLabel}</p>
              ) : null}
              {profileHref ? (
                <Link
                  href={profileHref}
                  className="mt-1 inline-block text-[12px] font-medium text-primary"
                >
                  查看客戶資料
                </Link>
              ) : null}
            </div>
          </div>

          <div className="mx-5 mb-3 flex rounded-full bg-[#F6F1EE] p-1">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-pressed={tab === entry.id}
                className={cn(
                  "h-8 min-h-8 flex-1 rounded-full text-[12px] font-medium",
                  tab === entry.id
                    ? "bg-surface text-text shadow-sm"
                    : "text-secondary-text",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="px-5 pb-4">
            {tab === "consume" ? (
              <div className="space-y-3">
                {lineItems.length === 0 && item.kind === "appointment" ? (
                  <div className="rounded-xl border border-border/80 bg-[#FBF8F6] px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-text">
                          {item.serviceName}
                        </p>
                        <p className="mt-0.5 text-[12px] text-[#6E6666]">
                          {item.durationMinutes ? `${item.durationMinutes} 分鐘` : "服務"}
                          {item.staffName ? ` · ${item.staffName}` : ""}
                        </p>
                      </div>
                      <p className="shrink-0 text-[14px] font-semibold tabular-nums text-text">
                        {item.amountMinor == null ? "—" : formatTwd(item.amountMinor)}
                      </p>
                    </div>
                  </div>
                ) : lineItems.length === 0 ? (
                  <p className="text-[13px] text-secondary-text">
                    尚未加入服務或商品。可從下方加購。
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {lineItems.map((row) => (
                      <li
                        key={row.id}
                        className="rounded-xl border border-border/80 bg-[#FBF8F6] px-3 py-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium text-text">
                              {row.nameSnapshot}
                            </p>
                            <p className="mt-0.5 text-[12px] text-[#6E6666]">
                              {CHECKOUT_ITEM_TYPE_LABEL[row.type] ?? row.type}
                              {row.type === "SERVICE" && item.durationMinutes
                                ? ` · ${item.durationMinutes} 分鐘`
                                : null}
                              {item.staffName && row.type === "SERVICE"
                                ? ` · ${item.staffName}`
                                : null}
                              {` · ×${row.quantity}`}
                            </p>
                          </div>
                          <p className="shrink-0 text-[14px] font-semibold tabular-nums text-text">
                            {formatTwd(row.lineTotal)}
                          </p>
                        </div>
                        {!readOnly && liveDraft ? (
                          <div className="mt-2 flex items-center justify-end gap-1">
                            {row.type === "PRODUCT" ? (
                              <>
                                <button
                                  type="button"
                                  className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border text-sm"
                                  aria-label="減少數量"
                                  onClick={() =>
                                    run(() => {
                                      if (row.quantity <= 1) {
                                        removeCheckoutItem(
                                          organizationId,
                                          liveDraft.id,
                                          row.id,
                                        );
                                      } else {
                                        updateCheckoutItemQuantity(
                                          organizationId,
                                          liveDraft.id,
                                          row.id,
                                          row.quantity - 1,
                                        );
                                      }
                                    })
                                  }
                                >
                                  −
                                </button>
                                <span className="min-w-6 text-center text-[13px] tabular-nums">
                                  {row.quantity}
                                </span>
                                <button
                                  type="button"
                                  className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border text-sm"
                                  aria-label="增加數量"
                                  onClick={() =>
                                    run(() =>
                                      updateCheckoutItemQuantity(
                                        organizationId,
                                        liveDraft.id,
                                        row.id,
                                        row.quantity + 1,
                                      ),
                                    )
                                  }
                                >
                                  +
                                </button>
                              </>
                            ) : null}
                            <button
                              type="button"
                              className="ml-1 h-8 rounded-lg px-2 text-[12px] text-secondary-text hover:bg-primary-light/50"
                              onClick={() =>
                                run(() =>
                                  removeCheckoutItem(
                                    organizationId,
                                    liveDraft.id,
                                    row.id,
                                  ),
                                )
                              }
                            >
                              移除
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}

                {!readOnly && liveDraft ? (
                  <div>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-center rounded-xl border border-dashed border-primary/40 text-[13px] font-medium text-primary"
                      onClick={() => setAddOpen((open) => !open)}
                    >
                      ＋ 加購商品 / 服務
                    </button>
                    {addOpen ? (
                      <div className="mt-2 space-y-2 rounded-xl border border-border p-2.5">
                        <label className="block text-[12px] text-secondary-text">
                          新增服務
                          <select
                            className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-[13px]"
                            defaultValue=""
                            onChange={(event) => {
                              const id = event.target.value;
                              if (!id) return;
                              run(() =>
                                addCheckoutItem(organizationId, liveDraft.id, {
                                  type: "SERVICE",
                                  referenceId: id,
                                  name: "",
                                  unitPrice: 0,
                                }),
                              );
                              event.target.value = "";
                            }}
                          >
                            <option value="">選擇服務…</option>
                            {services.map((service) => (
                              <option key={service.id} value={service.id}>
                                {service.name}
                                {typeof service.priceMinor === "number"
                                  ? ` · ${formatTwd(service.priceMinor)}`
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-[12px] text-secondary-text">
                          搜尋商品
                          <input
                            className="mt-1 h-10 w-full rounded-xl border border-border px-3 text-[13px]"
                            value={productQuery}
                            onChange={(event) => setProductQuery(event.target.value)}
                            placeholder="名稱 / SKU"
                            aria-label="搜尋商品"
                          />
                        </label>
                        {productQuery.trim() ? (
                          <ul className="max-h-40 space-y-1 overflow-y-auto" role="listbox">
                            {productHits.length === 0 ? (
                              <li className="px-2 py-2 text-[12px] text-secondary-text">
                                找不到啟用中商品
                              </li>
                            ) : (
                              productHits.map((product) => {
                                const stock = getProductStock(
                                  organizationId,
                                  liveDraft.locationId,
                                  product.id,
                                );
                                const outOfStock = stock <= 0;
                                return (
                                  <li key={product.id}>
                                    <button
                                      type="button"
                                      disabled={outOfStock}
                                      className={cn(
                                        "flex min-h-10 w-full items-center justify-between rounded-lg px-2 text-left",
                                        outOfStock
                                          ? "cursor-not-allowed opacity-50"
                                          : "hover:bg-primary-light/50",
                                      )}
                                      onClick={() => {
                                        if (outOfStock) return;
                                        run(() =>
                                          addCheckoutItem(organizationId, liveDraft.id, {
                                            type: "PRODUCT",
                                            referenceId: product.id,
                                            name: "",
                                            unitPrice: 0,
                                            quantity: 1,
                                          }),
                                        );
                                        setProductQuery("");
                                      }}
                                    >
                                      <span className="text-[13px] text-text">
                                        {product.name}
                                      </span>
                                      <span className="text-[12px] tabular-nums text-secondary-text">
                                        {formatTwd(product.priceMinor)}
                                      </span>
                                    </button>
                                  </li>
                                );
                              })
                            )}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {!readOnly && liveDraft ? (
                  <div className="rounded-xl border border-border px-3 py-2.5">
                    <p className="text-[12px] font-medium text-secondary-text">折扣 / 優惠</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <select
                        className="h-9 rounded-xl border border-border px-2 text-[12px]"
                        value={discountType}
                        onChange={(event) =>
                          setDiscountType(event.target.value as DiscountType)
                        }
                        aria-label="折扣類型"
                      >
                        <option value="ORDER_FIXED">固定金額</option>
                        <option value="ORDER_PERCENTAGE">百分比（bps）</option>
                      </select>
                      <input
                        className="h-9 w-24 rounded-xl border border-border px-2 text-[13px]"
                        value={discountValue}
                        onChange={(event) => setDiscountValue(event.target.value)}
                        inputMode="numeric"
                        aria-label="折扣數值"
                        placeholder={discountType === "ORDER_FIXED" ? "300" : "1000"}
                      />
                      <Button
                        variant="secondary"
                        className="h-9 min-h-9 rounded-xl px-3 text-[12px]"
                        onClick={() => {
                          const value = parseMoneyInput(discountValue);
                          if (value == null) {
                            setError("折扣數值無效");
                            return;
                          }
                          run(() =>
                            setCheckoutDiscounts(organizationId, liveDraft.id, [
                              {
                                type: discountType,
                                value,
                                label:
                                  discountType === "ORDER_FIXED"
                                    ? `折 ${formatTwd(value)}`
                                    : `${(value / 100).toFixed(0)}% off`,
                                createdByStaffId: staffId,
                              },
                            ]),
                          );
                        }}
                      >
                        套用
                      </Button>
                      {liveDraft.discounts.length > 0 ? (
                        <Button
                          variant="ghost"
                          className="h-9 min-h-9 px-2 text-[12px]"
                          onClick={() =>
                            run(() =>
                              setCheckoutDiscounts(organizationId, liveDraft.id, []),
                            )
                          }
                        >
                          清除
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <dl className="space-y-1.5 pt-1 text-[13px]">
                  <div className="flex justify-between">
                    <dt className="text-secondary-text">小計</dt>
                    <dd className="tabular-nums text-text">{formatTwd(subtotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-secondary-text">優惠折扣</dt>
                    <dd className="tabular-nums text-text">
                      −{formatTwd(readOnly ? discountTotal : promoDiscount)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-secondary-text">使用套票</dt>
                    <dd className="tabular-nums text-text">
                      −{formatTwd(packageDiscount)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-secondary-text">使用儲值</dt>
                    <dd className="tabular-nums text-text">−{formatTwd(svPaid)}</dd>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2">
                    <dt className="text-[13px] font-semibold text-text">本次應收</dt>
                    <dd
                      data-checkout-due
                      className="text-[22px] font-semibold tabular-nums tracking-tight text-[#C56B70]"
                    >
                      {formatTwd(total)}
                    </dd>
                  </div>
                </dl>

                {!readOnly ? (
                  <div className="space-y-2">
                    <p className="text-[12px] font-medium text-secondary-text">付款方式</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ACTIVE_PAYMENT_METHODS.map((method) => (
                        <button
                          key={method}
                          type="button"
                          aria-pressed={selectedMethods.has(method)}
                          className={cn(
                            "h-9 rounded-full px-3 text-[12px] font-medium",
                            selectedMethods.has(method)
                              ? "bg-primary text-white"
                              : "bg-[#F6F1EE] text-text hover:bg-primary-light",
                          )}
                          onClick={() => {
                            setMixedOpen(false);
                            applySinglePayment(method);
                          }}
                        >
                          {PAYMENT_METHOD_LABEL[method]}
                          {method === "STORED_VALUE" ? ` ${formatTwd(svBalance)}` : ""}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="text-[12px] font-medium text-primary"
                      aria-pressed={mixedOpen}
                      onClick={() => setMixedOpen((open) => !open)}
                    >
                      混合付款
                    </button>
                    {mixedOpen ? (
                      <div className="space-y-2 rounded-xl border border-border p-2.5">
                        <label className="flex items-center justify-between gap-2 text-[12px] text-secondary-text">
                          現金
                          <input
                            className="h-9 w-28 rounded-xl border border-border px-2 text-right text-[13px] tabular-nums"
                            value={mixedCash}
                            onChange={(event) => setMixedCash(event.target.value)}
                            inputMode="numeric"
                            aria-label="現金金額"
                          />
                        </label>
                        <label className="flex items-center justify-between gap-2 text-[12px] text-secondary-text">
                          刷卡
                          <input
                            className="h-9 w-28 rounded-xl border border-border px-2 text-right text-[13px] tabular-nums"
                            value={mixedCard}
                            onChange={(event) => setMixedCard(event.target.value)}
                            inputMode="numeric"
                            aria-label="刷卡金額"
                          />
                        </label>
                        <label className="flex items-center justify-between gap-2 text-[12px] text-secondary-text">
                          儲值
                          <input
                            className="h-9 w-28 rounded-xl border border-border px-2 text-right text-[13px] tabular-nums"
                            value={mixedStored}
                            onChange={(event) => setMixedStored(event.target.value)}
                            inputMode="numeric"
                            aria-label="儲值金額"
                          />
                        </label>
                        <p className="text-[12px] text-secondary-text">
                          剩餘{" "}
                          <span className="tabular-nums text-text">
                            {formatTwd(
                              Math.max(
                                0,
                                mixedPaymentRemaining(total, {
                                  CASH: parseMoneyInput(mixedCash) ?? 0,
                                  CARD: parseMoneyInput(mixedCard) ?? 0,
                                  STORED_VALUE: parseMoneyInput(mixedStored) ?? 0,
                                }),
                              ),
                            )}
                          </span>
                        </p>
                        <Button
                          variant="secondary"
                          className="h-9 min-h-9 w-full rounded-xl text-[12px]"
                          onClick={applyMixedPayments}
                        >
                          套用混合付款
                        </Button>
                      </div>
                    ) : null}
                    <p
                      className={cn(
                        "text-[12px]",
                        remaining === 0 ? "text-secondary-text" : "text-[#B07A4A]",
                      )}
                    >
                      剩餘 {formatTwd(Math.max(0, remaining))}
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-1 text-[12px] text-secondary-text">
                    {payments.map((row) => (
                      <li key={row.id} className="flex justify-between">
                        <span>{PAYMENT_METHOD_LABEL[row.method]}</span>
                        <span className="tabular-nums">{formatTwd(row.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {tab === "wallet" ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-border px-3 py-2.5">
                  <p className="text-[12px] text-secondary-text">儲值餘額</p>
                  <p className="mt-1 text-[20px] font-semibold tabular-nums text-text">
                    {formatTwd(svBalance)}
                  </p>
                  <p className="mt-1 text-[12px] text-secondary-text">
                    僅顯示目前帳戶真實餘額；沒有帳戶時為 NT$0。
                  </p>
                </div>
                <div className="rounded-xl border border-border px-3 py-2.5">
                  <p className="text-[12px] text-secondary-text">可使用套票</p>
                  {usablePackages.length === 0 ? (
                    <p className="mt-2 text-[13px] text-secondary-text">
                      目前沒有可用於本次服務的套票。
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {usablePackages.map((pkg) => {
                        const selected =
                          liveDraft?.packageRedemption?.customerPackageId === pkg.id;
                        return (
                          <li
                            key={pkg.id}
                            className="flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-text">
                                {pkg.nameSnapshot}
                              </p>
                              <p className="text-[12px] text-secondary-text">
                                剩餘 {pkg.usableBalance} 堂
                              </p>
                            </div>
                            {!readOnly && liveDraft && primaryService?.referenceId ? (
                              <Button
                                variant={selected ? "primary" : "secondary"}
                                className="h-9 min-h-9 rounded-xl px-3 text-[12px]"
                                onClick={() =>
                                  run(() => {
                                    if (selected) {
                                      setPackageRedemption(
                                        organizationId,
                                        liveDraft.id,
                                        null,
                                      );
                                    } else {
                                      setPackageRedemption(organizationId, liveDraft.id, {
                                        customerPackageId: pkg.id,
                                        serviceId: primaryService.referenceId!,
                                        sessions: 1,
                                      });
                                    }
                                  })
                                }
                              >
                                {selected ? "取消核銷" : "使用 1 堂"}
                              </Button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}

            {tab === "notes" ? (
              notes.length === 0 ? (
                <p className="text-[13px] text-secondary-text">尚無客戶備註</p>
              ) : (
                <ul className="space-y-2">
                  {notes.map((note) => (
                    <li
                      key={note}
                      className="rounded-xl bg-[#F6F1EE] px-3 py-2 text-[13px] text-text"
                    >
                      {note}
                    </li>
                  ))}
                </ul>
              )
            ) : null}

            {error ? (
              <p className="mt-3 text-[12px] text-[#B07A4A]" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-surface px-5 py-3">
          {readOnly ? (
            <Link
              href={
                transaction
                  ? `/staff/transactions?id=${transaction.id}`
                  : "/staff/transactions"
              }
              className="flex h-[50px] items-center justify-center rounded-2xl bg-[#E7F0EA] text-[15px] font-semibold text-[#5C7F66]"
            >
              已結帳 {formatTwd(total)}
            </Link>
          ) : (
            <button
              type="button"
              data-checkout-confirm
              disabled={!canConfirm}
              className="flex h-[50px] w-full items-center justify-center rounded-2xl bg-[#C56B70] text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                if (!liveDraft || !canConfirm) return;
                run(() => {
                  const tx = completeCheckout(organizationId, liveDraft.id);
                  onCompleted?.(tx.id);
                });
              }}
            >
              確認收款 {formatTwd(total)}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
