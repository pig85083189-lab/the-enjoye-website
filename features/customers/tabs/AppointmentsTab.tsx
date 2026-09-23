"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import {
  getAppointmentStatusRaw,
  subscribeAppointments,
} from "@/lib/appointment-store";
import { listAppointments } from "@/lib/appointments/store";
import {
  STATUS_LABEL,
  formatHm,
  todayBucket,
  type ScheduleAppointment,
} from "@/lib/appointments/domain";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: "" };
  return {
    date: `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`,
    time: formatHm(d),
  };
}

function AppointmentRow({
  item,
  open,
  onToggle,
}: {
  item: ScheduleAppointment;
  open: boolean;
  onToggle: () => void;
}) {
  const { date, time } = formatDateTime(item.startAt);
  return (
    <Card padding="md">
      <button type="button" onClick={onToggle} className="w-full min-h-11 text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-secondary-text">
              {date} {time}
            </p>
            <p className="mt-1 font-medium text-text">{item.serviceName}</p>
            <p className="mt-1 text-sm text-text">美容師：{item.staffName}</p>
          </div>
          <span className="shrink-0 rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary">
            {STATUS_LABEL[item.status]}
          </span>
        </div>
      </button>
      {open ? (
        <div className="mt-3 border-t border-border pt-3 text-[15px] text-secondary-text">
          <p>狀態：{STATUS_LABEL[item.status]}</p>
          {item.customerNote || item.internalNote || (item.notes && item.notes.length > 0) ? (
            <p className="mt-1">
              備註：
              {item.customerNote ||
                item.internalNote ||
                item.notes.join("、")}
            </p>
          ) : (
            <p className="mt-1">尚無額外備註</p>
          )}
          <Link
            href="/staff/calendar"
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary"
          >
            在行事曆查看
          </Link>
        </div>
      ) : null}
    </Card>
  );
}

interface AppointmentsTabProps {
  customerId: string;
}

/** Single source of truth: schedule appointment store (Phase 4.8A). */
export function AppointmentsTab({ customerId }: AppointmentsTabProps) {
  const { organization } = useOrganization();
  useSyncExternalStore(subscribeAppointments, getAppointmentStatusRaw, () => "");
  const all = listAppointments({
    organizationId: organization.id,
    customerId,
  });
  const [openId, setOpenId] = useState<string | null>(null);

  const upcoming = useMemo(
    () =>
      all
        .filter((a) => {
          const bucket = todayBucket(a.status);
          return bucket === "waiting" || bucket === "active";
        })
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [all],
  );
  const history = useMemo(
    () =>
      all
        .filter((a) => {
          const bucket = todayBucket(a.status);
          return bucket === "done" || bucket === "muted";
        })
        .sort((a, b) => b.startAt.localeCompare(a.startAt)),
    [all],
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-base font-semibold text-text">即將到來</h3>
        {upcoming.length === 0 ? (
          <p className="text-[15px] text-secondary-text">尚無即將到來的預約</p>
        ) : (
          upcoming.map((item) => (
            <AppointmentRow
              key={item.id}
              item={item}
              open={openId === item.id}
              onToggle={() => setOpenId(openId === item.id ? null : item.id)}
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-text">歷史紀錄</h3>
        {history.length === 0 ? (
          <p className="text-[15px] text-secondary-text">尚無歷史預約</p>
        ) : (
          history.map((item) => (
            <AppointmentRow
              key={item.id}
              item={item}
              open={openId === item.id}
              onToggle={() => setOpenId(openId === item.id ? null : item.id)}
            />
          ))
        )}
      </section>
    </div>
  );
}
