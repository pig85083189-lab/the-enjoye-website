"use client";

import { useState, useSyncExternalStore } from "react";
import {
  CalendarDays,
  Check,
  CirclePlay,
  Clock3,
} from "lucide-react";
import { AppointmentCard } from "@/components/appointments/AppointmentCard";
import {
  NextCustomerEmpty,
  NextCustomerPanel,
} from "@/components/appointments/NextCustomerPanel";
import { StatCard } from "@/components/appointments/StatCard";
import { Avatar } from "@/components/ui/Avatar";
import { getCustomerById } from "@/data";
import { getNextAppointment, sortAppointmentsByTime } from "@/lib/appointments";
import {
  getAppointmentStatusRaw,
  scheduleAppointmentToLegacyView,
  subscribeAppointments,
} from "@/lib/appointment-store";
import { listTodayAppointments } from "@/lib/appointments/store";
import { todayBucket } from "@/lib/appointments/domain";
import { getSessionRaw, parseSession, subscribeAuth } from "@/lib/auth";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import { useClientNow } from "@/lib/use-client-now";
import { cn, formatTodayLabel, getGreeting } from "@/lib/utils";

type TimelineFilter = "all" | "waiting" | "active" | "done";

export function TodayDashboard() {
  const sessionRaw = useSyncExternalStore(subscribeAuth, getSessionRaw, () => null);
  const session = parseSession(sessionRaw);
  useSyncExternalStore(subscribeAppointments, getAppointmentStatusRaw, () => "");
  const { organization, membership, currentLocation } = useOrganization();
  const now = useClientNow();
  const day = now ?? new Date();
  const [filter, setFilter] = useState<TimelineFilter>("all");

  const schedule = listTodayAppointments(
    organization.id,
    currentLocation?.id,
    day,
  );
  const activeSchedule = schedule.filter(
    (item) => todayBucket(item.status) !== "muted",
  );
  const mutedSchedule = schedule.filter(
    (item) => todayBucket(item.status) === "muted",
  );
  const canonicalById = new Map(
    activeSchedule.map((item) => [item.id, item.status] as const),
  );

  const liveAppointments = activeSchedule.map(scheduleAppointmentToLegacyView);
  const stats = {
    total: activeSchedule.length,
    pending: activeSchedule.filter(
      (item) => todayBucket(item.status) === "waiting",
    ).length,
    inProgress: activeSchedule.filter(
      (item) => todayBucket(item.status) === "active",
    ).length,
    completed: activeSchedule.filter(
      (item) => todayBucket(item.status) === "done",
    ).length,
  };
  const appointments = sortAppointmentsByTime(liveAppointments);

  const filtered =
    filter === "all"
      ? appointments
      : appointments.filter((apt) => {
          const canonical = canonicalById.get(apt.id);
          if (!canonical) {
            if (filter === "waiting") return apt.status === "pending";
            if (filter === "active") return apt.status === "in_progress";
            return apt.status === "completed";
          }
          return todayBucket(canonical) === filter;
        });

  const nextAppointment = getNextAppointment(appointments);
  const nextCanonical = nextAppointment
    ? canonicalById.get(nextAppointment.id)
    : undefined;
  const nextCustomer = nextAppointment
    ? getCustomerById(nextAppointment.customerId, organization.id)
    : undefined;

  const name = membership?.displayName ?? session?.name ?? "美容師";
  const initials = session?.avatarInitials ?? name.slice(0, 1);
  const greeting = now ? getGreeting(now) : null;
  const todayLabel = now ? formatTodayLabel(now) : null;

  const filterPills: { id: TimelineFilter; label: string; count: number }[] = [
    { id: "all", label: "全部", count: stats.total },
    { id: "waiting", label: "待服務", count: stats.pending },
    { id: "active", label: "服務中", count: stats.inProgress },
    { id: "done", label: "已完成", count: stats.completed },
  ];

  return (
    <div className="min-w-0">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">
            {PLATFORM_NAME}
            <span className="mx-1.5 text-border">·</span>
            <span className="tracking-normal text-secondary-text">
              {organization.name}
            </span>
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            {name}
            {greeting ? (
              <span className="text-primary">，{greeting}</span>
            ) : null}
          </h1>
          <p className="text-sm text-secondary-text">
            今日共有 {stats.total} 位客人
            {todayLabel ? (
              <>
                <span className="mx-1.5 text-border">·</span>
                {todayLabel}
              </>
            ) : null}
          </p>
        </div>
        <Avatar initials={initials} name={name} className="shrink-0" />
      </header>

      <section className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard
          label="今日預約"
          value={stats.total}
          accent="default"
          icon={<CalendarDays className="h-4 w-4" strokeWidth={1.75} />}
        />
        <StatCard
          label="待服務"
          value={stats.pending}
          accent="warning"
          icon={<Clock3 className="h-4 w-4" strokeWidth={1.75} />}
        />
        <StatCard
          label="服務中"
          value={stats.inProgress}
          accent="primary"
          icon={<CirclePlay className="h-4 w-4" strokeWidth={1.75} />}
        />
        <StatCard
          label="已完成"
          value={stats.completed}
          accent="success"
          icon={<Check className="h-4 w-4" strokeWidth={2} />}
        />
      </section>

      {nextAppointment ? (
        <section className="mb-5 min-[1200px]:hidden">
          <NextCustomerPanel
            appointment={nextAppointment}
            customer={nextCustomer}
            canonicalStatus={nextCanonical}
            compact
          />
        </section>
      ) : (
        <section className="mb-5 min-[1200px]:hidden">
          <NextCustomerEmpty />
        </section>
      )}

      <div className="min-[1200px]:grid min-[1200px]:grid-cols-[minmax(0,72fr)_minmax(17rem,28fr)] min-[1200px]:items-start min-[1200px]:gap-6 xl:gap-7">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-base font-semibold text-text sm:text-lg">
              今日行程
            </h2>
          </div>

          <div
            className="mb-4 flex flex-wrap gap-1.5"
            role="tablist"
            aria-label="行程篩選"
          >
            {filterPills.map((pill) => {
              const active = filter === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(pill.id)}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                    active
                      ? "border-primary/35 bg-primary-light text-primary"
                      : "border-border bg-surface text-secondary-text hover:bg-primary-light/40",
                  )}
                >
                  {pill.label}
                  <span
                    className={cn(
                      "tabular-nums",
                      active ? "text-primary" : "text-secondary-text/80",
                    )}
                  >
                    {pill.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative space-y-3">
            <div
              className="absolute bottom-4 left-[0.7rem] top-4 hidden w-px bg-border sm:block"
              aria-hidden
            />
            {filtered.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-secondary-text">
                {appointments.length === 0
                  ? "今天還沒有預約"
                  : "此篩選沒有符合的行程"}
              </p>
            ) : null}
            {filtered.map((appointment) => {
              const isInProgress = appointment.status === "in_progress";
              const isCompleted = appointment.status === "completed";
              const canonicalStatus = canonicalById.get(appointment.id);

              return (
                <div key={appointment.id} className="relative sm:pl-8">
                  <span
                    className={cn(
                      "absolute left-[0.35rem] top-5 hidden h-3 w-3 items-center justify-center rounded-full border-2 bg-surface sm:flex",
                      isInProgress && "border-primary bg-primary",
                      isCompleted &&
                        "border-[#4F7A5C]/70 bg-[#E8F3EC] text-[#4F7A5C]",
                      !isInProgress &&
                        !isCompleted &&
                        "border-primary bg-surface",
                    )}
                    aria-hidden
                  >
                    {isCompleted ? (
                      <Check className="h-2 w-2" strokeWidth={3} />
                    ) : null}
                  </span>
                  <AppointmentCard
                    appointment={appointment}
                    canonicalStatus={canonicalStatus}
                  />
                </div>
              );
            })}
          </div>

          {mutedSchedule.length > 0 ? (
            <div className="mt-6 space-y-2">
              <h3 className="text-sm font-medium text-secondary-text">
                取消 / 未到
              </h3>
              {mutedSchedule.map((item) => (
                <p key={item.id} className="text-sm text-secondary-text">
                  {item.customerName} · {item.serviceName} ·{" "}
                  {item.status === "NO_SHOW" ? "未到" : "已取消"}
                </p>
              ))}
            </div>
          ) : null}
        </section>

        <aside className="hidden min-w-0 min-[1200px]:block">
          {nextAppointment ? (
            <NextCustomerPanel
              appointment={nextAppointment}
              customer={nextCustomer}
              sticky
              canonicalStatus={nextCanonical}
            />
          ) : (
            <NextCustomerEmpty sticky />
          )}
        </aside>
      </div>
    </div>
  );
}
