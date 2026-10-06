"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatTwd } from "@/lib/commerce/money";
import {
  TRANSACTIONS_PANEL_WIDTH_PX,
  formatTransactionTimestamp,
  type TransactionQuickViewModel,
} from "@/lib/commerce/transactions-workspace-derived";
import { cn } from "@/lib/utils";

interface TransactionQuickViewProps {
  model: TransactionQuickViewModel;
  canVoid: boolean;
  voidBusy?: boolean;
  voidError?: string;
  onClose: () => void;
  onConfirmVoid?: (reason: string) => void;
}

export function TransactionQuickView({
  model,
  canVoid,
  voidBusy = false,
  voidError = "",
  onClose,
  onConfirmVoid,
}: TransactionQuickViewProps) {
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const completed = formatTransactionTimestamp(model.completedAt);
  const profileHref = `/staff/customers/${model.customerId}`;
  const showVoidCta =
    model.status.kind === "COMPLETED" && canVoid && Boolean(onConfirmVoid);

  function submitVoid() {
    const reason = voidReason.trim();
    if (!reason || !onConfirmVoid) return;
    onConfirmVoid(reason);
  }

  return (
    <>
      <button
        type="button"
        className="fixed inset-x-0 top-0 z-30 bg-text/25 min-[1200px]:hidden bottom-[calc(3.5rem+env(safe-area-inset-bottom))]"
        aria-label="關閉交易詳情"
        onClick={onClose}
      />
      <aside
        data-transactions-quickview
        data-transactions-panel-width={TRANSACTIONS_PANEL_WIDTH_PX}
        role="dialog"
        aria-modal="true"
        aria-label={`${model.customerName}的交易詳情`}
        className={cn(
          "z-30 flex flex-col overflow-hidden border border-border bg-surface",
          "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-h-[min(88vh,calc(100dvh-4.5rem-env(safe-area-inset-bottom)))] rounded-t-3xl shadow-[0_-4px_24px_rgba(48,43,43,0.08)]",
          "min-[1200px]:relative min-[1200px]:inset-auto min-[1200px]:z-0 min-[1200px]:h-auto min-[1200px]:max-h-[calc(100dvh-6.5rem)] min-[1200px]:w-[400px] min-[1200px]:min-w-[400px] min-[1200px]:shrink-0 min-[1200px]:rounded-2xl min-[1200px]:shadow-none",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-5 pt-3.5 pb-1">
            <p className="text-[13px] font-medium tracking-wide text-secondary-text">
              交易詳情
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
                {model.customerInitials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h2 className="truncate text-[16px] font-semibold text-text">
                    {model.customerName}
                  </h2>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      model.status.kind === "VOIDED"
                        ? "bg-[#F7E8E8] text-[#B15B5B]"
                        : "bg-[#E7F0EA] text-[#5C7F66]",
                    )}
                  >
                    {model.status.title}
                  </span>
                </div>
                {model.customerPhone ? (
                  <p className="mt-0.5 text-[13px] text-secondary-text">
                    {model.customerPhone}
                  </p>
                ) : null}
                {completed.dateLabel ? (
                  <p className="mt-0.5 text-[12px] text-secondary-text">
                    {completed.dateLabel} {completed.timeLabel}
                  </p>
                ) : null}
                <Link
                  href={profileHref}
                  className="mt-2 inline-flex min-h-9 items-center gap-1 text-[13px] font-medium text-[#C56B70]"
                >
                  查看客戶資料
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            </div>

            {model.status.kind === "VOIDED" ? (
              <div className="mb-4 rounded-2xl border border-danger/20 bg-[#F7E8E8]/40 px-3.5 py-3 text-[13px]">
                <p className="font-medium text-danger">此交易已作廢</p>
                {model.voidReason ? (
                  <p className="mt-1 text-secondary-text">原因：{model.voidReason}</p>
                ) : null}
                {model.voidedAt ? (
                  <p className="mt-1 text-secondary-text">
                    作廢時間：{formatTransactionTimestamp(model.voidedAt).dateLabel}{" "}
                    {formatTransactionTimestamp(model.voidedAt).timeLabel}
                  </p>
                ) : null}
              </div>
            ) : null}

            <section className="space-y-2.5">
              <p className="text-[12px] font-medium tracking-wide text-secondary-text">
                本次消費
              </p>
              {model.lineItems.map((line) => (
                <div
                  key={line.id}
                  data-transactions-line
                  className="flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-text">
                      {line.name}
                    </p>
                    <p className="mt-0.5 text-[12px] text-secondary-text">
                      {line.typeLabel}
                      {line.durationMinutes ? ` · ${line.durationMinutes} 分鐘` : ""}
                      {line.sessionCount ? ` · ${line.sessionCount} 堂` : ""}
                      {` ×${line.quantity}`}
                    </p>
                  </div>
                  <p className="shrink-0 text-[14px] font-medium tabular-nums text-text">
                    {formatTwd(line.lineSubtotalMinor)}
                  </p>
                </div>
              ))}
            </section>

            {model.tender.packageRedemption ? (
              <section className="mt-4 space-y-1.5" data-transactions-tender>
                <p className="text-[12px] font-medium tracking-wide text-secondary-text">
                  付款 / 抵用明細
                </p>
                <div className="rounded-xl border border-border px-3 py-2.5 text-[13px]">
                  <p className="font-medium text-text">
                    {model.tender.packageRedemption.packageName ?? "套票"}
                  </p>
                  <p className="mt-0.5 text-[12px] text-secondary-text">
                    使用 {model.tender.packageRedemption.sessions} 堂
                  </p>
                  <div className="mt-2 flex justify-between">
                    <span className="text-secondary-text">抵用價值</span>
                    <span className="tabular-nums">
                      {formatTwd(model.tender.packageRedemption.redeemedValueMinor)}
                    </span>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="mt-4 space-y-1.5 border-t border-border pt-3 text-[13px]">
              <TotalsRow label="服務金額" value={model.serviceValueMinor} />
              {model.promotionDiscountMinor > 0 ? (
                <TotalsRow label="優惠" value={-model.promotionDiscountMinor} muted />
              ) : null}
              {model.tender.packageRedemption ? (
                <TotalsRow
                  label="套票抵用"
                  value={-model.tender.packageRedemption.redeemedValueMinor}
                  muted
                />
              ) : null}
              {model.storedValueTenderMinor > 0 ? (
                <TotalsRow label="儲值金" value={-model.storedValueTenderMinor} muted />
              ) : null}
              <div className="flex items-baseline justify-between pt-1">
                <span className="text-[13px] font-semibold text-text">本次實收</span>
                <span className="text-[22px] font-semibold tabular-nums tracking-tight text-[#C56B70]">
                  {formatTwd(model.collectedMinor)}
                </span>
              </div>
            </section>

            {model.payments.length > 0 ? (
              <section className="mt-4 space-y-1.5">
                <p className="text-[12px] font-medium tracking-wide text-secondary-text">
                  付款資訊
                </p>
                {model.payments.map((payment) => (
                  <div
                    key={payment.id}
                    data-transactions-payment-row
                    data-payment-kind={payment.kind}
                    className="flex items-baseline justify-between gap-4 text-[13px]"
                  >
                    <span
                      className={
                        payment.kind === "stored_value"
                          ? "text-secondary-text"
                          : "text-text"
                      }
                    >
                      {payment.label}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums",
                        payment.kind === "stored_value"
                          ? "font-normal text-secondary-text"
                          : "font-medium text-text",
                      )}
                    >
                      {formatTwd(payment.amountMinor)}
                    </span>
                  </div>
                ))}
              </section>
            ) : null}

            <dl className="mt-5 space-y-1.5 text-[12px] text-secondary-text">
              <MetaRow label="交易編號" value={model.transactionNumber} />
              {completed.dateLabel ? (
                <MetaRow
                  label="建立時間"
                  value={`${completed.dateLabel} ${completed.timeLabel}`}
                />
              ) : null}
              {model.cashierName ? (
                <MetaRow label="結帳人員" value={model.cashierName} />
              ) : null}
              {model.beauticianName ? (
                <MetaRow label="服務美容師" value={model.beauticianName} />
              ) : null}
              {model.locationName ? (
                <MetaRow label="分店" value={model.locationName} />
              ) : null}
              <MetaRow label="狀態" value={model.status.title} />
            </dl>

            {showVoidCta ? (
              <div className="mt-6 pt-3">
                {voidOpen ? (
                  <div className="space-y-3">
                    <p className="text-[14px] font-medium text-text">確認作廢交易</p>
                    <p className="text-[12px] text-secondary-text">
                      作廢不會刪除原交易紀錄，套票與儲值會依既有帳務回沖。外部款項需店家另行處理。
                    </p>
                    <label className="block text-[12px] text-secondary-text">
                      作廢原因
                      <textarea
                        className="mt-1 min-h-20 w-full rounded-2xl border border-border bg-surface px-3 py-2 text-[13px] text-text"
                        value={voidReason}
                        onChange={(event) => setVoidReason(event.target.value)}
                        placeholder="例如：結帳付款方式選錯、重複結帳"
                      />
                    </label>
                    {voidError ? (
                      <p role="alert" className="text-[13px] text-danger">
                        {voidError}
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="h-9 min-h-9 flex-1 rounded-full text-[12px] text-[#B15B5B]"
                        disabled={voidBusy || !voidReason.trim()}
                        onClick={submitVoid}
                      >
                        {voidBusy ? "處理中…" : "確認作廢"}
                      </Button>
                      <Button
                        variant="outline"
                        className="h-9 min-h-9 rounded-full px-4 text-[12px]"
                        disabled={voidBusy}
                        onClick={() => setVoidOpen(false)}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-transactions-void
                    className="text-[12px] font-medium text-[#B15B5B]/80 underline-offset-2 hover:text-[#B15B5B] hover:underline"
                    onClick={() => setVoidOpen(true)}
                  >
                    作廢交易
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}

function TotalsRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  const negative = value < 0;
  return (
    <div className="flex items-baseline justify-between">
      <span className={muted ? "text-secondary-text" : "text-text"}>{label}</span>
      <span
        className={cn(
          "tabular-nums",
          muted || negative ? "text-secondary-text" : "text-text",
        )}
      >
        {negative ? `−${formatTwd(Math.abs(value))}` : formatTwd(value)}
      </span>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>{label}</dt>
      <dd className="text-right text-text">{value}</dd>
    </div>
  );
}
