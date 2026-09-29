"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatTwd } from "@/lib/commerce/money";
import {
  formatPackageTimestamp,
} from "@/lib/packages/packages-workspace-derived";
import {
  PACKAGE_PLANS_PANEL_WIDTH_PX,
  type PackagePlanWorkspaceRow,
} from "@/lib/packages/package-plans-derived";
import { cn } from "@/lib/utils";

interface PackagePlanQuickViewProps {
  row: PackagePlanWorkspaceRow;
  canManage: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}

export function PackagePlanQuickView({
  row,
  canManage,
  onClose,
  onEdit,
  onDeactivate,
  onReactivate,
}: PackagePlanQuickViewProps) {
  const created = formatPackageTimestamp(row.createdAt);
  const updated = formatPackageTimestamp(row.updatedAt);

  return (
    <>
      <button
        type="button"
        className="fixed inset-x-0 top-0 z-30 bg-text/25 min-[1200px]:hidden bottom-[calc(3.5rem+env(safe-area-inset-bottom))]"
        aria-label="關閉套票方案摘要"
        onClick={onClose}
      />
      <aside
        data-package-plan-quickview
        data-package-plan-id={row.definitionId}
        data-package-plans-panel-width={PACKAGE_PLANS_PANEL_WIDTH_PX}
        role="dialog"
        aria-modal="true"
        aria-label={`${row.name}的套票方案`}
        className={cn(
          "z-30 flex flex-col overflow-hidden border border-border bg-surface",
          "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-h-[min(88vh,calc(100dvh-4.5rem-env(safe-area-inset-bottom)))] rounded-t-3xl shadow-[0_-4px_24px_rgba(48,43,43,0.08)]",
          "min-[1200px]:relative min-[1200px]:inset-auto min-[1200px]:z-0 min-[1200px]:h-auto min-[1200px]:max-h-[calc(100dvh-6.5rem)] min-[1200px]:w-[400px] min-[1200px]:min-w-[400px] min-[1200px]:shrink-0 min-[1200px]:rounded-2xl min-[1200px]:shadow-none",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-5 pt-3.5 pb-1">
            <p className="text-[13px] font-medium tracking-wide text-secondary-text">
              套票方案
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

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <section>
              <h2 className="text-[16px] font-semibold text-text">{row.name}</h2>
              <span
                className={cn(
                  "mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                  row.isActive
                    ? "bg-[#E7F0EA] text-[#5C7F66]"
                    : "bg-[#F1EEEC] text-[#7A7272]",
                )}
              >
                {row.statusTitle}
              </span>
              <p className="mt-3 text-[20px] font-semibold tabular-nums tracking-tight text-text">
                {formatTwd(row.priceMinor)}
              </p>
              <p className="mt-0.5 text-[13px] text-secondary-text">{row.validityLabel}</p>
              {row.description ? (
                <p className="mt-2 text-[13px] text-secondary-text">{row.description}</p>
              ) : null}
            </section>

            <section className="mt-5">
              <h3 className="text-[12px] font-medium tracking-wide text-secondary-text">
                套票內容
              </h3>
              <ul className="mt-2 space-y-1.5">
                {row.includedServiceNames.map((name, index) => (
                  <li
                    key={`${row.includedServiceIds[index] ?? name}-${index}`}
                    className="flex items-baseline justify-between gap-3 text-[14px]"
                  >
                    <span className="min-w-0 truncate text-text">{name}</span>
                    <span className="shrink-0 text-[12px] text-secondary-text">適用</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-baseline justify-between border-t border-[#EFE8E4] pt-2 text-[14px]">
                <span className="text-secondary-text">總堂數</span>
                <span className="font-medium tabular-nums text-text">
                  {row.sessionCount} 堂
                  {row.isCombination ? "（共用）" : ""}
                </span>
              </div>
            </section>

            <section className="mt-5">
              <h3 className="text-[12px] font-medium tracking-wide text-secondary-text">
                使用資訊
              </h3>
              <dl className="mt-2 space-y-1.5 text-[14px]">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-secondary-text">已售出數量</dt>
                  <dd className="tabular-nums text-text">{row.soldCount}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-secondary-text">目前有效客戶數</dt>
                  <dd className="tabular-nums text-text">{row.activeHolderCount}</dd>
                </div>
              </dl>
            </section>

            <section className="mt-5">
              <h3 className="text-[12px] font-medium tracking-wide text-secondary-text">
                紀錄
              </h3>
              <p className="mt-2 text-[12px] text-secondary-text">
                建立 {created.dateLabel} {created.timeLabel}
              </p>
              <p className="text-[12px] text-secondary-text">
                更新 {updated.dateLabel} {updated.timeLabel}
              </p>
            </section>
          </div>

          {canManage ? (
            <div className="flex shrink-0 gap-2 border-t border-border px-5 py-3">
              <Button
                data-package-plan-edit
                variant="outline"
                className="h-11 min-h-11 flex-1 rounded-2xl text-[14px]"
                onClick={onEdit}
              >
                編輯方案
              </Button>
              {row.isActive ? (
                <Button
                  data-package-plan-deactivate
                  variant="outline"
                  className="h-11 min-h-11 flex-1 rounded-2xl text-[14px]"
                  onClick={onDeactivate}
                >
                  停售方案
                </Button>
              ) : (
                <Button
                  data-package-plan-reactivate
                  className="h-11 min-h-11 flex-1 rounded-2xl text-[14px]"
                  onClick={onReactivate}
                >
                  重新上架
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
