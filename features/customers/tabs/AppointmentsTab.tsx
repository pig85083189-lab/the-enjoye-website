"use client";

import { Component, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import {
  useCustomerRemoteAppointments,
  type AppointmentRemoteReadState,
} from "@/features/customers/use-appointment-remote-read";
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
import { formatTaipeiAppointmentDisplay } from "@/lib/persistence/appointment-time";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

function AppointmentRemoteReadErrorFallback({ message }: { message: string }) {
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface px-4 py-5">
      <p className="font-medium text-text">無法讀取預約紀錄</p>
      <p className="text-[15px] text-secondary-text">{message}</p>
    </div>
  );
}

class AppointmentRemoteReadErrorBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  state: { message: string | null } = { message: null };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return {
      message: error instanceof Error ? error.message : "Remote appointment read failed",
    };
  }

  render() {
    if (this.state.message) {
      return <AppointmentRemoteReadErrorFallback message={this.state.message} />;
    }
    return this.props.children;
  }
}

function formatRemoteAppointmentDisplay(item: ScheduleAppointment): { date: string; time: string } {
  try {
    return formatTaipeiAppointmentDisplay(item.startAt, item.endAt);
  } catch (error: unknown) {
    throw new Error(
      error instanceof Error
        ? `Appointment display failed: ${error.message}`
        : "Appointment display failed",
    );
  }
}

function formatLocalDateTime(iso: string): { date: string; time: string } {
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
  display,
  showCanonicalStatus,
  showCalendarLink,
}: {
  item: ScheduleAppointment;
  open: boolean;
  onToggle: () => void;
  display: { date: string; time: string };
  showCanonicalStatus: boolean;
  showCalendarLink: boolean;
}) {
  return (
    <Card padding="md">
      <button type="button" onClick={onToggle} className="w-full min-h-11 text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-secondary-text">{display.date}</p>
            <p className="text-sm text-secondary-text">{display.time}</p>
            <p className="mt-1 font-medium text-text">{item.serviceName}</p>
            <p className="mt-1 text-sm text-text">美容師：{item.staffName}</p>
          </div>
          <span className="shrink-0 rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary">
            {showCanonicalStatus
              ? `${STATUS_LABEL[item.status]} · ${item.status}`
              : STATUS_LABEL[item.status]}
          </span>
        </div>
      </button>
      {open ? (
        <div className="mt-3 border-t border-border pt-3 text-[15px] text-secondary-text">
          <p>
            狀態：
            {showCanonicalStatus
              ? `${STATUS_LABEL[item.status]} · ${item.status}`
              : STATUS_LABEL[item.status]}
          </p>
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
          {showCalendarLink ? (
            <Link
              href="/staff/calendar"
              className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary"
            >
              在行事曆查看
            </Link>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

interface AppointmentsTabProps {
  customerId: string;
  createHref?: string;
  remoteReadPilot?: boolean;
  isolationRemoteState?: AppointmentRemoteReadState;
}

export function AppointmentSections({
  items,
  createHref,
  formatDisplay,
  showCanonicalStatus,
  showCalendarLink,
  emptyUpcoming,
  emptyHistory,
}: {
  items: ScheduleAppointment[];
  createHref?: string;
  formatDisplay: (item: ScheduleAppointment) => { date: string; time: string };
  showCanonicalStatus: boolean;
  showCalendarLink: boolean;
  emptyUpcoming: string;
  emptyHistory: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const upcoming = useMemo(
    () =>
      items
        .filter((a) => {
          const bucket = todayBucket(a.status);
          return bucket === "waiting" || bucket === "active";
        })
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [items],
  );
  const history = useMemo(
    () =>
      items
        .filter((a) => {
          const bucket = todayBucket(a.status);
          return bucket === "done" || bucket === "muted";
        })
        .sort((a, b) => b.startAt.localeCompare(a.startAt)),
    [items],
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-base font-semibold text-text">即將到來</h3>
        {upcoming.length === 0 ? (
          <div className="space-y-1">
            <p className="text-[15px] text-secondary-text">{emptyUpcoming}</p>
            {createHref ? (
              <Link href={createHref} className="inline-flex min-h-11 items-center text-sm font-medium text-primary">
                新增預約
              </Link>
            ) : null}
          </div>
        ) : (
          upcoming.map((item) => (
            <AppointmentRow
              key={item.id}
              item={item}
              open={openId === item.id}
              onToggle={() => setOpenId(openId === item.id ? null : item.id)}
              display={formatDisplay(item)}
              showCanonicalStatus={showCanonicalStatus}
              showCalendarLink={showCalendarLink}
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-text">歷史紀錄</h3>
        {history.length === 0 ? (
          <p className="text-[15px] text-secondary-text">{emptyHistory}</p>
        ) : (
          history.map((item) => (
            <AppointmentRow
              key={item.id}
              item={item}
              open={openId === item.id}
              onToggle={() => setOpenId(openId === item.id ? null : item.id)}
              display={formatDisplay(item)}
              showCanonicalStatus={showCanonicalStatus}
              showCalendarLink={showCalendarLink}
            />
          ))
        )}
      </section>
    </div>
  );
}

/** Local schedule store by default. Remote read is opt-in for the Customer 360 tab only. */
export function AppointmentsTab({
  customerId,
  createHref,
  remoteReadPilot = false,
  isolationRemoteState,
}: AppointmentsTabProps) {
  const { organization } = useOrganization();
  useSyncExternalStore(subscribeAppointments, getAppointmentStatusRaw, () => "");
  const remote = useCustomerRemoteAppointments(
    organization.id,
    customerId,
    remoteReadPilot && !isolationRemoteState,
  );
  const resolved = isolationRemoteState ?? remote;

  if (remoteReadPilot) {
    if (resolved.status === "loading") {
      return (
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded-2xl bg-primary-light/40" />
          <div className="h-24 animate-pulse rounded-2xl bg-primary-light/30" />
        </div>
      );
    }
    if (resolved.status === "error") {
      return <AppointmentRemoteReadErrorFallback message={resolved.message} />;
    }
    const items = resolved.status === "data" ? resolved.value : [];
    return (
      <AppointmentRemoteReadErrorBoundary>
        <AppointmentSections
          items={items}
          formatDisplay={formatRemoteAppointmentDisplay}
          showCanonicalStatus
          showCalendarLink={false}
          emptyUpcoming="尚無預約紀錄"
          emptyHistory="尚無預約紀錄"
        />
      </AppointmentRemoteReadErrorBoundary>
    );
  }

  const all = listAppointments({
    organizationId: organization.id,
    customerId,
  });

  return (
    <AppointmentSections
      items={all}
      createHref={createHref}
      formatDisplay={(item) => formatLocalDateTime(item.startAt)}
      showCanonicalStatus={false}
      showCalendarLink
      emptyUpcoming="尚未安排下次預約"
      emptyHistory="尚無歷史預約"
    />
  );
}
