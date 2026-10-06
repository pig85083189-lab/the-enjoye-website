"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { OrgLocationSwitcher } from "@/components/navigation/OrgLocationSwitcher";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatTwd } from "@/lib/commerce/money";
import {
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_DELTA_PENDING_MESSAGE,
  EXPENSE_LEDGER_UNAVAILABLE_MESSAGE,
  type Expense,
  type ExpenseRemoteAvailability,
  type FinancePeriodKind,
} from "@/lib/finance/domain";
import {
  buildExpenseCategorySlices,
  buildFinanceTrend,
  compareMinor,
  filterCompletedInScope,
  formatSharePercent,
  shareOf,
  sumFinanceTotals,
  type FinanceComparison,
} from "@/lib/finance/derived";
import {
  formatPeriodHeading,
  resolveFinancePeriod,
  shiftPeriod,
  taipeiYmdFromInstant,
} from "@/lib/finance/period";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { listMemberships } from "@/lib/tenant/organization-store";
import { canCreateExpense } from "@/lib/staff-auth/operational-capabilities";
import { cn } from "@/lib/utils";
import { FinanceDonut, FinanceTrendChart } from "./FinanceCharts";
import { financeRemoteRows, useFinanceRemote } from "./use-finance-remote";

const PERIODS: Array<{ id: FinancePeriodKind; label: string }> = [
  { id: "day", label: "日" },
  { id: "week", label: "週" },
  { id: "month", label: "月" },
  { id: "custom", label: "自訂" },
];

const FINANCE_TABS = [
  { href: "/staff/finance", label: "營運總覽" },
  { href: "/staff/finance/income", label: "收入" },
  { href: "/staff/finance/expenses", label: "支出" },
  { href: "/staff/finance/reports", label: "月報表" },
] as const;

function comparisonClass(kind: FinanceComparison["kind"]): string {
  if (kind === "up") return "text-[#5C7F66]";
  if (kind === "down") return "text-[#C49A9A]";
  return "text-secondary-text";
}

export function FinanceWorkspace({
  financeRemoteReadPilot,
  expenseRemoteWritePilot,
  children,
  title,
  description,
}: {
  financeRemoteReadPilot: boolean;
  expenseRemoteWritePilot: boolean;
  children: (ctx: FinanceWorkspaceContext) => ReactNode;
  title: string;
  description: string;
}) {
  const pathname = usePathname();
  const { organization, currentLocation, membership } = useOrganization();
  const nowYmd = taipeiYmdFromInstant(new Date());
  const [kind, setKind] = useState<FinancePeriodKind>("month");
  const [anchorYmd, setAnchorYmd] = useState(nowYmd);
  const [customStart, setCustomStart] = useState(nowYmd.slice(0, 8) + "01");
  const [customEnd, setCustomEnd] = useState(nowYmd);
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const range = useMemo(
    () =>
      resolveFinancePeriod(kind, anchorYmd, {
        startYmd: customStart,
        endYmd: customEnd,
      }),
    [kind, anchorYmd, customStart, customEnd],
  );
  const previousRange = useMemo(() => {
    const current = resolveFinancePeriod(kind, anchorYmd, {
      startYmd: customStart,
      endYmd: customEnd,
    });
    return shiftPeriod(kind === "custom" ? "day" : kind, current, -1);
  }, [kind, anchorYmd, customStart, customEnd]);

  const remote = useFinanceRemote({
    organizationId: organization.id,
    locationId: currentLocation?.id ?? "",
    enabled: financeRemoteReadPilot && Boolean(currentLocation?.id),
    refreshEpoch,
  });
  const rows = financeRemoteRows(remote);
  const expenseAvailability = rows.expenseAvailability;
  const scoped = filterCompletedInScope({
    transactions: rows.transactions,
    expenses: rows.expenses,
    organizationId: organization.id,
    locationId: currentLocation?.id ?? "",
    range,
  });
  const previous = filterCompletedInScope({
    transactions: rows.transactions,
    expenses: rows.expenses,
    organizationId: organization.id,
    locationId: currentLocation?.id ?? "",
    range: previousRange,
  });
  const totals = sumFinanceTotals(scoped.metrics, scoped.expenses);
  const previousTotals = sumFinanceTotals(previous.metrics, previous.expenses);
  const trend = buildFinanceTrend(range, scoped.metrics, scoped.expenses);
  const expenseSlices = buildExpenseCategorySlices(scoped.expenses);
  const staffNameById = useMemo(() => {
    const names: Record<string, string> = {};
    for (const row of listMemberships(organization.id)) {
      names[row.userId] = row.displayName;
    }
    return names;
  }, [organization.id]);
  const canCreate =
    expenseRemoteWritePilot &&
    expenseAvailability === "ready" &&
    canCreateExpense({
      role: membership?.role,
      isActive: membership?.isActive,
    });

  return (
    <div
      className="space-y-5 overflow-x-hidden"
      data-finance-workspace
      data-finance-source={financeRemoteReadPilot ? "remote-pilot" : "off"}
      data-expense-ledger={expenseAvailability}
      data-finance-location={currentLocation?.id ?? ""}
      data-finance-range-start={range.startYmd}
      data-finance-range-end={range.endYmd}
      data-finance-tx-count={scoped.metrics.length}
    >
      <PageHeader
        title={title}
        description={description}
        actions={
          <div className="hidden min-w-[220px] min-[1200px]:block">
            <OrgLocationSwitcher compact />
          </div>
        }
      />

      <nav
        aria-label="財務分頁"
        className="flex gap-2 overflow-x-auto min-[1200px]:hidden"
      >
        {FINANCE_TABS.map((tab) => {
          const active =
            tab.href === "/staff/finance"
              ? pathname === "/staff/finance"
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "min-h-11 shrink-0 rounded-2xl px-4 text-sm font-medium",
                active
                  ? "bg-primary text-white"
                  : "border border-border bg-surface text-secondary-text",
              )}
            >
              <span className="inline-flex min-h-11 items-center">{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-col gap-3 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between">
        <div className="flex min-h-11 items-center gap-2">
          <button
            type="button"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-border bg-surface"
            aria-label="上一期"
            onClick={() => {
              if (kind === "custom") return;
              const next = shiftPeriod(kind, range, -1);
              setAnchorYmd(next.startYmd);
            }}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <p className="min-w-[9rem] text-center text-[15px] font-semibold text-text">
            {formatPeriodHeading(kind, range)}
          </p>
          <button
            type="button"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-border bg-surface"
            aria-label="下一期"
            onClick={() => {
              if (kind === "custom") return;
              const next = shiftPeriod(kind, range, 1);
              setAnchorYmd(next.startYmd);
            }}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div role="group" aria-label="日期選擇" className="flex flex-wrap gap-2">
          {PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={kind === item.id}
              onClick={() => {
                setKind(item.id);
                if (item.id !== "custom") setAnchorYmd(nowYmd);
              }}
              className={cn(
                "min-h-11 rounded-2xl px-4 text-sm font-medium",
                kind === item.id
                  ? "bg-primary text-white"
                  : "border border-border bg-surface text-secondary-text hover:bg-[#FBF4F3]",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {kind === "custom" ? (
        <div className="flex flex-wrap gap-3">
          <label className="text-sm text-secondary-text">
            開始
            <input
              type="date"
              value={customStart}
              onChange={(event) => setCustomStart(event.target.value)}
              className="mt-1 block min-h-11 rounded-2xl border border-border bg-surface px-3 text-sm text-text"
            />
          </label>
          <label className="text-sm text-secondary-text">
            結束
            <input
              type="date"
              value={customEnd}
              onChange={(event) => setCustomEnd(event.target.value)}
              className="mt-1 block min-h-11 rounded-2xl border border-border bg-surface px-3 text-sm text-text"
            />
          </label>
        </div>
      ) : null}

      {!financeRemoteReadPilot ? (
        <Card padding="md">
          <p className="text-sm text-secondary-text">
            財務遠端讀取尚未開放。畫面不使用本機快取，也不會寫入支出。
          </p>
        </Card>
      ) : null}
      {remote.status === "loading" ? (
        <p className="text-sm text-secondary-text">讀取財務資料中…</p>
      ) : null}
      {remote.status === "error" ? (
        <p className="text-sm text-[#B15B5B]">{remote.message}</p>
      ) : null}

      {children({
        financeRemoteReadPilot,
        expenseRemoteWritePilot,
        organizationId: organization.id,
        locationId: currentLocation?.id ?? "",
        range,
        totals,
        previousTotals,
        trend,
        expenseSlices,
        scopedExpenses: scoped.expenses,
        allExpenses: rows.expenses,
        expenseAvailability,
        transactions: rows.transactions,
        customers: rows.customers,
        remoteStatus: remote.status,
        canCreateExpense: canCreate,
        staffNameById,
        refreshFinance: () => setRefreshEpoch((value) => value + 1),
      })}
    </div>
  );
}

export type FinanceWorkspaceContext = {
  financeRemoteReadPilot: boolean;
  expenseRemoteWritePilot: boolean;
  organizationId: string;
  locationId: string;
  range: { startYmd: string; endYmd: string };
  totals: ReturnType<typeof sumFinanceTotals>;
  previousTotals: ReturnType<typeof sumFinanceTotals>;
  trend: ReturnType<typeof buildFinanceTrend>;
  expenseSlices: ReturnType<typeof buildExpenseCategorySlices>;
  scopedExpenses: Expense[];
  allExpenses: Expense[];
  expenseAvailability: ExpenseRemoteAvailability;
  transactions: ReturnType<typeof financeRemoteRows>["transactions"];
  customers: ReturnType<typeof financeRemoteRows>["customers"];
  remoteStatus: string;
  canCreateExpense: boolean;
  staffNameById: Record<string, string>;
  refreshFinance: () => void;
};

export function FinanceKpiCard({
  label,
  value,
  hint,
  comparison,
  primary = false,
  tone,
  pendingLabel,
}: {
  label: string;
  value: string;
  hint?: string;
  comparison?: FinanceComparison;
  primary?: boolean;
  tone?: "expense" | "delta";
  pendingLabel?: string;
}) {
  return (
    <Card padding="md" className="flex h-full min-h-[108px] min-w-0 flex-col">
      <p className="text-[12px] text-secondary-text">{label}</p>
      <p
        className={cn(
          "mt-2 min-h-[28px] font-semibold tabular-nums tracking-tight",
          pendingLabel
            ? "text-[15px] leading-6 text-secondary-text"
            : "truncate text-[22px] leading-7",
          !pendingLabel && primary && "text-primary",
          !pendingLabel && tone === "expense" && "text-[#B15B5B]",
          !pendingLabel && tone === "delta" && "text-[#5C7F66]",
          !pendingLabel && !primary && !tone && "text-text",
        )}
      >
        {pendingLabel ?? value}
      </p>
      {hint && !pendingLabel ? (
        <p className="mt-1 text-[12px] text-secondary-text">{hint}</p>
      ) : null}
      {comparison && comparison.kind !== "hidden" && !pendingLabel ? (
        <p className={cn("mt-1 text-[12px]", comparisonClass(comparison.kind))}>
          {comparison.label}
          {comparison.kind !== "flat" ? " 相較上期" : ""}
        </p>
      ) : null}
    </Card>
  );
}

export function FinanceDashboardBody({ ctx }: { ctx: FinanceWorkspaceContext }) {
  const collectedShare = (part: number) =>
    shareOf(part, ctx.totals.collectedRevenueMinor);
  const expenseUnavailable = ctx.expenseAvailability === "unavailable";
  return (
    <>
      <section
        aria-label="財務指標"
        className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-2 min-[1200px]:grid-cols-4"
      >
        <FinanceKpiCard
          primary
          label="實收收入"
          value={formatTwd(ctx.totals.collectedRevenueMinor)}
          comparison={compareMinor(
            ctx.totals.collectedRevenueMinor,
            ctx.previousTotals.collectedRevenueMinor,
          )}
        />
        <FinanceKpiCard
          label="服務收入"
          value={formatTwd(ctx.totals.serviceCollectedMinor)}
          hint={`佔比 ${formatSharePercent(collectedShare(ctx.totals.serviceCollectedMinor))}`}
        />
        <FinanceKpiCard
          label="套票銷售"
          value={formatTwd(ctx.totals.packageSalesMinor)}
          hint={`佔比 ${formatSharePercent(collectedShare(ctx.totals.packageSalesMinor))}`}
        />
        <FinanceKpiCard
          label="產品銷售"
          value={formatTwd(ctx.totals.productSalesMinor)}
          hint={`佔比 ${formatSharePercent(collectedShare(ctx.totals.productSalesMinor))}`}
        />
      </section>
      <section className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-2">
        <FinanceKpiCard
          tone="expense"
          label="支出總額"
          value={formatTwd(ctx.totals.expenseMinor)}
          pendingLabel={expenseUnavailable ? EXPENSE_LEDGER_UNAVAILABLE_MESSAGE : undefined}
          comparison={
            expenseUnavailable
              ? undefined
              : compareMinor(ctx.totals.expenseMinor, ctx.previousTotals.expenseMinor)
          }
        />
        <FinanceKpiCard
          tone="delta"
          label="營運收支差額"
          value={formatTwd(ctx.totals.operatingCashDeltaMinor)}
          pendingLabel={expenseUnavailable ? EXPENSE_DELTA_PENDING_MESSAGE : undefined}
          comparison={
            expenseUnavailable
              ? undefined
              : compareMinor(
                  ctx.totals.operatingCashDeltaMinor,
                  ctx.previousTotals.operatingCashDeltaMinor,
                )
          }
        />
      </section>
      <div className="grid grid-cols-1 gap-4 min-[1024px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card padding="md" className="flex min-h-[280px] flex-col">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-text">收支趨勢</h2>
            <div className="flex gap-3 text-[12px] text-secondary-text">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" />
                實收收入
              </span>
              {expenseUnavailable ? null : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#B8AEA6]" />
                  支出
                </span>
              )}
            </div>
          </div>
          <FinanceTrendChart
            points={ctx.trend}
            includeExpense={!expenseUnavailable}
            summary={`實收 ${formatTwd(ctx.totals.collectedRevenueMinor)}${
              expenseUnavailable
                ? `，${EXPENSE_LEDGER_UNAVAILABLE_MESSAGE}`
                : `，支出 ${formatTwd(ctx.totals.expenseMinor)}`
            }`}
          />
        </Card>
        <Card padding="md" className="flex min-h-[280px] flex-col">
          <h2 className="mb-3 text-base font-semibold text-text">支出分類</h2>
          {expenseUnavailable ? (
            <p className="flex flex-1 items-center justify-center py-10 text-center text-sm text-secondary-text">
              {EXPENSE_LEDGER_UNAVAILABLE_MESSAGE}
            </p>
          ) : (
            <FinanceDonut
              total={ctx.totals.expenseMinor}
              totalLabel="支出總額"
              rows={ctx.expenseSlices.map((row) => ({
                key: row.category,
                label: EXPENSE_CATEGORY_LABEL[row.category],
                amountMinor: row.amountMinor,
                share: row.share,
              }))}
            />
          )}
        </Card>
      </div>
      <Card padding="md" className="min-[1200px]:hidden">
        <h2 className="text-base font-semibold text-text">最近支出</h2>
        {expenseUnavailable ? (
          <p className="py-8 text-center text-sm text-secondary-text">
            {EXPENSE_LEDGER_UNAVAILABLE_MESSAGE}
          </p>
        ) : ctx.scopedExpenses.length === 0 ? (
          <p className="py-8 text-center text-sm text-secondary-text">此期間尚無支出</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {ctx.scopedExpenses.slice(0, 5).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{row.name}</p>
                  <p className="text-[12px] text-secondary-text">
                    {row.expenseDate.slice(5).replace("-", "/")} · {EXPENSE_CATEGORY_LABEL[row.category]}
                  </p>
                </div>
                <p className="shrink-0 tabular-nums text-sm text-[#B15B5B]">
                  {formatTwd(row.amountMinor)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
