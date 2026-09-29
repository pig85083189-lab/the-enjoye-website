"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatTwd } from "@/lib/commerce/money";
import {
  SERVICE_CATALOG_PANEL_WIDTH_PX,
  type ServiceCatalogRelatedCounts,
  type ServiceCatalogWorkspaceRow,
} from "@/lib/services/service-catalog-derived";
import { cn } from "@/lib/utils";

interface ServiceQuickViewProps {
  row: ServiceCatalogWorkspaceRow;
  related: ServiceCatalogRelatedCounts;
  canManage: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}

export function ServiceQuickView({
  row,
  related,
  canManage,
  onClose,
  onEdit,
  onDeactivate,
  onReactivate,
}: ServiceQuickViewProps) {
  return (
    <>
      <button
        type="button"
        className="fixed inset-x-0 top-0 z-30 bg-text/25 min-[1200px]:hidden bottom-[calc(3.5rem+env(safe-area-inset-bottom))]"
        aria-label="關閉服務摘要"
        onClick={onClose}
      />
      <aside
        data-service-catalog-quickview
        data-service-id={row.serviceId}
        data-service-catalog-panel-width={SERVICE_CATALOG_PANEL_WIDTH_PX}
        role="dialog"
        aria-modal="true"
        aria-label={`${row.name}的服務項目`}
        className={cn(
          "z-30 flex flex-col overflow-hidden border border-border bg-surface",
          "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-h-[min(88vh,calc(100dvh-4.5rem-env(safe-area-inset-bottom)))] rounded-t-3xl shadow-[0_-4px_24px_rgba(48,43,43,0.08)]",
          "min-[1200px]:relative min-[1200px]:inset-auto min-[1200px]:z-0 min-[1200px]:h-auto min-[1200px]:max-h-[calc(100dvh-6.5rem)] min-[1200px]:w-[400px] min-[1200px]:min-w-[400px] min-[1200px]:shrink-0 min-[1200px]:rounded-2xl min-[1200px]:shadow-none",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-5 pt-3.5 pb-1">
            <p className="text-[13px] font-medium tracking-wide text-secondary-text">
              服務項目
            </p>
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary-text hover:bg-primary-light/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label="關閉"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-[16px] font-semibold text-text">{row.name}</h2>
              <span
                className={cn(
                  "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                  row.isActive
                    ? "bg-[#E7F0EA] text-[#5C7F66]"
                    : "bg-[#F1EEEC] text-[#7A7272]",
                )}
              >
                {row.statusTitle}
              </span>
            </div>
            {row.category ? (
              <p className="mt-1 text-[13px] text-secondary-text">{row.category}</p>
            ) : null}
            <p className="mt-3 text-[22px] font-semibold tabular-nums text-text">
              {formatTwd(row.priceMinor)}
            </p>
            <p className="mt-1 text-[13px] text-secondary-text">{row.durationMinutes} 分鐘</p>

            <ul className="mt-4 grid gap-1.5 text-[13px] text-text">
              <li>{row.bookable ? "✓ 可預約" : "不可預約"}</li>
              <li>{row.sellable ? "✓ 可銷售" : "不可銷售"}</li>
              <li>✓ 可加入套票</li>
            </ul>

            <section className="mt-4 rounded-2xl border border-border bg-[#FAF7F5]/70 px-3.5 py-3">
              <p className="text-[12px] text-secondary-text">相關資訊（即時推導）</p>
              <dl className="mt-2 grid gap-1.5 text-[13px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-secondary-text">預約</dt>
                  <dd className="tabular-nums text-text">{related.appointmentCount}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-secondary-text">套票</dt>
                  <dd className="tabular-nums text-text">{related.packagePlanCount}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-secondary-text">銷售</dt>
                  <dd className="tabular-nums text-text">{related.salesCount}</dd>
                </div>
              </dl>
            </section>

            <p className="mt-3 text-[12px] leading-5 text-secondary-text">
              目前服務項目適用整個 Organization
            </p>
          </div>

          {canManage ? (
            <div className="flex shrink-0 gap-2 border-t border-border px-5 py-3">
              <Button
                data-service-catalog-edit
                variant="outline"
                className="h-11 min-h-11 flex-1 rounded-2xl text-[14px]"
                onClick={onEdit}
              >
                編輯服務
              </Button>
              {row.isActive ? (
                <Button
                  data-service-catalog-deactivate
                  variant="outline"
                  className="h-11 min-h-11 flex-1 rounded-2xl text-[14px]"
                  onClick={onDeactivate}
                >
                  停售服務
                </Button>
              ) : (
                <Button
                  data-service-catalog-reactivate
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
