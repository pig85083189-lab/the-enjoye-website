"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { CanonicalAppointmentStatus } from "@/lib/appointments/domain";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import {
  getTreatmentDraftRevision,
  subscribeTreatmentDrafts,
} from "@/lib/treatment-draft";
import {
  collectAttentionNotes,
  DEFAULT_BRIEFING_CHECKS,
  lastServiceSummary,
  resolveBriefingTiming,
} from "@/lib/today/briefing";
import { resolveTodayPrimaryAction } from "@/lib/today/today-actions";
import { useClientNow } from "@/lib/use-client-now";
import type { Appointment, Customer } from "@/types";
import type { TreatmentDraft } from "@/types/treatment";
import { cn, MEMBERSHIP_LABEL } from "@/lib/utils";

interface NextCustomerPanelProps {
  appointment: Appointment;
  customer?: Customer;
  sticky?: boolean;
  compact?: boolean;
  canonicalStatus?: CanonicalAppointmentStatus;
  readOnly?: boolean;
  treatmentRemoteRead?: boolean;
  remoteTreatment?: TreatmentDraft | null;
}

const membershipTone = {
  vip: "vip" as const,
  regular: "neutral" as const,
  new: "new" as const,
};

function BriefingChecklist() {
  const [checks, setChecks] = useState<Record<string, boolean>>({});

  return (
    <ul className="mt-2.5 space-y-2">
      {DEFAULT_BRIEFING_CHECKS.map((label) => {
        const checked = Boolean(checks[label]);
        return (
          <li key={label}>
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed text-text">
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  setChecks((prev) => ({ ...prev, [label]: !prev[label] }))
                }
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
              />
              <span
                className={cn(checked && "text-secondary-text line-through")}
              >
                {label}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export function NextCustomerPanel({
  appointment,
  customer,
  sticky = false,
  compact = false,
  canonicalStatus,
  readOnly = false,
  treatmentRemoteRead = false,
  remoteTreatment = null,
}: NextCustomerPanelProps) {
  useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  useSyncExternalStore(
    subscribeTreatmentDrafts,
    () => getTreatmentDraftRevision(appointment.organizationId),
    () => "",
  );
  const now = useClientNow();
  const day = now ?? new Date();
  const timing = resolveBriefingTiming(appointment, day);
  const attention = collectAttentionNotes(
    appointment.organizationId,
    customer,
    appointment,
  );
  const lastService = lastServiceSummary(
    appointment.organizationId,
    customer,
  );
  const primary = resolveTodayPrimaryAction(appointment, canonicalStatus, {
    treatmentRemoteRead,
    remoteTreatment,
  });
  const customerHref = `/staff/customers/${appointment.customerId}`;
  const treatmentsHref = `/staff/customers/${appointment.customerId}?tab=treatments`;

  return (
    <Card
      padding={compact ? "md" : "lg"}
      className={cn(sticky && "sticky top-6")}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-secondary-text">
          下一位客人
        </p>
        <p
          className={cn(
            "shrink-0 text-xs font-medium",
            timing.kind === "later" && "text-primary",
            timing.kind === "waiting" && "text-[#B07A4A]",
            timing.kind === "in_service" && "text-primary",
            timing.kind === "done" && "text-secondary-text",
          )}
        >
          {timing.label}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <time className="font-display text-2xl font-medium tracking-tight tabular-nums text-text sm:text-3xl">
          {appointment.time}
        </time>
        <h2 className="text-lg font-semibold text-text sm:text-xl">
          {appointment.customerName}
        </h2>
      </div>

      <p className="mt-1.5 text-sm text-secondary-text">
        {appointment.serviceName}
        <span className="mx-1.5 text-border">·</span>
        {appointment.durationMinutes}分鐘
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge
          tone={membershipTone[appointment.membership]}
          className="px-2 py-0.5 text-[11px]"
        >
          {MEMBERSHIP_LABEL[appointment.membership]}
        </Badge>
        {customer && customer.totalVisits > 0 ? (
          <Badge tone="neutral" className="px-2 py-0.5 text-[11px]">
            第{customer.totalVisits}次來店
          </Badge>
        ) : null}
      </div>

      {!compact ? (
        <>
          <div className="mt-5 border-t border-border pt-4">
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
          </div>

          <div className="mt-4 border-t border-border pt-4">
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
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <p className="text-xs font-medium tracking-wide text-secondary-text">
              本次建議確認
            </p>
            <BriefingChecklist key={appointment.id} />
          </div>
        </>
      ) : (
        <div className="mt-4 border-t border-border pt-3">
          {attention.length > 0 ? (
            <p className="line-clamp-2 text-[13px] text-secondary-text">
              留意：{attention.slice(0, 2).join(" · ")}
            </p>
          ) : (
            <p className="text-[13px] text-secondary-text">目前沒有特別備註</p>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
        {readOnly ? null : primary.kind !== "none" ? (
          <Link
            href={primary.href}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-primary px-5 text-[15px] font-medium text-white transition-colors hover:bg-[#b9686c]"
          >
            {primary.label}
          </Link>
        ) : null}
        <Link
          href={customerHref}
          className="inline-flex min-h-10 items-center justify-center gap-1 text-sm font-medium text-secondary-text transition-colors hover:text-primary"
        >
          查看完整客戶資料
          <ArrowRight className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </Link>
        <Link
          href={treatmentsHref}
          className="inline-flex min-h-10 items-center justify-center gap-1 text-sm font-medium text-secondary-text transition-colors hover:text-primary"
        >
          歷次療程紀錄
          <ArrowRight className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </Link>
      </div>
    </Card>
  );
}

export function NextCustomerEmpty({ sticky = false }: { sticky?: boolean }) {
  return (
    <Card
      padding="lg"
      className={cn(
        "border-dashed",
        sticky && "sticky top-6",
      )}
    >
      <p className="text-xs font-medium tracking-wide text-secondary-text">
        下一位客人
      </p>
      <p className="mt-3 text-[15px] font-medium text-text">目前沒有待服務客人</p>
      <p className="mt-1 text-sm text-secondary-text">
        今日行程已完成，或尚無預約。
      </p>
    </Card>
  );
}
