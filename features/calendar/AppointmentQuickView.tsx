"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ArrowRight, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { scheduleAppointmentToLegacyView } from "@/lib/appointment-store";
import {
  STATUS_LABEL,
  formatHm,
  formatYmd,
  type CanonicalAppointmentStatus,
  type ScheduleAppointment,
} from "@/lib/appointments/domain";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { getCustomerById } from "@/data/mock-customers";
import {
  collectAttentionNotes,
  lastServiceSummary,
} from "@/lib/today/briefing";
import { resolveTodayPrimaryAction } from "@/lib/today/today-actions";
import {
  getTreatmentDraftRevision,
  subscribeTreatmentDrafts,
} from "@/lib/treatment-draft";
import { cn, MEMBERSHIP_LABEL } from "@/lib/utils";

const membershipTone = {
  vip: "vip" as const,
  regular: "neutral" as const,
  new: "new" as const,
};

interface AppointmentQuickViewProps {
  item: ScheduleAppointment;
  locationName?: string;
  onClose: () => void;
  onEdit: () => void;
  onRequestCancel: () => void;
  onTransition: (status: CanonicalAppointmentStatus) => void;
}

export function AppointmentQuickView({
  item,
  locationName,
  onClose,
  onEdit,
  onRequestCancel,
  onTransition,
}: AppointmentQuickViewProps) {
  useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  useSyncExternalStore(
    subscribeTreatmentDrafts,
    () => getTreatmentDraftRevision(item.organizationId),
    () => "",
  );

  const customer = getCustomerById(item.customerId, item.organizationId);
  const legacy = scheduleAppointmentToLegacyView(item);
  const primary = resolveTodayPrimaryAction(legacy, item.status);
  const attention = collectAttentionNotes(
    item.organizationId,
    customer,
    legacy,
  );
  const lastService = lastServiceSummary(item.organizationId, customer);
  const canEdit = item.status === "BOOKED" || item.status === "CONFIRMED";
  const canCancel =
    item.status === "BOOKED" ||
    item.status === "CONFIRMED" ||
    item.status === "ARRIVED";
  const membership = item.membership ?? customer?.membership ?? "regular";
  const start = new Date(item.startAt);
  const end = new Date(item.endAt);

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-text/25 min-[1200px]:bg-transparent"
        aria-label="關閉預約詳情"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="預約詳情"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-[0_-4px_24px_rgba(48,43,43,0.08)]",
          "min-[720px]:inset-y-0 min-[720px]:left-auto min-[720px]:right-0 min-[720px]:max-h-none min-[720px]:w-[min(100%,360px)] min-[720px]:rounded-none min-[720px]:border-l min-[720px]:border-t-0 min-[720px]:shadow-[-4px_0_24px_rgba(48,43,43,0.06)]",
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-secondary-text">
              {formatHm(start)} 的預約
              {locationName ? ` · ${locationName}` : ""}
            </p>
            <h2 className="mt-1 truncate text-xl font-semibold text-text">
              {item.customerName}
            </h2>
          </div>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-2xl text-secondary-text hover:bg-primary-light/50"
            aria-label="關閉"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              tone={membershipTone[membership]}
              className="px-2 py-0.5 text-[11px]"
            >
              {MEMBERSHIP_LABEL[membership]}
            </Badge>
            {customer && customer.totalVisits > 0 ? (
              <Badge tone="neutral" className="px-2 py-0.5 text-[11px]">
                第{customer.totalVisits}次來店
              </Badge>
            ) : null}
          </div>

          {customer?.phone ? (
            <div className="mt-4">
              <p className="text-xs text-secondary-text">電話</p>
              <p className="mt-0.5 text-[15px] text-text">{customer.phone}</p>
            </div>
          ) : null}

          <section className="mt-5 border-t border-border pt-4">
            <p className="text-xs font-medium tracking-wide text-secondary-text">
              預約資訊
            </p>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-secondary-text">時間</dt>
                <dd className="mt-0.5 font-medium text-text">
                  {formatYmd(start).replace(/-/g, "/")}
                  <br />
                  {formatHm(start)} – {formatHm(end)}
                </dd>
              </div>
              <div>
                <dt className="text-secondary-text">服務</dt>
                <dd className="mt-0.5 font-medium text-text">
                  {item.serviceName} · {item.durationMinutes}分鐘
                </dd>
              </div>
              <div>
                <dt className="text-secondary-text">美容師</dt>
                <dd className="mt-0.5 font-medium text-text">{item.staffName}</dd>
              </div>
              <div>
                <dt className="text-secondary-text">狀態</dt>
                <dd className="mt-0.5 font-medium text-text">
                  {STATUS_LABEL[item.status]}
                </dd>
              </div>
            </dl>
          </section>

          <section className="mt-5 border-t border-border pt-4">
            <p className="text-xs font-medium tracking-wide text-secondary-text">
              上次服務
            </p>
            {lastService ? (
              <>
                <p className="mt-1.5 text-[15px] font-medium text-text">
                  {lastService.dateLabel}
                </p>
                {lastService.serviceName ? (
                  <p className="mt-0.5 text-sm text-secondary-text">
                    {lastService.serviceName}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-1.5 text-sm text-secondary-text">尚無服務紀錄</p>
            )}
          </section>

          <section className="mt-5 border-t border-border pt-4">
            <p className="text-xs font-medium tracking-wide text-secondary-text">
              需要留意
            </p>
            {attention.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {attention.map((note) => (
                  <li
                    key={note}
                    className="flex gap-2 text-[13px] leading-relaxed text-secondary-text"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/70" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-sm text-secondary-text">
                目前沒有特別備註
              </p>
            )}
          </section>
        </div>

        <div className="shrink-0 space-y-2 border-t border-border px-5 py-4">
          {primary.kind !== "none" ? (
            <Link
              href={primary.href}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-primary px-5 text-[15px] font-medium text-white transition-colors hover:bg-[#b9686c]"
              onClick={() => {
                // Domain only allows ARRIVED → IN_SERVICE; other statuses open treatment as-is.
                if (primary.kind === "start_treatment" && item.status === "ARRIVED") {
                  try {
                    onTransition("IN_SERVICE");
                  } catch {
                    /* still navigate to treatment */
                  }
                }
              }}
            >
              {primary.label}
            </Link>
          ) : null}
          <div className="flex gap-2">
            {canEdit ? (
              <Button
                variant="outline"
                className="min-h-11 flex-1"
                onClick={onEdit}
              >
                編輯預約
              </Button>
            ) : null}
            {canCancel ? (
              <Button
                variant="ghost"
                className="min-h-11 flex-1 text-[#B15B5B]"
                onClick={onRequestCancel}
              >
                取消預約
              </Button>
            ) : null}
          </div>
          <Link
            href={`/staff/customers/${item.customerId}`}
            className="inline-flex min-h-10 w-full items-center justify-center gap-1 text-sm font-medium text-secondary-text transition-colors hover:text-primary"
          >
            查看完整客戶資料
            <ArrowRight className="h-3.5 w-3.5 opacity-70" aria-hidden />
          </Link>
        </div>
      </aside>
    </>
  );
}

interface CancelConfirmProps {
  item: ScheduleAppointment;
  onClose: () => void;
  onConfirm: () => void;
}

export function CancelAppointmentDialog({
  item,
  onClose,
  onConfirm,
}: CancelConfirmProps) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-text/35 sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cancel-apt-title"
    >
      <button
        type="button"
        className="absolute inset-0"
        aria-label="關閉"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-t-3xl border border-border bg-surface p-6 sm:rounded-3xl">
        <h2 id="cancel-apt-title" className="text-lg font-semibold text-text">
          確定取消這筆預約？
        </h2>
        <p className="mt-3 text-[15px] font-medium text-text">{item.customerName}</p>
        <p className="mt-1 text-sm text-secondary-text">
          {formatYmd(new Date(item.startAt)).replace(/-/g, "/")}{" "}
          {formatHm(new Date(item.startAt))}
          <br />
          {item.serviceName}
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="outline" className="min-h-11 flex-1" onClick={onClose}>
            返回
          </Button>
          <Button
            className="min-h-11 flex-1 bg-[#B15B5B] hover:bg-[#9a4d4d]"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onConfirm();
            }}
          >
            確認取消
          </Button>
        </div>
      </div>
    </div>
  );
}
