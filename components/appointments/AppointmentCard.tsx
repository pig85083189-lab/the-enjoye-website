"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { CanonicalAppointmentStatus } from "@/lib/appointments/domain";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import {
  getTreatmentDraftRevision,
  subscribeTreatmentDrafts,
} from "@/lib/treatment-draft";
import { resolveTodayPrimaryAction } from "@/lib/today/today-actions";
import type { Appointment } from "@/types";
import type { TreatmentDraft } from "@/types/treatment";
import { cn, formatReminderTag, MEMBERSHIP_LABEL } from "@/lib/utils";

interface AppointmentCardProps {
  appointment: Appointment;
  /** Canonical status from schedule store — preferred for checkout eligibility */
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

export function AppointmentCard({
  appointment,
  canonicalStatus,
  readOnly = false,
  treatmentRemoteRead = false,
  remoteTreatment = null,
}: AppointmentCardProps) {
  useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  useSyncExternalStore(
    subscribeTreatmentDrafts,
    () => getTreatmentDraftRevision(appointment.organizationId),
    () => "",
  );

  const isCompleted =
    remoteTreatment?.status === "completed" || appointment.status === "completed";
  const isInProgress =
    remoteTreatment?.status === "draft" ||
    (!remoteTreatment && appointment.status === "in_progress");
  const primary = resolveTodayPrimaryAction(appointment, canonicalStatus, {
    treatmentRemoteRead,
    remoteTreatment,
  });
  const customerHref = `/staff/customers/${appointment.customerId}`;

  return (
    <Card
      padding="none"
      className={cn(
        "overflow-hidden transition-opacity",
        isCompleted && "opacity-70",
        isInProgress &&
          "border-primary/40 shadow-[0_1px_3px_rgba(201,121,125,0.12)] ring-1 ring-primary/10",
      )}
    >
      <div
        className={cn(
          "relative grid gap-3 p-4",
          "sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:items-start sm:gap-x-4",
          isInProgress && "bg-primary-light/25",
        )}
      >
        {isInProgress ? (
          <span
            className="absolute inset-y-0 left-0 w-1 bg-primary"
            aria-hidden
          />
        ) : null}

        <time
          className={cn(
            "font-display text-xl font-medium tracking-tight tabular-nums text-text sm:pt-0.5 sm:text-2xl",
            isCompleted && "text-secondary-text",
          )}
        >
          {appointment.time}
        </time>

        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3
              className={cn(
                "text-base font-semibold text-text sm:text-[17px]",
                isCompleted && "text-secondary-text",
              )}
            >
              {appointment.customerName}
            </h3>
            <Badge
              tone={membershipTone[appointment.membership]}
              className="px-2 py-0.5 text-[11px] font-medium"
            >
              {MEMBERSHIP_LABEL[appointment.membership]}
            </Badge>
          </div>

          <p className="text-sm leading-snug text-secondary-text">
            <span className="line-clamp-2">
              {appointment.serviceName}
              <span className="mx-1.5 text-border">·</span>
              {appointment.durationMinutes}分鐘
            </span>
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={appointment.status} />
            {appointment.notes.map((note) => (
              <span
                key={note}
                className="inline-flex max-w-[14rem] items-center truncate rounded-full border border-border bg-[#FAF7F5] px-2 py-0.5 text-[11px] font-medium text-secondary-text"
              >
                {formatReminderTag(note)}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 sm:min-w-[7.5rem] sm:items-stretch">
          {readOnly ? null : primary.kind !== "none" ? (
            <Link href={primary.href} className="block">
              <Button fullWidth className="min-h-10 px-4 text-sm">
                {primary.label}
              </Button>
            </Link>
          ) : null}
          <Link
            href={customerHref}
            className="inline-flex min-h-9 items-center justify-center gap-1 whitespace-nowrap text-sm text-secondary-text transition-colors hover:text-primary"
          >
            客戶資料
            <ArrowRight className="h-3.5 w-3.5 opacity-70" aria-hidden />
          </Link>
        </div>
      </div>
    </Card>
  );
}
