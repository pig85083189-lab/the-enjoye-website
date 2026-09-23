import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Appointment, Customer } from "@/types";
import { MEMBERSHIP_LABEL } from "@/lib/utils";

interface NextCustomerPanelProps {
  appointment: Appointment;
  customer?: Customer;
  sticky?: boolean;
}

const membershipTone = {
  vip: "vip" as const,
  regular: "neutral" as const,
  new: "new" as const,
};

export function NextCustomerPanel({
  appointment,
  customer,
  sticky = false,
}: NextCustomerPanelProps) {
  const lastVisit = customer?.lastVisit;
  const lastNotes = customer?.lastServiceNotes ?? [];
  const tracking = customer?.trackingFocus ?? [];

  return (
    <Card
      padding="lg"
      className={sticky ? "sticky top-6" : undefined}
    >
      <p className="text-xs font-medium tracking-wide text-secondary-text">下一位客人</p>

      <div className="mt-3 flex items-baseline gap-3">
        <time className="font-display text-3xl font-medium tracking-tight text-text">
          {appointment.time}
        </time>
        <h2 className="text-xl font-semibold text-text">{appointment.customerName}</h2>
      </div>

      <p className="mt-2 text-[15px] text-secondary-text">
        {appointment.serviceName}
        <span className="mx-1.5 text-border">·</span>
        {appointment.durationMinutes}分鐘
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone={membershipTone[appointment.membership]}>
          {MEMBERSHIP_LABEL[appointment.membership]}
        </Badge>
      </div>

      {lastVisit ? (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-sm text-secondary-text">上次服務</p>
          <p className="mt-1 text-[15px] font-medium text-text">{lastVisit}</p>
        </div>
      ) : null}

      {lastNotes.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-text">上次服務重點</p>
          <ul className="mt-2 space-y-1">
            {lastNotes.map((note) => (
              <li key={note} className="text-[14px] leading-relaxed text-secondary-text">
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tracking.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-text">本次追蹤</p>
          <ul className="mt-2 space-y-1">
            {tracking.map((item) => (
              <li key={item} className="text-[14px] leading-relaxed text-secondary-text">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-2.5">
        <Link
          href={`/staff/treatments/new?customer=${appointment.customerId}&appointment=${appointment.id}`}
          className="block"
        >
          <Button fullWidth size="lg">
            開始服務
          </Button>
        </Link>
        <Link href={`/staff/customers/${appointment.customerId}`} className="block">
          <Button variant="outline" fullWidth>
            查看完整資料
          </Button>
        </Link>
      </div>
    </Card>
  );
}
