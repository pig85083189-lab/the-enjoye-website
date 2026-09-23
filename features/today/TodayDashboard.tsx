"use client";

import { useSyncExternalStore } from "react";
import { AppointmentCard } from "@/components/appointments/AppointmentCard";
import { NextCustomerPanel } from "@/components/appointments/NextCustomerPanel";
import { StatCard } from "@/components/appointments/StatCard";
import { Avatar } from "@/components/ui/Avatar";
import { getCustomerById } from "@/data";
import { getNextAppointment, sortAppointmentsByTime } from "@/lib/appointments";
import {
  getAppointmentStatusRaw,
  getLiveAppointments,
  subscribeAppointments,
} from "@/lib/appointment-store";
import { listTodayAppointments } from "@/lib/appointments/store";
import { todayBucket } from "@/lib/appointments/domain";
import { getSessionRaw, parseSession, subscribeAuth } from "@/lib/auth";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import { useClientNow } from "@/lib/use-client-now";
import { cn, formatTodayLabel, getGreeting } from "@/lib/utils";

export function TodayDashboard() {
  const sessionRaw = useSyncExternalStore(subscribeAuth, getSessionRaw, () => null);
  const session = parseSession(sessionRaw);
  useSyncExternalStore(subscribeAppointments, getAppointmentStatusRaw, () => "");
  const { organization, membership, currentLocation } = useOrganization();
  const now = useClientNow();
  const day = now ?? new Date();
  const schedule = listTodayAppointments(organization.id, currentLocation?.id, day);
  const activeSchedule = schedule.filter((item) => todayBucket(item.status) !== "muted");
  const mutedSchedule = schedule.filter((item) => todayBucket(item.status) === "muted");
  const liveAppointments = getLiveAppointments(organization.id).filter((item) =>
    activeSchedule.some((s) => s.id === item.id),
  );
  const stats = {
    total: activeSchedule.length,
    pending: activeSchedule.filter((item) => todayBucket(item.status) === "waiting").length,
    inProgress: activeSchedule.filter((item) => todayBucket(item.status) === "active").length,
    completed: activeSchedule.filter((item) => todayBucket(item.status) === "done").length,
  };
  const appointments = sortAppointmentsByTime(liveAppointments);
  const nextAppointment = getNextAppointment(appointments);
  const nextCustomer = nextAppointment
    ? getCustomerById(nextAppointment.customerId, organization.id)
    : undefined;

  const name = membership?.displayName ?? session?.name ?? "美容師";
  const initials = session?.avatarInitials ?? name.slice(0, 1);
  const greeting = now ? getGreeting(now) : null;
  const todayLabel = now ? formatTodayLabel(now) : null;

  return (
    <div className="min-w-0">
      {/* Header */}
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">{PLATFORM_NAME}</p>
          <p className="font-display text-sm tracking-[0.14em] text-primary">
            {organization.name}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            {name}
            {greeting ? <span className="text-primary">，{greeting}</span> : null}
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

      {/* Stats */}
      <section className="mb-5 grid grid-cols-4 gap-2 sm:gap-3">
        <StatCard label="今日預約" value={stats.total} />
        <StatCard label="待服務" value={stats.pending} accent="warning" />
        <StatCard label="服務中" value={stats.inProgress} accent="primary" />
        <StatCard label="已完成" value={stats.completed} accent="success" />
      </section>

      {/* Next customer — mobile / tablet only (below stats) */}
      {nextAppointment ? (
        <section className="mb-5 min-[1200px]:hidden">
          <NextCustomerPanel appointment={nextAppointment} customer={nextCustomer} />
        </section>
      ) : null}

      {/* Main: timeline (+ desktop quick panel) */}
      <div className="min-[1200px]:grid min-[1200px]:grid-cols-[minmax(0,65fr)_minmax(0,35fr)] min-[1200px]:items-start min-[1200px]:gap-6">
        <section className="min-w-0">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-base font-semibold text-text sm:text-lg">今日預約</h2>
            <p className="text-sm text-secondary-text">{appointments.length} 筆</p>
          </div>

          <div className="relative space-y-3">
            <div
              className="absolute bottom-3 left-[0.7rem] top-3 hidden w-px bg-border sm:block"
              aria-hidden
            />
            {appointments.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-secondary-text">
                今天還沒有預約
              </p>
            ) : null}
            {appointments.map((appointment) => {
              const isInProgress = appointment.status === "in_progress";
              const isCompleted = appointment.status === "completed";

              return (
                <div key={appointment.id} className="relative sm:pl-8">
                  <span
                    className={cn(
                      "absolute left-[0.45rem] top-5 hidden h-2.5 w-2.5 rounded-full border-2 bg-surface sm:block",
                      isInProgress && "border-primary bg-primary",
                      isCompleted && "border-border bg-border",
                      !isInProgress && !isCompleted && "border-primary",
                    )}
                    aria-hidden
                  />
                  <AppointmentCard appointment={appointment} />
                </div>
              );
            })}
          </div>
          {mutedSchedule.length > 0 ? (
            <div className="mt-6 space-y-2">
              <h3 className="text-sm font-medium text-secondary-text">取消 / 未到</h3>
              {mutedSchedule.map((item) => (
                <p key={item.id} className="text-sm text-secondary-text">
                  {item.customerName} · {item.serviceName} · {item.status === "NO_SHOW" ? "未到" : "已取消"}
                </p>
              ))}
            </div>
          ) : null}
        </section>

        {/* Desktop sticky panel */}
        {nextAppointment ? (
          <aside className="hidden min-w-0 min-[1200px]:block">
            <NextCustomerPanel
              appointment={nextAppointment}
              customer={nextCustomer}
              sticky
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
