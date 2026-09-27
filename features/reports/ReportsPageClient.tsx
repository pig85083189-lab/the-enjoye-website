"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { formatYmd } from "@/lib/appointments/domain";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { PAYMENT_METHOD_LABEL } from "@/lib/commerce/domain";
import { formatTwd } from "@/lib/commerce/money";
import {
  getFollowUpRevision,
  subscribeFollowUps,
} from "@/lib/follow-ups/store";
import { resolveReportPreset } from "@/lib/reports/date-range";
import type { ReportPreset } from "@/lib/reports/domain";
import { getOpsDashboardReport } from "@/lib/reports/summary";
import {
  getAppointmentStatusRaw,
  subscribeAppointments,
} from "@/lib/appointment-store";
import {
  getTreatmentDraftRevision,
  subscribeTreatmentDrafts,
} from "@/lib/treatment-draft";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { useClientNow } from "@/lib/use-client-now";
import { cn } from "@/lib/utils";

const PRESETS: Array<{ id: ReportPreset; label: string }> = [
  { id: "today", label: "今天" },
  { id: "week", label: "本週" },
  { id: "month", label: "本月" },
  { id: "custom", label: "自訂" },
];

function pct(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "0%";
  return `${Math.round(rate * 100)}%`;
}

export function ReportsPageClient() {
  const { organization, locations, currentLocation, membership } =
    useOrganization();
  const clientNow = useClientNow();

  useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  useSyncExternalStore(subscribeAppointments, getAppointmentStatusRaw, () => "");
  useSyncExternalStore(subscribeFollowUps, getFollowUpRevision, () => "");
  useSyncExternalStore(
    subscribeTreatmentDrafts,
    () => getTreatmentDraftRevision(organization.id),
    () => "",
  );

  const [preset, setPreset] = useState<ReportPreset>("month");
  const [customStart, setCustomStart] = useState(() =>
    formatYmd(new Date()),
  );
  const [customEnd, setCustomEnd] = useState(() => formatYmd(new Date()));
  const [locationFilter, setLocationFilter] = useState<string>("all");

  const role = membership?.role;
  const canView =
    role === "OWNER" || role === "MANAGER" || role === "ACCOUNTANT";

  const range = useMemo(() => {
    const now = clientNow ?? new Date();
    return resolveReportPreset(
      preset,
      now,
      preset === "custom"
        ? { startYmd: customStart, endYmd: customEnd }
        : undefined,
    );
  }, [preset, clientNow, customStart, customEnd]);

  const report = useMemo(() => {
    if (!canView) return null;
    const now = clientNow ?? new Date();
    return getOpsDashboardReport(
      {
        organizationId: organization.id,
        range,
        locationId: locationFilter === "all" ? undefined : locationFilter,
      },
      now,
    );
  }, [canView, organization.id, range, locationFilter, clientNow]);

  if (!canView) {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-[15px] font-medium text-text">無法檢視營運報表</p>
        <p className="mt-2 text-sm text-secondary-text">
          此模組僅供店長／會計角色使用。
        </p>
      </Card>
    );
  }

  if (!report) return null;

  const { revenue, payments, salesMix, appointments, treatments, customers, followUps, revenueByDay } =
    report;
  const maxDay = Math.max(0, ...revenueByDay.map((d) => d.revenueMinor));

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
          營運報表
        </h1>
        <p className="text-sm text-secondary-text">
          唯讀推導 · 瀏覽器本地時區 · 非正式會計報表
          {currentLocation ? ` · 目前分店 ${currentLocation.name}` : ""}
        </p>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
        <div className="flex max-w-full flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={cn(
                "min-h-11 rounded-2xl px-4 text-sm font-medium",
                preset === p.id
                  ? "bg-primary text-white"
                  : "border border-border bg-surface text-secondary-text hover:bg-primary-light/40",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="w-full max-w-full sm:w-auto">
          <label className="mb-1.5 block text-sm text-secondary-text" htmlFor="report-loc">
            分店
          </label>
          <select
            id="report-loc"
            className="min-h-11 w-full max-w-full rounded-2xl border border-border bg-surface px-3 text-sm sm:min-w-[12rem]"
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
          >
            <option value="all">全部分店</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {preset === "custom" ? (
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="mb-1.5 block text-sm text-secondary-text" htmlFor="r-start">
              開始
            </label>
            <input
              id="r-start"
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="min-h-11 rounded-2xl border border-border bg-surface px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-secondary-text" htmlFor="r-end">
              結束
            </label>
            <input
              id="r-end"
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="min-h-11 rounded-2xl border border-border bg-surface px-3 text-sm"
            />
          </div>
        </div>
      ) : null}

      {/* Overview */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-base font-semibold text-text">營運總覽</h2>
          <Link href="/staff/transactions" className="text-sm font-medium text-primary">
            查看交易
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="營收" value={formatTwd(revenue.revenueMinor)} />
          <MetricCard label="交易筆數" value={String(revenue.transactionCount)} />
          <MetricCard
            label="平均客單"
            value={formatTwd(revenue.averageTicketMinor)}
          />
          <MetricCard
            label="完成療程"
            value={String(treatments.completedCount)}
          />
        </div>
        {revenue.zeroTotalCompletedCount > 0 ? (
          <p className="text-xs text-secondary-text">
            另有 {revenue.zeroTotalCompletedCount} 筆零元完成交易（如套票核銷）未計入營收與客單。
          </p>
        ) : null}
      </section>

      {/* Revenue by day — CSS bars */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-text">每日營收</h2>
        <Card padding="md">
          {maxDay === 0 ? (
            <p className="py-8 text-center text-sm text-secondary-text">
              此期間尚無交易資料
            </p>
          ) : (
            <div className="flex h-40 items-end gap-1 overflow-x-auto sm:gap-1.5">
              {revenueByDay.map((day) => {
                const h =
                  maxDay > 0
                    ? Math.max(2, Math.round((day.revenueMinor / maxDay) * 100))
                    : 0;
                return (
                  <div
                    key={day.dateYmd}
                    className="flex min-w-[1.25rem] flex-1 flex-col items-center justify-end gap-1"
                    title={`${day.dateYmd}: ${formatTwd(day.revenueMinor)}`}
                  >
                    <div
                      className="w-full max-w-[2rem] rounded-t-md bg-primary/80"
                      style={{ height: `${h}%` }}
                    />
                    <span className="text-[9px] text-secondary-text sm:text-[10px]">
                      {day.dateYmd.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </section>

      {/* Appointments */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-base font-semibold text-text">預約</h2>
          <Link href="/staff/calendar" className="text-sm font-medium text-primary">
            查看詳細
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="預約總數" value={String(appointments.total)} hint={`完成率 ${pct(appointments.completionRate)}`} />
          <MetricCard label="完成" value={String(appointments.completed)} />
          <MetricCard label="取消" value={String(appointments.cancelled)} hint={`取消率 ${pct(appointments.cancellationRate)}`} />
          <MetricCard label="未到" value={String(appointments.noShow)} hint={`未到率 ${pct(appointments.noShowRate)}`} />
        </div>
      </section>

      {/* Sales mix */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-text">銷售組成</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MetricCard
            label="服務銷售額"
            value={formatTwd(salesMix.serviceSalesMinor)}
            hint={`${salesMix.serviceLineCount} 項服務`}
          />
          <MetricCard
            label="商品銷售額"
            value={formatTwd(salesMix.productSalesMinor)}
            hint={`${salesMix.productQuantity} 件`}
          />
        </div>
        {(salesMix.packagePurchaseMinor > 0 ||
          salesMix.storedValueTopUpMinor > 0) && (
          <p className="text-xs text-secondary-text">
            套票購買 {formatTwd(salesMix.packagePurchaseMinor)} · 儲值儲入{" "}
            {formatTwd(salesMix.storedValueTopUpMinor)}（預收／負債語意，未併入服務／商品組成）
          </p>
        )}
      </section>

      {/* Payments */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-text">付款方式</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {payments.map((row) => (
            <MetricCard
              key={row.method}
              label={PAYMENT_METHOD_LABEL[row.method] ?? row.method}
              value={formatTwd(row.amountMinor)}
            />
          ))}
        </div>
        <p className="text-xs text-secondary-text">
          儲值金為付款方式（tender），非營收來源重算。混合付款依各 payment row 分開統計。
        </p>
      </section>

      {/* CRM */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-base font-semibold text-text">客戶 / CRM</h2>
          <Link href="/staff/follow-ups" className="text-sm font-medium text-primary">
            查看追蹤
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label="消費客戶"
            value={String(customers.payingCustomerCount)}
          />
          <MetricCard label="進行中追蹤" value={String(followUps.openCount)} />
          <MetricCard label="逾期追蹤" value={String(followUps.overdueCount)} />
          <MetricCard
            label="期間完成追蹤"
            value={String(followUps.completedInRangeCount)}
            hint={`完成率 ${pct(followUps.completionRate)}`}
          />
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card padding="md" className="min-w-0">
      <p className="text-sm text-secondary-text">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-text sm:text-2xl">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-secondary-text">{hint}</p> : null}
    </Card>
  );
}
