"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { formatYmd } from "@/lib/appointments/domain";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { formatTwd } from "@/lib/commerce/money";
import {
  getFollowUpRevision,
  subscribeFollowUps,
} from "@/lib/follow-ups/store";
import { resolveReportPreset } from "@/lib/reports/date-range";
import type { ReportPreset } from "@/lib/reports/domain";
import {
  SALES_COMPOSITION_LABEL,
  getReportsWorkspaceDashboard,
  type ReportsComparison,
  type ReportsTrendPoint,
  type SalesCompositionKey,
} from "@/lib/reports/reports-workspace-derived";
import {
  getAppointmentStatusRaw,
  subscribeAppointments,
} from "@/lib/appointment-store";
import {
  getTreatmentDraftRevision,
  subscribeTreatmentDrafts,
} from "@/lib/treatment-draft";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import { useClientNow } from "@/lib/use-client-now";
import { cn } from "@/lib/utils";

const PRESETS: Array<{ id: ReportPreset; label: string }> = [
  { id: "today", label: "今天" },
  { id: "week", label: "本週" },
  { id: "month", label: "本月" },
  { id: "custom", label: "自訂" },
];

const COMPOSITION_COLOR: Record<SalesCompositionKey, string> = {
  treatment: "#C56B70",
  product: "#C4A06A",
  package: "#8A7E76",
  storedValue: "#7A8B9A",
};

type TrendSeries = "revenue" | "count";

function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "0%";
  const pct = Math.round(rate * 1000) / 10;
  return `${Number.isInteger(pct) ? String(pct) : pct.toFixed(1)}%`;
}

function ComparisonHint({
  comparison,
  suffix = "較上期",
}: {
  comparison: ReportsComparison;
  suffix?: string;
}) {
  if (comparison.kind === "hidden") return null;
  return (
    <p
      className={cn(
        "mt-1 truncate text-[10px] leading-tight whitespace-nowrap sm:text-[11px]",
        comparison.kind === "up" && "text-[#5C7F66]",
        comparison.kind === "down" && "text-[#C49A9A]",
        comparison.kind === "flat" && "text-secondary-text",
      )}
    >
      {comparison.label}
      {comparison.kind !== "flat" ? ` ${suffix}` : ""}
    </p>
  );
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
  const [customStart, setCustomStart] = useState(() => formatYmd(new Date()));
  const [customEnd, setCustomEnd] = useState(() => formatYmd(new Date()));
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [trendSeries, setTrendSeries] = useState<TrendSeries>("revenue");

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

  const dashboard = useMemo(() => {
    if (!canView) return null;
    const now = clientNow ?? new Date();
    return getReportsWorkspaceDashboard(
      {
        organizationId: organization.id,
        range,
        locationId: locationFilter === "all" ? undefined : locationFilter,
      },
      { preset, now },
    );
  }, [canView, organization.id, range, locationFilter, clientNow, preset]);

  const contextLabel = [organization.name, currentLocation?.name]
    .filter(Boolean)
    .join(" · ");

  if (!canView) {
    return (
      <div
        data-reports-workspace
        className="rounded-2xl border border-border bg-surface px-6 py-10 text-center"
      >
        <p className="text-[15px] font-medium text-text">無法檢視營運報表</p>
        <p className="mt-2 text-sm text-secondary-text">
          此模組僅供店長／會計角色使用。
        </p>
      </div>
    );
  }

  if (!dashboard) return null;

  const { kpis, trend, appointments, sales, popularTreatments, popularProducts, staff, attention } =
    dashboard;
  const compositionRows: Array<{
    key: SalesCompositionKey;
    amount: number;
  }> = [
    { key: "treatment", amount: sales.treatmentMinor },
    { key: "product", amount: sales.productMinor },
    { key: "package", amount: sales.packageMinor },
    { key: "storedValue", amount: sales.storedValueMinor },
  ];

  return (
    <div data-reports-workspace className="min-w-0 space-y-5">
      <header className="flex flex-col gap-4 min-[900px]:flex-row min-[900px]:items-start min-[900px]:justify-between">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">
            {PLATFORM_NAME}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            營運報表
          </h1>
          <p className="text-sm text-secondary-text">
            掌握門店營收、預約與營運狀況
          </p>
          {contextLabel ? (
            <p className="text-[12px] text-secondary-text/80">{contextLabel}</p>
          ) : null}
        </div>
        <div className="w-full min-w-0 min-[900px]:w-auto">
          <label
            className="mb-1.5 block text-[12px] text-secondary-text"
            htmlFor="report-location"
          >
            分店
          </label>
          <select
            id="report-location"
            aria-label="分店"
            className="min-h-11 w-full max-w-full rounded-2xl border border-border bg-surface px-3 text-sm min-[900px]:min-w-[12rem]"
            value={locationFilter}
            onChange={(event) => setLocationFilter(event.target.value)}
          >
            <option value="all">全部分店</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="flex min-w-0 flex-col gap-3">
        <div
          role="group"
          aria-label="日期區間"
          className="flex max-w-full flex-wrap gap-2"
        >
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={preset === item.id}
              onClick={() => setPreset(item.id)}
              className={cn(
                "min-h-11 rounded-2xl px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                preset === item.id
                  ? "bg-primary text-white"
                  : "border border-border bg-surface text-secondary-text hover:bg-[#FBF4F3]",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className="flex min-w-0 flex-wrap gap-3">
            <div className="min-w-0">
              <label
                className="mb-1.5 block text-[12px] text-secondary-text"
                htmlFor="report-start"
              >
                開始日期
              </label>
              <input
                id="report-start"
                type="date"
                aria-label="開始日期"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
                className="min-h-11 w-full rounded-2xl border border-border bg-surface px-3 text-sm"
              />
            </div>
            <div className="min-w-0">
              <label
                className="mb-1.5 block text-[12px] text-secondary-text"
                htmlFor="report-end"
              >
                結束日期
              </label>
              <input
                id="report-end"
                type="date"
                aria-label="結束日期"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
                className="min-h-11 w-full rounded-2xl border border-border bg-surface px-3 text-sm"
              />
            </div>
          </div>
        ) : null}
      </div>

      <section
        aria-label="營運指標"
        className="grid grid-cols-2 gap-2 min-[900px]:grid-cols-4 min-[900px]:gap-3"
      >
        <KpiCard
          primary
          label="實收營收"
          hint="外部付款收入"
          value={formatTwd(kpis.revenueMinor)}
          comparison={kpis.revenueComparison}
        />
        <KpiCard
          label="交易筆數"
          value={String(kpis.transactionCount)}
          comparison={kpis.transactionComparison}
        />
        <KpiCard
          label="平均客單"
          value={formatTwd(kpis.averageTicketMinor)}
          comparison={kpis.ticketComparison}
        />
        <KpiCard
          label="完成療程"
          value={String(kpis.completedTreatments)}
          comparison={kpis.treatmentComparison}
        />
      </section>

      <section
        data-reports-trend
        className="rounded-2xl border border-border bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(48,43,43,0.04)] sm:px-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text">營收趨勢</h2>
            <div
              role="group"
              aria-label="趨勢圖資料系列"
              className="mt-2 flex flex-wrap gap-2"
            >
              <LegendToggle
                active={trendSeries === "revenue"}
                color="#C56B70"
                label="實收營收"
                onClick={() => setTrendSeries("revenue")}
              />
              <LegendToggle
                active={trendSeries === "count"}
                color="#C4A06A"
                label="交易筆數"
                onClick={() => setTrendSeries("count")}
              />
            </div>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-[15px] font-semibold tabular-nums text-text">
              本期 {formatTwd(kpis.revenueMinor)}
            </p>
            <ComparisonHint comparison={kpis.revenueComparison} />
            <Link
              href="/staff/transactions"
              className="mt-1 inline-flex text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              查看交易 →
            </Link>
          </div>
        </div>
        <RevenueTrendChart
          points={trend}
          series={trendSeries}
          summary={`本期實收營收 ${formatTwd(kpis.revenueMinor)}，交易 ${kpis.transactionCount} 筆`}
        />
      </section>

      <section
        data-reports-appointments
        className="rounded-2xl border border-border bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(48,43,43,0.04)] sm:px-5"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-text">預約營運</h2>
          <Link
            href="/staff/calendar"
            className="text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            查看行事曆 →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 min-[820px]:grid-cols-5">
          <AppointmentStat label="預約總數" value={appointments.total} />
          <AppointmentStat
            label="完成"
            value={appointments.completed}
            rate={formatRate(appointments.completionRate)}
            tone="positive"
          />
          <AppointmentStat
            label="取消"
            value={appointments.cancelled}
            rate={formatRate(appointments.cancellationRate)}
          />
          <AppointmentStat
            label="未到"
            value={appointments.noShow}
            rate={formatRate(appointments.noShowRate)}
            tone="warning"
          />
          <AppointmentStat
            label="未完成"
            value={appointments.incomplete}
            rate={formatRate(appointments.incompleteRate)}
          />
        </div>
      </section>

      <section
        data-reports-sales
        className="rounded-2xl border border-border bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(48,43,43,0.04)] sm:px-5"
      >
        <h2 className="text-base font-semibold text-text">銷售組成</h2>
        {sales.totalExternalMinor <= 0 ? (
          <p className="py-10 text-center text-sm text-secondary-text">
            此期間尚無銷售資料
          </p>
        ) : (
          <div className="mt-4 flex min-w-0 flex-col items-center gap-6 min-[820px]:flex-row min-[820px]:items-center">
            <SalesDonut
              total={sales.totalExternalMinor}
              rows={compositionRows}
            />
            <ul className="w-full min-w-0 flex-1 space-y-2.5">
              {compositionRows.map((row) => (
                <li
                  key={row.key}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: COMPOSITION_COLOR[row.key] }}
                    />
                    <span className="text-secondary-text">
                      {SALES_COMPOSITION_LABEL[row.key]}
                    </span>
                  </span>
                  <span className="tabular-nums font-medium text-text">
                    {formatTwd(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-5 min-[1024px]:grid-cols-2">
        <section
          data-reports-treatments
          className="rounded-2xl border border-border bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(48,43,43,0.04)] sm:px-5"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-text">熱門療程</h2>
            <Link
              href="/staff/treatments"
              className="text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              查看療程 →
            </Link>
          </div>
          {popularTreatments.length === 0 ? (
            <p className="py-8 text-center text-sm text-secondary-text">
              此期間尚無完成療程
            </p>
          ) : (
            <ol className="divide-y divide-border">
              {popularTreatments.map((row) => (
                <li
                  key={row.serviceId}
                  className="flex min-w-0 items-center justify-between gap-3 py-2.5"
                >
                  <span className="min-w-0 truncate text-sm text-text">
                    {row.name}
                  </span>
                  <span className="shrink-0 text-right text-sm tabular-nums text-secondary-text">
                    {row.completedCount} 次
                    {dashboard.showTreatmentRevenue ? (
                      <span className="ml-3 font-medium text-text">
                        {row.revenueMinor == null ? "—" : formatTwd(row.revenueMinor)}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          data-reports-products
          className="rounded-2xl border border-border bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(48,43,43,0.04)] sm:px-5"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-text">熱銷商品</h2>
            <Link
              href="/staff/products"
              className="text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              查看商品 →
            </Link>
          </div>
          {popularProducts.length === 0 ? (
            <p className="py-8 text-center text-sm text-secondary-text">
              此期間尚無商品銷售
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {popularProducts.map((row) => (
                <li key={row.productId} className="min-w-0 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm text-text">{row.name}</p>
                    <p className="shrink-0 text-sm tabular-nums font-medium text-text">
                      {formatTwd(row.salesMinor)}
                    </p>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-secondary-text">
                    <span>{row.quantity} 件</span>
                    <span>庫存 {row.stock}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5",
                        row.stockKind === "low" && "bg-[#F8F1E8] text-[#C4A06A]",
                        row.stockKind === "sold_out" && "bg-[#F6EEEE] text-[#C49A9A]",
                        row.stockKind === "in_stock" && "bg-[#E7F0EA] text-[#5C7F66]",
                      )}
                    >
                      {row.stockTitle}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-5 min-[1024px]:grid-cols-2">
        <section
          data-reports-staff
          className="rounded-2xl border border-border bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(48,43,43,0.04)] sm:px-5"
        >
          <h2 className="text-base font-semibold text-text">員工營運</h2>
          {staff.length === 0 ? (
            <p className="py-8 text-center text-sm text-secondary-text">
              此期間尚無可統計資料
            </p>
          ) : (
            <>
              <div className="mt-3 hidden min-[720px]:block">
                <table className="w-full min-w-0 text-left text-sm">
                  <thead>
                    <tr className="text-[12px] text-secondary-text">
                      <th className="pb-2 font-medium">員工</th>
                      <th className="pb-2 font-medium">完成療程</th>
                      <th className="pb-2 font-medium">經手實收</th>
                      <th className="pb-2 font-medium">平均客單</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((row) => (
                      <tr key={row.staffId} className="border-t border-border">
                        <td className="py-2.5 text-text">{row.displayName}</td>
                        <td className="py-2.5 tabular-nums text-secondary-text">
                          {row.completedTreatments}
                        </td>
                        <td className="py-2.5 tabular-nums text-text">
                          {formatTwd(row.handledExternalMinor)}
                        </td>
                        <td className="py-2.5 tabular-nums text-secondary-text">
                          {formatTwd(row.averageTicketMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="mt-3 divide-y divide-border min-[720px]:hidden">
                {staff.map((row) => (
                  <li key={row.staffId} className="py-2.5">
                    <p className="text-sm font-medium text-text">{row.displayName}</p>
                    <p className="mt-1 text-[12px] text-secondary-text">
                      完成療程 {row.completedTreatments} · 經手實收{" "}
                      {formatTwd(row.handledExternalMinor)} · 平均客單{" "}
                      {formatTwd(row.averageTicketMinor)}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section
          data-reports-attention
          className="rounded-2xl border border-border bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(48,43,43,0.04)] sm:px-5"
        >
          <h2 className="text-base font-semibold text-text">需要注意</h2>
          {attention.length === 0 ? (
            <p className="py-8 text-center text-sm text-secondary-text">
              目前沒有需要立即處理的項目
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {attention.map((row) => (
                <li
                  key={row.kind}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <p className="min-w-0 text-sm text-text">{row.label}</p>
                  <Link
                    href={row.href}
                    className="shrink-0 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {row.actionLabel} →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  comparison,
  primary = false,
}: {
  label: string;
  value: string;
  hint?: string;
  comparison: ReportsComparison;
  primary?: boolean;
}) {
  return (
    <div
      data-reports-kpi={label}
      className="flex h-[100px] min-h-[92px] max-h-[108px] min-w-0 flex-col justify-center overflow-hidden rounded-2xl border border-border bg-surface px-3.5 py-2 shadow-[0_1px_1px_rgba(48,43,43,0.025)] sm:px-4"
    >
      <p className="text-[12px] leading-tight text-secondary-text">{label}</p>
      {hint ? (
        <p className="text-[10px] leading-tight text-secondary-text/80">{hint}</p>
      ) : null}
      <p
        className={cn(
          "mt-1 truncate text-[18px] font-semibold leading-none tracking-tight tabular-nums sm:text-[22px]",
          primary ? "text-[#C56B70]" : "text-text",
        )}
      >
        {value}
      </p>
      <ComparisonHint comparison={comparison} />
    </div>
  );
}

function LegendToggle({
  active,
  color,
  label,
  onClick,
}: {
  active: boolean;
  color: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "bg-[#FBF4F3] text-text" : "text-secondary-text hover:bg-[#FBF4F3]/60",
      )}
    >
      <span
        aria-hidden
        className={cn("h-2 w-2 rounded-full", !active && "opacity-40")}
        style={{ backgroundColor: color }}
      />
      {label}
    </button>
  );
}

function RevenueTrendChart({
  points,
  series,
  summary,
}: {
  points: ReportsTrendPoint[];
  series: TrendSeries;
  summary: string;
}) {
  const values = points.map((point) =>
    series === "revenue" ? point.revenueMinor : point.transactionCount,
  );
  const max = Math.max(0, ...values);
  const hasData = max > 0;

  return (
    <div className="mt-4 min-w-0">
      <p className="sr-only">{summary}</p>
      {!hasData ? (
        <p className="py-10 text-center text-sm text-secondary-text">
          此期間尚無交易資料
        </p>
      ) : (
        <div
          role="img"
          aria-label={summary}
          className="flex h-44 min-w-0 items-stretch gap-1 overflow-hidden sm:gap-1.5"
        >
          {points.map((point, index) => {
            const value =
              series === "revenue" ? point.revenueMinor : point.transactionCount;
            const height =
              value > 0 ? Math.max(6, Math.round((value / max) * 100)) : 0;
            const showLabel =
              points.length <= 10 ||
              index === 0 ||
              index === points.length - 1 ||
              index % Math.ceil(points.length / 6) === 0;
            return (
              <div
                key={point.key}
                className="flex min-w-0 flex-1 flex-col items-center"
              >
                <div className="flex w-full flex-1 items-end justify-center">
                  <div
                    className="w-full max-w-[2rem] rounded-t-md"
                    style={{
                      height: `${height}%`,
                      backgroundColor: series === "revenue" ? "#C56B70" : "#C4A06A",
                    }}
                    title={`${point.label}: ${
                      series === "revenue"
                        ? formatTwd(point.revenueMinor)
                        : `${point.transactionCount} 筆`
                    }`}
                  />
                </div>
                <span className="mt-1 h-4 text-[9px] text-secondary-text sm:text-[10px]">
                  {showLabel ? point.label : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AppointmentStat({
  label,
  value,
  rate,
  tone,
}: {
  label: string;
  value: number;
  rate?: string;
  tone?: "positive" | "warning";
}) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          "text-[22px] font-semibold tabular-nums tracking-tight",
          tone === "positive" && "text-[#5C7F66]",
          tone === "warning" && "text-[#C4A06A]",
          !tone && "text-text",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[12px] text-secondary-text">{label}</p>
      {rate ? (
        <p className="text-[11px] text-secondary-text/80">{rate}</p>
      ) : null}
    </div>
  );
}

function SalesDonut({
  total,
  rows,
}: {
  total: number;
  rows: Array<{ key: SalesCompositionKey; amount: number }>;
}) {
  const stops = rows
    .filter((row) => row.amount > 0)
    .reduce<{ parts: string[]; cursor: number }>(
      (acc, row) => {
        const start = (acc.cursor / total) * 360;
        const next = acc.cursor + row.amount;
        const end = (next / total) * 360;
        return {
          parts: [
            ...acc.parts,
            `${COMPOSITION_COLOR[row.key]} ${start}deg ${end}deg`,
          ],
          cursor: next,
        };
      },
      { parts: [], cursor: 0 },
    ).parts;
  const summary = rows
    .map((row) => `${SALES_COMPOSITION_LABEL[row.key]} ${formatTwd(row.amount)}`)
    .join("，");

  return (
    <div
      role="img"
      aria-label={`實收營收 ${formatTwd(total)}。${summary}`}
      className="relative h-[168px] w-[168px] shrink-0"
    >
      <div
        className="h-full w-full rounded-full"
        style={{
          background: `conic-gradient(${stops.join(", ")})`,
        }}
      />
      <div className="absolute inset-[28px] flex flex-col items-center justify-center rounded-full bg-surface text-center">
        <p className="text-[15px] font-semibold tabular-nums text-text">
          {formatTwd(total)}
        </p>
        <p className="text-[11px] text-secondary-text">實收營收</p>
      </div>
    </div>
  );
}
