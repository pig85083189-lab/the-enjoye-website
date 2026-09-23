import Link from "next/link";
import { ArrowRight, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Appointment } from "@/types";
import { cn, formatReminderTag, MEMBERSHIP_LABEL } from "@/lib/utils";

interface AppointmentCardProps {
  appointment: Appointment;
}

const membershipTone = {
  vip: "vip" as const,
  regular: "neutral" as const,
  new: "new" as const,
};

function treatmentHref(appointment: Appointment) {
  return `/staff/treatments/new?customer=${appointment.customerId}&appointment=${appointment.id}`;
}

export function AppointmentCard({ appointment }: AppointmentCardProps) {
  const showActions = appointment.status !== "completed";
  const isCompleted = appointment.status === "completed";
  const isInProgress = appointment.status === "in_progress";

  return (
    <Card
      padding="none"
      className={cn(
        "overflow-hidden transition-opacity",
        isCompleted && "opacity-60",
        isInProgress &&
          "border-primary/50 shadow-[0_1px_3px_rgba(201,121,125,0.14)] ring-1 ring-primary/15",
      )}
    >
      <div
        className={cn(
          "relative flex flex-col gap-3 p-4",
          "sm:flex-row sm:items-center sm:gap-4 sm:p-4",
          isInProgress && "bg-primary-light/30",
        )}
      >
        {isInProgress ? (
          <span
            className="absolute inset-y-0 left-0 w-1 bg-primary"
            aria-hidden
          />
        ) : null}

        <div className="flex shrink-0 items-center gap-2.5 sm:w-[5.5rem] sm:flex-col sm:items-start sm:gap-1.5">
          <time
            className={cn(
              "font-display text-2xl font-medium tracking-tight text-text sm:text-[26px]",
              isCompleted && "text-secondary-text",
            )}
          >
            {appointment.time}
          </time>
          <StatusBadge status={appointment.status} />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3
              className={cn(
                "text-base font-semibold text-text sm:text-[17px]",
                isCompleted && "text-secondary-text",
              )}
            >
              {appointment.customerName}
            </h3>
            <p className="text-sm text-secondary-text">
              {appointment.serviceName}
              <span className="mx-1.5 text-border">·</span>
              {appointment.durationMinutes}分鐘
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={membershipTone[appointment.membership]}>
              {MEMBERSHIP_LABEL[appointment.membership]}
            </Badge>
            {/* Legacy seed remainingSessions is NOT canonical package balance — omit badge */}
            {appointment.notes.map((note) => (
              <span
                key={note}
                className="inline-flex items-center rounded-full border border-border bg-[#FAF7F5] px-2 py-0.5 text-[11px] font-medium text-secondary-text"
              >
                {formatReminderTag(note)}
              </span>
            ))}
          </div>
        </div>

        {showActions ? (
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-[8.25rem]">
            <Link href={treatmentHref(appointment)} className="block">
              <Button fullWidth className="min-h-11">
                {isInProgress ? "繼續服務" : "開始服務"}
              </Button>
            </Link>
            <Link href={`/staff/customers/${appointment.customerId}`} className="block">
              <Button variant="ghost" fullWidth className="min-h-10 text-sm">
                <UserRound className="h-4 w-4" aria-hidden />
                查看客戶
                <ArrowRight className="h-3.5 w-3.5 opacity-60" aria-hidden />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="hidden sm:block sm:w-[8.25rem]" aria-hidden />
        )}
      </div>
    </Card>
  );
}
