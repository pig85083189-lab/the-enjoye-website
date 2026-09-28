"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Crown, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { parseMoneyInput } from "@/lib/commerce/money";
import {
  PACKAGE_ADJUSTMENT_REASONS,
  PACKAGE_PANEL_WIDTH_PX,
  canScheduleFromPackage,
  formatPackageTimestamp,
  packageProgressDots,
  packageProgressLabel,
  packageRemainingLabel,
  packageScheduleHref,
  visitCountLabel,
  type PackageLedgerView,
  type PackageWorkspaceRow,
} from "@/lib/packages/packages-workspace-derived";
import { adjustPackageSessions } from "@/lib/packages/store";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types";

interface PackageQuickViewProps {
  row: PackageWorkspaceRow;
  customer: Customer | null;
  liveRemaining: number;
  ledger: PackageLedgerView[];
  canAdjust: boolean;
  organizationId: string;
  locationId: string;
  staffId: string;
  onClose: () => void;
}

const STATUS_PILL: Record<PackageWorkspaceRow["status"]["kind"], string> = {
  active: "bg-[#E7F0EA] text-[#5C7F66]",
  exhausted: "bg-[#F1EEEC] text-[#7A7272]",
  expired: "bg-[#F8EEE4] text-[#B07A4A]",
  voided: "bg-[#F1EEEC] text-[#7A7272]",
};

export function PackageQuickView({
  row,
  customer,
  liveRemaining,
  ledger,
  canAdjust,
  organizationId,
  locationId,
  staffId,
  onClose,
}: PackageQuickViewProps) {
  const [fullLedger, setFullLedger] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState<string>(
    PACKAGE_ADJUSTMENT_REASONS[0].label,
  );
  const [adjOther, setAdjOther] = useState("");
  const [error, setError] = useState("");
  const visit = visitCountLabel(customer?.totalVisits ?? 0);
  const visibleLedger = fullLedger ? [...ledger].reverse() : [...ledger].reverse().slice(0, 5);
  const purchased = formatPackageTimestamp(row.purchasedAt);
  const expires = formatPackageTimestamp(row.expiresAt);
  const dots = packageProgressDots(row.usedSessions, row.totalSessions);
  const scheduleHref = packageScheduleHref(row);
  const profileHref = `/staff/customers/${row.customerId}`;
  const canSchedule = canScheduleFromPackage(row) && liveRemaining > 0;

  function submitAdjustment() {
    const delta = parseMoneyInput(adjAmount);
    const reason = adjReason === "其他" ? adjOther.trim() : adjReason.trim();
    if (delta == null || delta === 0 || !reason) {
      setError("請輸入非零整數堂數與調整原因");
      return;
    }
    try {
      adjustPackageSessions(organizationId, {
        customerPackageId: row.customerPackageId,
        sessionDelta: delta,
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
        aria-label="關閉套票摘要"
        onClick={onClose}
      />
      <aside
        data-package-quickview
        role="dialog"
        aria-modal="true"
        aria-label={`${row.customerName}的套票`}
        className={cn(
          "z-50 flex flex-col overflow-hidden border border-border bg-surface",
          "fixed inset-x-0 bottom-0 max-h-[88vh] rounded-t-3xl shadow-[0_-4px_24px_rgba(48,43,43,0.08)]",
          "min-[1200px]:relative min-[1200px]:inset-auto min-[1200px]:z-0 min-[1200px]:h-auto min-[1200px]:max-h-[calc(100dvh-6.5rem)] min-[1200px]:w-[400px] min-[1200px]:min-w-[400px] min-[1200px]:shrink-0 min-[1200px]:shadow-none",
          "rounded-2xl",
        )}
      >
        <div
          className="flex min-h-0 flex-1 flex-col"
          data-package-panel-width={PACKAGE_PANEL_WIDTH_PX}
        >
          <div className="flex shrink-0 items-center justify-between px-5 pt-3.5 pb-1">
            <p className="text-[13px] font-medium tracking-wide text-secondary-text">
              套票
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

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <section>
              <h3 className="text-[16px] font-semibold text-text">{row.packageName}</h3>
              <span
                className={cn(
                  "mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                  STATUS_PILL[row.status.kind],
                )}
              >
                {row.status.title}
              </span>
            </section>

            <section className="mt-4 rounded-2xl bg-[#FAF7F5] px-3.5 py-3.5">
              <p className="text-[12px] text-secondary-text">使用進度</p>
              <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-tight text-text">
                {row.usedSessions} / {row.totalSessions} 堂
              </p>
              <p className="mt-1 text-[12px] text-secondary-text">
                {packageProgressLabel(row.usedSessions, row.totalSessions)}
              </p>
              <div
                className="mt-2.5 flex flex-wrap gap-1"
                aria-hidden
              >
                {Array.from({ length: dots.filled + dots.empty }).map((_, index) => (
                  <span
                    key={index}
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      index < dots.filled ? "bg-[#C56B70]" : "bg-[#E7DED9]",
                    )}
                  />
                ))}
              </div>
              <p className="mt-2 text-[13px] font-medium tabular-nums text-text">
                {packageRemainingLabel(liveRemaining)}
              </p>
            </section>

            <section className="mt-4 space-y-1.5 text-[13px]">
              <h3 className="text-[13px] font-semibold text-text">套票資訊</h3>
              <InfoRow label="購買日期" value={purchased.dateLabel || "—"} />
              <InfoRow
                label="適用服務"
                value={row.includedServiceNames.join("、") || "—"}
              />
              <InfoRow label="狀態" value={row.status.title} />
              {row.expiresAt ? (
                <InfoRow label="到期日" value={expires.dateLabel || "—"} />
              ) : null}
            </section>

            <section className="mt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-text">
                  {fullLedger ? "完整使用紀錄" : "最近使用紀錄"}
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
                <p className="mt-2 text-[13px] text-secondary-text">尚無使用紀錄</p>
              ) : (
                <ul className="mt-2 space-y-0">
                  {visibleLedger.map((item) => (
                    <LedgerRow key={item.id} item={item} />
                  ))}
                </ul>
              )}
              {!fullLedger && ledger.length > 5 ? (
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-between rounded-xl py-1 text-left text-[13px] font-medium text-text"
                  onClick={() => setFullLedger(true)}
                >
                  查看完整紀錄
                  <ChevronRight className="h-4 w-4 text-secondary-text" aria-hidden />
                </button>
              ) : null}
            </section>

            <section className="mt-4 space-y-2">
              {canSchedule ? (
                <Link href={scheduleHref}>
                  <Button className="h-[44px] min-h-[44px] w-full rounded-xl text-[13px]">
                    安排下次療程
                  </Button>
                </Link>
              ) : null}
              <Link href={profileHref}>
                <Button
                  variant={canSchedule ? "outline" : "secondary"}
                  className="h-10 min-h-10 w-full rounded-xl text-[13px]"
                >
                  查看客戶資料
                </Button>
              </Link>
              {canAdjust ? (
                <Button
                  variant="outline"
                  className="h-10 min-h-10 w-full rounded-xl text-[13px]"
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  調整套票
                </Button>
              ) : null}
              {canAdjust && moreOpen ? (
                <div className="rounded-2xl border border-border px-3 py-3">
                  <p className="text-[13px] font-medium text-text">調整堂數</p>
                  <p className="mt-0.5 text-[12px] text-secondary-text">
                    輸入差額，例如 ＋1 或 −1
                  </p>
                  <label className="mt-2 block text-[12px] text-secondary-text">
                    調整堂數
                    <input
                      className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[14px] text-text outline-none ring-primary/30 focus:ring-2"
                      value={adjAmount}
                      onChange={(event) => setAdjAmount(event.target.value)}
                      inputMode="numeric"
                      placeholder="例如 -1"
                      aria-label="調整堂數"
                    />
                  </label>
                  <fieldset className="mt-2">
                    <legend className="text-[12px] text-secondary-text">調整原因</legend>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {PACKAGE_ADJUSTMENT_REASONS.map((reason) => (
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <span className="text-secondary-text">{label}</span>
      <span className="max-w-[220px] text-right text-text">{value}</span>
    </div>
  );
}

function LedgerRow({ item }: { item: PackageLedgerView }) {
  const when = formatPackageTimestamp(item.createdAt);
  const positive = item.sessionDelta >= 0;
  return (
    <li className="border-b border-border/60 py-2.5 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text">{item.typeLabel}</p>
          <p className="mt-0.5 text-[11px] text-secondary-text">
            {when.dateLabel ? `${when.dateLabel} ${when.timeLabel}` : ""}
            {item.staffName ? ` · ${item.staffName}` : ""}
          </p>
          {item.serviceName ? (
            <p className="mt-0.5 text-[11px] text-secondary-text">{item.serviceName}</p>
          ) : null}
          {item.reason ? (
            <p className="mt-0.5 text-[11px] text-secondary-text">{item.reason}</p>
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
            {Math.abs(item.sessionDelta)} 堂
          </p>
          <p className="mt-0.5 text-[11px] tabular-nums text-secondary-text">
            餘 {item.runningBalance}
          </p>
        </div>
      </div>
    </li>
  );
}
