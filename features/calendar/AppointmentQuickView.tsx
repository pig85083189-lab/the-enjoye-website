"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import {
  AlertCircle,
  CalendarX,
  CircleCheck,
  Clock3,
  Pencil,
  Play,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
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
import {
  CALENDAR_ROSE_FILL,
  CALENDAR_ROSE_HOVER,
  WORKSPACE_RADIUS_CLASS,
} from "./grid-shared";

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
  const [tab, setTab] = useState<"info" | "customer">("info");

  const infoRows = [
    {
      icon: Clock3,
      label: "時間",
      value: `${formatYmd(start).replace(/-/g, "/")} ${formatHm(start)}–${formatHm(end)}`,
    },
    {
      icon: Sparkles,
      label: "服務",
      value: `${item.serviceName} · ${item.durationMinutes}分鐘`,
    },
    {
      icon: UserRound,
      label: "美容師",
      value: item.staffName,
    },
    {
      icon: CircleCheck,
      label: "狀態",
      value: STATUS_LABEL[item.status],
    },
  ];

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-text/25 min-[720px]:hidden"
        aria-label="關閉預約詳情"
        onClick={onClose}
      />
      <aside
        data-calendar-quickview
        role="dialog"
        aria-modal="true"
        aria-label="預約詳情"
        className={cn(
          "z-50 flex flex-col overflow-hidden border border-border bg-surface",
          "fixed inset-x-0 bottom-0 max-h-[88vh] rounded-t-3xl shadow-[0_-4px_24px_rgba(48,43,43,0.08)]",
          "min-[720px]:relative min-[720px]:inset-auto min-[720px]:z-0 min-[720px]:h-full min-[720px]:w-[325px] min-[720px]:max-h-none min-[720px]:shrink-0 min-[720px]:shadow-none",
          WORKSPACE_RADIUS_CLASS,
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-3.5 pb-1.5">
          <p className="text-[15px] font-semibold text-text">
            {formatHm(start)}的預約
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

        <div className="flex shrink-0 items-start gap-3 px-5 pb-2.5">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[15px] font-semibold text-primary"
            aria-hidden
          >
            {item.customerName.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="truncate text-[15px] font-semibold text-text">
                {item.customerName}
              </h2>
              <Badge
                tone={membershipTone[membership]}
                className="px-1.5 py-px text-[10px]"
              >
                {MEMBERSHIP_LABEL[membership]}
              </Badge>
            </div>
            {customer?.phone ? (
              <p className="mt-0.5 text-[12px] text-secondary-text">
                電話 {customer.phone}
              </p>
            ) : null}
            {customer && customer.totalVisits > 0 ? (
              <p className="text-[12px] text-secondary-text">
                第{customer.totalVisits}次來店
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 gap-5 border-b border-border px-5">
          {(
            [
              ["info", "預約資訊"],
              ["customer", "客戶資料"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "-mb-px border-b-2 pb-1.5 text-[13px] font-medium",
                tab === id
                  ? "border-[#C56B70] text-[#C56B70]"
                  : "border-transparent text-secondary-text hover:text-text",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3.5">
          {tab === "info" ? (
            <>
              <div className="space-y-2.5 rounded-2xl bg-[#FAF7F5] px-3.5 py-3">
                {infoRows.map((row) => {
                  const Icon = row.icon;
                  return (
                    <div key={row.label} className="flex items-start gap-2.5">
                      <Icon
                        className="mt-0.5 h-4 w-4 shrink-0 text-secondary-text"
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] text-secondary-text">
                          {row.label}
                        </p>
                        <p className="text-[13px] font-medium leading-snug text-text">
                          {row.value}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <section className="mt-3.5">
                <p className="text-[13px] font-semibold text-text">上次服務</p>
                {lastService ? (
                  <p className="mt-1 text-[13px] text-secondary-text">
                    {lastService.dateLabel}
                    {lastService.serviceName
                      ? ` · ${lastService.serviceName}`
                      : ""}
                  </p>
                ) : (
                  <p className="mt-1 text-[13px] text-secondary-text">
                    尚無服務紀錄
                  </p>
                )}
              </section>

              <section className="mt-3.5 rounded-2xl bg-[#F8F1F1] px-3.5 py-2.5">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#B15B5B]">
                  <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                  需要留意
                </p>
                {attention.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {attention.map((note) => (
                      <li
                        key={note}
                        className="flex gap-2 text-[12px] leading-relaxed text-secondary-text"
                      >
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#C9797D]" />
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-[12px] text-secondary-text">
                    目前沒有特別備註
                  </p>
                )}
              </section>
            </>
          ) : (
            <div className="space-y-3 text-[13px]">
              <p className="text-[13px] font-semibold text-text">客戶資料</p>
              <p className="text-secondary-text">
                {customer?.phone ? `電話 ${customer.phone}` : "沒有電話"}
              </p>
              <p className="text-secondary-text">
                {MEMBERSHIP_LABEL[membership]}
                {customer && customer.totalVisits > 0
                  ? ` · 第${customer.totalVisits}次來店`
                  : ""}
              </p>
              {locationName ? (
                <p className="text-secondary-text">{locationName}</p>
              ) : null}
            </div>
          )}
        </div>

        <div className="shrink-0 space-y-1.5 px-5 pt-1.5 pb-5">
          {primary.kind !== "none" ? (
            <Link
              href={primary.href}
              className={cn(
                "inline-flex h-[50px] min-h-[50px] w-full items-center justify-center gap-1.5 rounded-full text-[15px] font-medium text-white transition-colors",
                CALENDAR_ROSE_FILL,
                CALENDAR_ROSE_HOVER,
              )}
              onClick={() => {
                if (primary.kind === "start_treatment" && item.status === "ARRIVED") {
                  try {
                    onTransition("IN_SERVICE");
                  } catch {
                    /* still navigate to treatment */
                  }
                }
              }}
            >
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
              {primary.label}
            </Link>
          ) : null}
          <div className="flex gap-2">
            {canEdit ? (
              <Button
                variant="outline"
                className="h-10 min-h-10 flex-1 rounded-full text-[13px]"
                onClick={onEdit}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                編輯預約
              </Button>
            ) : null}
            {canCancel ? (
              <Button
                variant="outline"
                className="h-10 min-h-10 flex-1 rounded-full text-[13px] text-[#B15B5B]"
                onClick={onRequestCancel}
              >
                <CalendarX className="h-3.5 w-3.5" aria-hidden />
                取消預約
              </Button>
            ) : null}
          </div>
          <Link
            href={`/staff/customers/${item.customerId}`}
            className="inline-flex h-9 w-full items-center justify-center gap-1 text-[13px] font-medium text-secondary-text transition-colors hover:text-primary"
          >
            <UserRound className="h-3.5 w-3.5 opacity-70" aria-hidden />
            查看完整客戶資料 →
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
