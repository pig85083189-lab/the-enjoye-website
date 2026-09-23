"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { STATUS_LABEL, formatHm } from "@/lib/appointments/domain";
import {
  addCheckoutItem,
  completeCheckout,
  createCheckoutFromAppointment,
  getCheckoutDraft,
  getCommerceRevision,
  getOpenDraftForAppointment,
  listCheckoutCandidates,
  removeCheckoutItem,
  setCheckoutDiscounts,
  setCheckoutPayments,
  setPackageRedemption,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import {
  ACTIVE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type DiscountType,
  type PaymentMethod,
} from "@/lib/commerce/domain";
import { formatTwd, parseMoneyInput } from "@/lib/commerce/money";
import {
  getCompletedTransactionForAppointment,
  hasCompletedTransactionForAppointment,
} from "@/lib/commerce/transaction-store";
import { getServicesForOrganization } from "@/data/mock-services";
import { getCustomerById } from "@/data/mock-customers";
import { getScheduleAppointment } from "@/lib/appointments/store";
import { listUsablePackagesForService } from "@/lib/packages/store";
import { getCustomerStoredValueBalance } from "@/lib/stored-value/store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { cn } from "@/lib/utils";

export function CheckoutPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization, currentLocation, locations, membership } = useOrganization();
  const revision = useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  void revision;

  const appointmentIdParam = searchParams.get("appointment") ?? undefined;
  const draftIdParam = searchParams.get("draft") ?? undefined;
  const treatmentIdParam = searchParams.get("treatment") ?? undefined;
  const locationId = currentLocation?.id ?? locations[0]?.id ?? "";
  const staffId = membership?.userId ?? "staff-001";

  const [error, setError] = useState("");
  const [draftId, setDraftId] = useState<string | null>(draftIdParam ?? null);
  const [boundOrgId, setBoundOrgId] = useState(organization.id);

  // Tenant switch: drop local draft pointer so prior-org draft ids cannot flash
  if (boundOrgId !== organization.id) {
    setBoundOrgId(organization.id);
    setDraftId(draftIdParam ?? null);
    setError("");
  }

  // Keep draftId aligned with URL (React-allowed render-time adjust when props change)
  const effectiveDraftId =
    draftIdParam && draftId !== draftIdParam ? draftIdParam : draftId;
  if (effectiveDraftId !== draftId) {
    setDraftId(effectiveDraftId);
  }

  const resolved = (() => {
    if (effectiveDraftId) {
      const d = getCheckoutDraft(organization.id, effectiveDraftId);
      if (d) return d;
    }
    if (appointmentIdParam) {
      return getOpenDraftForAppointment(organization.id, appointmentIdParam) ?? null;
    }
    return null;
  })();

  const candidates = listCheckoutCandidates(organization.id, locationId);
  const pendingAppointment =
    appointmentIdParam && !resolved
      ? getScheduleAppointment(organization.id, appointmentIdParam)
      : undefined;
  const pendingAlreadyPaid =
    appointmentIdParam != null &&
    hasCompletedTransactionForAppointment(organization.id, appointmentIdParam);

  function startFromAppointment(appointmentId: string) {
    setError("");
    try {
      if (hasCompletedTransactionForAppointment(organization.id, appointmentId)) {
        const tx = getCompletedTransactionForAppointment(organization.id, appointmentId);
        if (tx) {
          router.push(`/staff/transactions?id=${tx.id}`);
          return;
        }
        setError("此預約已結帳");
        return;
      }
      const draft = createCheckoutFromAppointment(organization.id, {
        appointmentId,
        createdByStaffId: staffId,
        treatmentId: treatmentIdParam,
      });
      setDraftId(draft.id);
      router.replace(`/staff/checkout?draft=${draft.id}&appointment=${appointmentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法建立結帳");
    }
  }

  if (!resolved) {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-2xl font-semibold text-text">結帳</h1>
          <p className="mt-1 text-sm text-secondary-text">
            選擇要結帳的預約（服務中 / 已完成且尚未結帳）
          </p>
        </header>
        {error ? (
          <p className="text-sm text-[#B07A4A]" role="alert">
            {error}
          </p>
        ) : null}
        {pendingAlreadyPaid && appointmentIdParam ? (
          <Card padding="lg" className="space-y-2 text-sm">
            <p className="text-secondary-text">此預約已結帳。</p>
            <Button
              className="min-h-11"
              onClick={() => {
                const tx = getCompletedTransactionForAppointment(
                  organization.id,
                  appointmentIdParam,
                );
                if (tx) router.push(`/staff/transactions?id=${tx.id}`);
              }}
            >
              查看交易
            </Button>
          </Card>
        ) : null}
        {pendingAppointment && !pendingAlreadyPaid ? (
          <Card padding="lg" className="space-y-3">
            <p className="font-medium text-text">{pendingAppointment.customerName}</p>
            <p className="text-sm text-secondary-text">
              {pendingAppointment.serviceName} · {STATUS_LABEL[pendingAppointment.status]}
            </p>
            <Button
              className="min-h-11"
              onClick={() => startFromAppointment(pendingAppointment.id)}
            >
              開始結帳
            </Button>
          </Card>
        ) : null}
        {candidates.length === 0 && !pendingAppointment ? (
          <Card padding="lg" className="text-sm text-secondary-text">
            目前沒有可結帳的預約。請先完成到店與服務流程。
          </Card>
        ) : (
          <ul className="space-y-2">
            {candidates
              .filter((c) => c.appointmentId !== appointmentIdParam)
              .map((c) => (
              <li key={c.appointmentId}>
                <button
                  type="button"
                  disabled={c.alreadyCheckedOut}
                  onClick={() => startFromAppointment(c.appointmentId)}
                  className={cn(
                    "min-h-11 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-left",
                    c.alreadyCheckedOut && "opacity-60",
                  )}
                >
                  <p className="font-medium text-text">{c.customerName}</p>
                  <p className="text-sm text-secondary-text">
                    {formatHm(new Date(c.startAt))} · {c.serviceName} · {c.staffName}
                  </p>
                  <p className="mt-1 text-xs text-secondary-text">
                    {STATUS_LABEL[c.status as keyof typeof STATUS_LABEL] ?? c.status}
                    {c.alreadyCheckedOut ? " · 已結帳" : ""}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <CheckoutWorkspace
      organizationId={organization.id}
      draftId={resolved.id}
      staffId={staffId}
      onCompleted={(txId) => router.push(`/staff/transactions?id=${txId}`)}
    />
  );
}

function CheckoutWorkspace({
  organizationId,
  draftId,
  staffId,
  onCompleted,
}: {
  organizationId: string;
  draftId: string;
  staffId: string;
  onCompleted: (txId: string) => void;
}) {
  const revision = useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  void revision;
  const draft = getCheckoutDraft(organizationId, draftId);
  const customer = draft ? getCustomerById(draft.customerId, organizationId) : null;
  const appointment = draft?.appointmentId
    ? getScheduleAppointment(organizationId, draft.appointmentId)
    : null;
  const services = getServicesForOrganization(organizationId);

  const [error, setError] = useState("");
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("500");
  const [discountType, setDiscountType] = useState<DiscountType>("ORDER_FIXED");
  const [discountValue, setDiscountValue] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("CASH");
  const [payAmount, setPayAmount] = useState("");
  const [paymentsLocal, setPaymentsLocal] = useState(draft?.payments ?? []);

  if (!draft) {
    return (
      <Card padding="lg" className="text-sm text-secondary-text">
        結帳草稿不存在或已失效。
      </Card>
    );
  }

  if (draft.status === "COMPLETED") {
    return (
      <Card padding="lg" className="space-y-3 text-sm">
        <p className="text-text">此結帳已完成，不可再編輯。</p>
        <Link href="/staff/transactions" className="text-primary">
          查看交易紀錄
        </Link>
      </Card>
    );
  }

  const paid = paymentsLocal.reduce((s, p) => s + p.amount, 0);
  const remaining = draft.total - paid;
  const liveDraft = getCheckoutDraft(organizationId, draftId) ?? draft;
  const primaryService = liveDraft.items.find((i) => i.type === "SERVICE");
  const usablePackages = primaryService?.referenceId
    ? listUsablePackagesForService(
        organizationId,
        liveDraft.customerId,
        primaryService.referenceId,
      )
    : [];
  const svBalance = getCustomerStoredValueBalance(organizationId, liveDraft.customerId);

  function syncPayments(
    next: Array<{ method: PaymentMethod; amount: number; reference?: string }>,
  ) {
    try {
      const updated = setCheckoutPayments(organizationId, draftId, next);
      setPaymentsLocal(updated.payments);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "付款更新失敗");
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-text">結帳</h1>
        <p className="mt-1 text-sm text-secondary-text">
          {customer?.name ?? "客戶"}
          {appointment ? ` · ${appointment.serviceName}` : null}
          <span className="ml-2">儲值可用 {formatTwd(svBalance)}</span>
        </p>
      </header>

      <div className="grid gap-4 min-[960px]:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
        <div className="space-y-4">
          <Card padding="lg" className="space-y-3">
            <h2 className="text-sm font-medium text-secondary-text">項目</h2>
            <ul className="space-y-2">
              {liveDraft.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 py-2 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-text">{item.nameSnapshot}</p>
                    <p className="text-sm text-secondary-text">
                      {item.type === "PACKAGE_PURCHASE" && item.sessionCountSnapshot
                        ? `${item.sessionCountSnapshot} 堂 · `
                        : null}
                      {item.quantity} × {formatTwd(item.unitPrice)}
                      {item.discountAmount > 0
                        ? ` · 折抵 ${formatTwd(item.discountAmount)}`
                        : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-text">{formatTwd(item.lineTotal)}</span>
                    <Button
                      variant="ghost"
                      className="min-h-11"
                      onClick={() => {
                        try {
                          removeCheckoutItem(organizationId, draftId, item.id);
                          setError("");
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "無法移除");
                        }
                      }}
                    >
                      移除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>

            {usablePackages.length > 0 && primaryService?.referenceId ? (
              <div className="rounded-2xl bg-primary-light/40 px-3 py-3">
                <p className="text-xs text-secondary-text">可用套票（完成結帳才扣堂）</p>
                <ul className="mt-2 space-y-2">
                  {usablePackages.map((pkg) => {
                    const selected =
                      liveDraft.packageRedemption?.customerPackageId === pkg.id;
                    return (
                      <li
                        key={pkg.id}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span className="text-sm text-text">
                          {pkg.nameSnapshot} · 剩餘 {pkg.usableBalance} 堂
                          {pkg.expiresAt
                            ? ` · 至 ${new Date(pkg.expiresAt).toLocaleDateString("zh-TW")}`
                            : ""}
                        </span>
                        <Button
                          className="min-h-11"
                          variant={selected ? "primary" : "secondary"}
                          onClick={() => {
                            try {
                              if (selected) {
                                setPackageRedemption(organizationId, draftId, null);
                              } else {
                                setPackageRedemption(organizationId, draftId, {
                                  customerPackageId: pkg.id,
                                  serviceId: primaryService.referenceId!,
                                  sessions: 1,
                                });
                              }
                              setPaymentsLocal(
                                getCheckoutDraft(organizationId, draftId)?.payments ?? [],
                              );
                              setError("");
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "無法套用套票");
                            }
                          }}
                        >
                          {selected ? "取消核銷" : "使用 1 堂"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-sm text-secondary-text">
                新增服務
                <select
                  className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                  defaultValue=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    try {
                      addCheckoutItem(organizationId, draftId, {
                        type: "SERVICE",
                        referenceId: id,
                        name: "",
                        unitPrice: 0,
                      });
                      e.target.value = "";
                      setError("");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "無法新增");
                    }
                  }}
                >
                  <option value="">選擇服務…</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="space-y-2">
                <label className="block text-sm text-secondary-text">
                  自訂項目
                  <input
                    className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="名稱"
                  />
                </label>
                <div className="flex gap-2">
                  <label className="flex-1 text-sm text-secondary-text">
                    金額
                    <input
                      className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
                      value={customPrice}
                      onChange={(e) => setCustomPrice(e.target.value)}
                      inputMode="numeric"
                      aria-label="自訂金額"
                    />
                  </label>
                  <Button
                    className="mt-6 min-h-11"
                    variant="secondary"
                    onClick={() => {
                      const price = parseMoneyInput(customPrice);
                      if (price == null || price < 0) {
                        setError("自訂金額須為非負整數");
                        return;
                      }
                      try {
                        addCheckoutItem(organizationId, draftId, {
                          type: "CUSTOM",
                          name: customName || "自訂項目",
                          unitPrice: price,
                          quantity: 1,
                        });
                        setCustomName("");
                        setError("");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "無法新增");
                      }
                    }}
                  >
                    新增
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          <Card padding="lg" className="space-y-3">
            <h2 className="text-sm font-medium text-secondary-text">折扣</h2>
            <div className="flex flex-wrap gap-2">
              <select
                className="min-h-11 rounded-2xl border border-border px-3 text-sm"
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                aria-label="折扣類型"
              >
                <option value="ORDER_FIXED">固定金額</option>
                <option value="ORDER_PERCENTAGE">百分比（basis points）</option>
              </select>
              <input
                className="min-h-11 w-36 rounded-2xl border border-border px-3"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === "ORDER_FIXED" ? "例如 300" : "例如 1000=10%"}
                inputMode="numeric"
                aria-label="折扣數值"
              />
              <Button
                className="min-h-11"
                variant="secondary"
                onClick={() => {
                  const value = parseMoneyInput(discountValue);
                  if (value == null) {
                    setError("折扣數值無效");
                    return;
                  }
                  try {
                    setCheckoutDiscounts(organizationId, draftId, [
                      {
                        type: discountType,
                        value,
                        label:
                          discountType === "ORDER_FIXED"
                            ? `折 ${formatTwd(value)}`
                            : `${(value / 100).toFixed(0)}% off`,
                        createdByStaffId: staffId,
                      },
                    ]);
                    setError("");
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "折扣無效");
                  }
                }}
              >
                套用折扣
              </Button>
              {liveDraft.discounts.length > 0 ? (
                <Button
                  className="min-h-11"
                  variant="ghost"
                  onClick={() => {
                    setCheckoutDiscounts(organizationId, draftId, []);
                  }}
                >
                  清除折扣
                </Button>
              ) : null}
            </div>
            {liveDraft.discounts.map((d) => (
              <p key={d.id} className="text-sm text-secondary-text">
                {d.label ?? d.type} ·{" "}
                {d.type === "ORDER_FIXED" ? formatTwd(d.value) : `${d.value} bps`}
              </p>
            ))}
          </Card>
        </div>

        <div className="space-y-4 min-[960px]:sticky min-[960px]:top-6 min-[960px]:self-start">
          <Card padding="lg" className="space-y-3">
            <h2 className="text-sm font-medium text-secondary-text">摘要</h2>
            {liveDraft.packageRedemption ? (
              <p className="text-xs text-secondary-text">已選套票核銷 1 堂（完成後入帳）</p>
            ) : null}
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-secondary-text">小計</dt>
                <dd className="tabular-nums">{formatTwd(liveDraft.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-secondary-text">折扣</dt>
                <dd className="tabular-nums">−{formatTwd(liveDraft.discountTotal)}</dd>
              </div>
              <div className="flex justify-between text-base font-semibold text-text">
                <dt>應付</dt>
                <dd className="tabular-nums">{formatTwd(liveDraft.total)}</dd>
              </div>
            </dl>
          </Card>

          <Card padding="lg" className="space-y-3">
            <h2 className="text-sm font-medium text-secondary-text">付款方式</h2>
            <p className="text-xs text-secondary-text">
              儲值金可用 {formatTwd(svBalance)}
              {liveDraft.items.some((i) => i.type === "STORED_VALUE_TOP_UP")
                ? " · 儲值單不可用儲值金付款"
                : ""}
            </p>
            <ul className="space-y-2">
              {paymentsLocal.map((p) => (
                <li key={p.id} className="flex justify-between text-sm">
                  <span>{PAYMENT_METHOD_LABEL[p.method]}</span>
                  <span className="tabular-nums">{formatTwd(p.amount)}</span>
                </li>
              ))}
            </ul>
            {liveDraft.total === 0 ? (
              <p className="text-sm text-secondary-text">應付為 0，無需額外付款列。</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <select
                  className="min-h-11 rounded-2xl border border-border px-3 text-sm"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                  aria-label="付款方式"
                >
                  {ACTIVE_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                      {m === "STORED_VALUE" ? `（${formatTwd(svBalance)}）` : ""}
                    </option>
                  ))}
                </select>
                <input
                  className="min-h-11 w-28 rounded-2xl border border-border px-3"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder={remaining > 0 ? String(remaining) : "金額"}
                  inputMode="numeric"
                  aria-label="付款金額"
                />
                <Button
                  className="min-h-11"
                  variant="secondary"
                  onClick={() => {
                    const amount =
                      parseMoneyInput(payAmount) ?? (remaining > 0 ? remaining : null);
                    if (amount == null || amount <= 0) {
                      setError("付款金額須為正整數");
                      return;
                    }
                    if (payMethod === "STORED_VALUE" && amount > svBalance) {
                      setError(`儲值金不足（可用 ${formatTwd(svBalance)}）`);
                      return;
                    }
                    syncPayments([
                      ...paymentsLocal.map((p) => ({
                        method: p.method,
                        amount: p.amount,
                        reference: p.reference,
                      })),
                      { method: payMethod, amount },
                    ]);
                    setPayAmount("");
                  }}
                >
                  加入付款
                </Button>
                {paymentsLocal.length > 0 ? (
                  <Button
                    className="min-h-11"
                    variant="ghost"
                    onClick={() => syncPayments([])}
                  >
                    清除付款
                  </Button>
                ) : null}
              </div>
            )}
            <p
              className={cn(
                "text-sm",
                remaining === 0 ? "text-secondary-text" : "text-[#B07A4A]",
              )}
            >
              剩餘 {formatTwd(Math.max(0, remaining))}
              {remaining < 0 ? ` · 溢付 ${formatTwd(-remaining)}（須恰好等於應付）` : ""}
            </p>
          </Card>

          {error ? (
            <p className="text-sm text-[#B07A4A]" role="alert">
              {error}
            </p>
          ) : null}

          <div className="sticky bottom-4 z-10 rounded-2xl border border-border bg-surface/95 p-3 shadow-sm backdrop-blur min-[960px]:static min-[960px]:border-0 min-[960px]:bg-transparent min-[960px]:p-0 min-[960px]:shadow-none">
            <div className="mb-2 flex justify-between text-sm min-[960px]:hidden">
              <span>應付</span>
              <span className="font-semibold tabular-nums">{formatTwd(liveDraft.total)}</span>
            </div>
            <Button
              fullWidth
              className="min-h-11"
              disabled={liveDraft.items.length === 0 || remaining !== 0}
              onClick={() => {
                setError("");
                try {
                  const latest = getCheckoutDraft(organizationId, draftId);
                  if (!latest) throw new Error("草稿不存在");
                  if (latest.total > 0) {
                    setCheckoutPayments(
                      organizationId,
                      draftId,
                      paymentsLocal.map((p) => ({
                        method: p.method,
                        amount: p.amount,
                        reference: p.reference,
                      })),
                    );
                  } else if (paymentsLocal.length > 0) {
                    setCheckoutPayments(organizationId, draftId, []);
                  }
                  const tx = completeCheckout(organizationId, draftId);
                  onCompleted(tx.id);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "無法完成結帳");
                }
              }}
            >
              完成結帳
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
