"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Crown, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatTwd, parseMoneyInput } from "@/lib/commerce/money";
import {
  STORED_VALUE_ADJUSTMENT_REASONS,
  STORED_VALUE_PANEL_WIDTH_PX,
  formatStoredValueTimestamp,
  visitCountLabel,
  type StoredValueLedgerView,
  type StoredValueWorkspaceRow,
} from "@/lib/stored-value/stored-value-workspace-derived";
import { adjustStoredValue } from "@/lib/stored-value/store";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types";

interface StoredValueQuickViewProps {
  row: StoredValueWorkspaceRow;
  customer: Customer | null;
  liveBalanceMinor: number;
  ledger: StoredValueLedgerView[];
  canAdjust: boolean;
  organizationId: string;
  locationId: string;
  staffId: string;
  onClose: () => void;
  onTopUp: () => void;
}

export function StoredValueQuickView({
  row,
  customer,
  liveBalanceMinor,
  ledger,
  canAdjust,
  organizationId,
  locationId,
  staffId,
  onClose,
  onTopUp,
}: StoredValueQuickViewProps) {
  const [fullLedger, setFullLedger] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState<string>(
    STORED_VALUE_ADJUSTMENT_REASONS[0].label,
  );
  const [adjOther, setAdjOther] = useState("");
  const [error, setError] = useState("");
  const visit = visitCountLabel(customer?.totalVisits ?? row.totalVisits);
  const visibleLedger = fullLedger ? [...ledger].reverse() : [...ledger].reverse().slice(0, 5);
  const profileHref = `/staff/customers/${row.customerId}`;
  const walletHref = `${profileHref}?tab=wallet`;

  function submitAdjustment() {
    const delta = parseMoneyInput(adjAmount);
    const reason =
      adjReason === "其他" ? adjOther.trim() : adjReason.trim();
    if (delta == null || delta === 0 || !reason) {
      setError("請輸入非零整數金額與調整原因");
      return;
    }
    try {
      adjustStoredValue(organizationId, {
        customerId: row.customerId,
        amountDelta: delta,
        reason,
        locationId: locationId || undefined,
        createdByStaffId: staffId,
      });
      setAdjAmount("");
      setAdjOther("");
      setError("");
      setMoreOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "調整失敗");
    }
  }

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-text/25 min-[1200px]:hidden"
        aria-label="關閉儲值摘要"
        onClick={onClose}
      />
      <aside
        data-stored-value-quickview
        role="dialog"
        aria-modal="true"
        aria-label={`${row.customerName}的儲值`}
        className={cn(
          "z-50 flex flex-col overflow-hidden border border-border bg-surface",
          "fixed inset-x-0 bottom-0 max-h-[88vh] rounded-t-3xl shadow-[0_-4px_24px_rgba(48,43,43,0.08)]",
          "min-[1200px]:relative min-[1200px]:inset-auto min-[1200px]:z-0 min-[1200px]:h-auto min-[1200px]:max-h-[calc(100dvh-6.5rem)] min-[1200px]:w-[400px] min-[1200px]:min-w-[400px] min-[1200px]:shrink-0 min-[1200px]:shadow-none",
          "rounded-2xl",
        )}
      >
        <div
          className="flex min-h-0 flex-1 flex-col"
          data-stored-value-panel-width={STORED_VALUE_PANEL_WIDTH_PX}
        >
          <div className="flex shrink-0 items-center justify-between px-5 pt-3.5 pb-1">
            <p className="text-[13px] font-medium tracking-wide text-secondary-text">
              儲值
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

          <div className="flex shrink-0 items-start gap-3 px-5 pb-3">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[15px] font-semibold text-primary"
              aria-hidden
            >
              {row.customerInitials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="whitespace-nowrap text-[15px] font-semibold text-text">
                  {row.customerName}
                </h2>
                {row.membership ? (
                  <Badge
                    tone={row.membership.id === "vip" ? "vip" : "new"}
                    className="px-1.5 py-px text-[10px]"
                  >
                    {row.membership.id === "vip" ? (
                      <Crown className="mr-0.5 h-2.5 w-2.5" aria-hidden />
                    ) : null}
                    {row.membership.label}
                  </Badge>
                ) : null}
              </div>
              {row.customerPhone ? (
                <p className="mt-0.5 whitespace-nowrap text-[12px] text-secondary-text">
                  {row.customerPhone}
                </p>
              ) : null}
              {visit ? (
                <p className="text-[12px] text-secondary-text">{visit}</p>
              ) : null}
            </div>
          </div>

          <div className="px-5 pb-3">
            <Link href={profileHref}>
              <Button variant="secondary" className="h-10 min-h-10 w-full rounded-xl text-[13px]">
                查看客戶資料
              </Button>
            </Link>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <section className="rounded-2xl bg-[#FAF7F5] px-3.5 py-3.5">
              <p className="text-[12px] text-secondary-text">可用餘額</p>
              <p className="mt-1 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-text">
                {formatTwd(liveBalanceMinor)}
              </p>
            </section>

            <section className="mt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-text">
                  {fullLedger ? "完整儲值紀錄" : "最近異動"}
                </h3>
                {fullLedger ? (
                  <button
                    type="button"
                    className="text-[12px] text-primary"
                    onClick={() => setFullLedger(false)}
                  >
                    顯示最近
                  </button>
                ) : null}
              </div>
              {visibleLedger.length === 0 ? (
                <p className="mt-2 text-[13px] text-secondary-text">尚無儲值紀錄</p>
              ) : (
                <ul className="mt-2 space-y-0">
                  {visibleLedger.map((item) => (
                    <LedgerRow key={item.id} item={item} />
                  ))}
                </ul>
              )}
              {!fullLedger ? (
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-between rounded-xl py-1 text-left text-[13px] font-medium text-text"
                  onClick={() => setFullLedger(true)}
                >
                  查看完整儲值紀錄
                  <ChevronRight className="h-4 w-4 text-secondary-text" aria-hidden />
                </button>
              ) : (
                <Link
                  href={walletHref}
                  className="mt-3 flex items-center justify-between text-[12px] text-secondary-text"
                >
                  在客戶錢包查看
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )}
            </section>

            <section className="mt-4 space-y-2">
              <Button className="h-[44px] min-h-[44px] w-full rounded-xl text-[13px]" onClick={onTopUp}>
                新增儲值
              </Button>
              {canAdjust ? (
                <Button
                  variant="outline"
                  className="h-10 min-h-10 w-full rounded-xl text-[13px]"
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  更多操作
                </Button>
              ) : null}
              {canAdjust && moreOpen ? (
                <div className="rounded-2xl border border-border px-3 py-3">
                  <p className="text-[13px] font-medium text-text">調整餘額</p>
                  <p className="mt-0.5 text-[12px] text-secondary-text">
                    輸入差額，例如 ＋500 或 −500
                  </p>
                  <label className="mt-2 block text-[12px] text-secondary-text">
                    調整金額
                    <input
                      className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[14px] text-text outline-none ring-primary/30 focus:ring-2"
                      value={adjAmount}
                      onChange={(event) => setAdjAmount(event.target.value)}
                      inputMode="numeric"
                      placeholder="例如 -500"
                      aria-label="調整金額"
                    />
                  </label>
                  <fieldset className="mt-2">
                    <legend className="text-[12px] text-secondary-text">調整原因</legend>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {STORED_VALUE_ADJUSTMENT_REASONS.map((reason) => (
                        <button
                          key={reason.id}
                          type="button"
                          onClick={() => setAdjReason(reason.label)}
                          className={cn(
                            "h-8 rounded-full px-3 text-[12px] font-medium",
                            adjReason === reason.label
                              ? "bg-primary text-white"
                              : "bg-[#F6F1EE] text-text",
                          )}
                        >
                          {reason.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  {adjReason === "其他" ? (
                    <input
                      className="mt-2 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[14px]"
                      value={adjOther}
                      onChange={(event) => setAdjOther(event.target.value)}
                      placeholder="請輸入原因"
                      aria-label="其他調整原因"
                    />
                  ) : null}
                  <Button
                    variant="outline"
                    className="mt-3 h-10 min-h-10 w-full rounded-xl text-[13px]"
                    onClick={submitAdjustment}
                  >
                    確認調整
                  </Button>
                </div>
              ) : null}
              {error ? (
                <p className="text-sm text-[#B07A4A]" role="alert">
                  {error}
                </p>
              ) : null}
            </section>
          </div>
        </div>
      </aside>
    </>
  );
}

function LedgerRow({ item }: { item: StoredValueLedgerView }) {
  const when = formatStoredValueTimestamp(item.createdAt);
  const positive = item.amountDelta >= 0;
  return (
    <li className="border-b border-border/60 py-2.5 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text">{item.typeLabel}</p>
          <p className="mt-0.5 text-[11px] text-secondary-text">
            {when.dateLabel ? `${when.dateLabel} ${when.timeLabel}` : ""}
            {item.staffName ? ` · ${item.staffName}` : ""}
          </p>
          {item.reason ? (
            <p className="mt-0.5 text-[11px] text-secondary-text">{item.reason}</p>
          ) : null}
          {item.transactionId ? (
            <Link
              href={`/staff/transactions?id=${item.transactionId}`}
              className="mt-0.5 inline-block text-[11px] text-primary"
            >
              關聯交易
            </Link>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p
            className={cn(
              "text-[13px] font-semibold tabular-nums",
              positive ? "text-[#5C7F66]" : "text-[#C56B70]",
            )}
          >
            {positive ? "+" : "−"}
            {formatTwd(Math.abs(item.amountDelta))}
          </p>
          <p className="mt-0.5 text-[11px] tabular-nums text-secondary-text">
            餘額 {formatTwd(item.runningBalanceMinor)}
          </p>
        </div>
      </div>
    </li>
  );
}
