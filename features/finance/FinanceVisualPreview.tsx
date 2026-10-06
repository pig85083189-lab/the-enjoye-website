"use client";

import { Card } from "@/components/ui/Card";
import { formatTwd } from "@/lib/commerce/money";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/finance/domain";
import {
  buildExpenseCategorySlices,
  buildFinanceTrend,
  filterCompletedInScope,
  formatSharePercent,
  shareOf,
  sumFinanceTotals,
} from "@/lib/finance/derived";
import { buildFinanceExpenseRows } from "@/lib/finance/expense";
import { buildFinanceIncomeRows } from "@/lib/finance/income";
import { monthRangeContaining } from "@/lib/finance/period";
import {
  financeVisualFixtureExpenses,
  financeVisualFixtureTransactions,
} from "@/lib/finance/visual-fixture";
import { FinanceDonut } from "./FinanceCharts";
import { FinanceDashboardBody, type FinanceWorkspaceContext } from "./FinanceWorkspace";

function buildFixtureContext(): FinanceWorkspaceContext {
  const range = monthRangeContaining("2026-10-06");
  const transactions = financeVisualFixtureTransactions();
  const expenses = financeVisualFixtureExpenses();
  const scoped = filterCompletedInScope({
    transactions,
    expenses,
    organizationId: "org-the-enjoye",
    locationId: "loc-enjoye-main",
    range,
  });
  return {
    financeRemoteReadPilot: false,
    expenseRemoteWritePilot: false,
    organizationId: "org-the-enjoye",
    locationId: "loc-enjoye-main",
    range,
    totals: sumFinanceTotals(scoped.metrics, scoped.expenses),
    previousTotals: sumFinanceTotals([], []),
    trend: buildFinanceTrend(range, scoped.metrics, scoped.expenses),
    expenseSlices: buildExpenseCategorySlices(scoped.expenses),
    scopedExpenses: scoped.expenses,
    allExpenses: expenses,
    expenseAvailability: "ready",
    transactions,
    customers: [
      { id: "cust-fx-1", name: "喻至敬", phone: "0916613196" },
      { id: "cust-fx-2", name: "喻茗楷", phone: "0980929616" },
    ],
    remoteStatus: "data",
  };
}

export function FinanceVisualPreview({ surface }: { surface: "dashboard" | "income" | "expenses" | "reports" }) {
  const ctx = buildFixtureContext();
  const income = buildFinanceIncomeRows({
    transactions: ctx.transactions,
    organizationId: ctx.organizationId,
    locationId: ctx.locationId,
    range: ctx.range,
    customers: ctx.customers,
  });
  const expenses = buildFinanceExpenseRows({
    expenses: ctx.allExpenses,
    organizationId: ctx.organizationId,
    locationId: ctx.locationId,
    range: ctx.range,
  });

  return (
    <div className="min-h-screen bg-background text-text" data-finance-visual-preview={surface}>
      <div className="mx-auto max-w-[1520px] px-4 py-6 sm:px-6 min-[1200px]:px-8">
        <p className="text-[11px] tracking-[0.18em] text-secondary-text">Beauty OS</p>
        <p className="font-display text-sm tracking-[0.14em] text-primary">THE ENJOYE</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {surface === "dashboard"
            ? "營運總覽"
            : surface === "income"
              ? "收入紀錄"
              : surface === "expenses"
                ? "支出記帳"
                : "月報表"}
        </h1>
        <p className="mt-1 text-[15px] text-secondary-text">
          {surface === "dashboard"
            ? "查看店舖的收入、支出與營運狀況"
            : surface === "income"
              ? "來源為已完成交易，不是第二套收入帳本"
              : surface === "expenses"
                ? "記錄店舖支出。寫入尚未開放。"
                : "查看每月的收入、支出與營運報表"}
        </p>
        <p className="mt-3 text-sm font-semibold text-text">2026年10月</p>
        <div className="mt-5 space-y-5">
          {surface === "dashboard" ? <FinanceDashboardBody ctx={ctx} /> : null}
          {surface === "income" ? (
            <Card padding="none">
              <div className="hidden min-[1024px]:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[12px] text-secondary-text">
                      <th className="px-4 py-3 font-medium">日期</th>
                      <th className="px-4 py-3 font-medium">交易編號</th>
                      <th className="px-4 py-3 font-medium">客戶</th>
                      <th className="px-4 py-3 font-medium">內容</th>
                      <th className="px-4 py-3 font-medium">收入類型</th>
                      <th className="px-4 py-3 font-medium">服務價值</th>
                      <th className="px-4 py-3 font-medium">套票/權益抵用</th>
                      <th className="px-4 py-3 font-medium">實際收款</th>
                      <th className="px-4 py-3 font-medium">付款方式</th>
                    </tr>
                  </thead>
                  <tbody>
                    {income.map((row) => (
                      <tr key={row.transactionId} className="border-t border-border">
                        <td className="px-4 py-3">{row.dateLabel}</td>
                        <td className="px-4 py-3 text-primary">{row.transactionNumber}</td>
                        <td className="px-4 py-3">{row.customerName}</td>
                        <td className="px-4 py-3">{row.content}</td>
                        <td className="px-4 py-3">{row.incomeKindLabel}</td>
                        <td className="px-4 py-3 tabular-nums">{formatTwd(row.serviceValueMinor)}</td>
                        <td className="px-4 py-3">
                          {row.packageOffsetMinor > 0 ? `−${formatTwd(row.packageOffsetMinor)}` : "—"}
                        </td>
                        <td className="px-4 py-3 font-medium tabular-nums">{formatTwd(row.collectedMinor)}</td>
                        <td className="px-4 py-3">{row.paymentLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-border min-[1024px]:hidden">
                {income.map((row) => (
                  <li key={row.transactionId} className="px-4 py-3">
                    <p className="text-sm font-medium">{row.content}</p>
                    <p className="text-[12px] text-secondary-text">
                      {row.customerName} · {row.incomeKindLabel} · {row.paymentLabel}
                    </p>
                    <p className="mt-1 text-sm tabular-nums">
                      {formatTwd(row.serviceValueMinor)} · 實收 {formatTwd(row.collectedMinor)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {surface === "expenses" ? (
            <Card padding="none">
              <div className="hidden min-[1024px]:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[12px] text-secondary-text">
                      <th className="px-4 py-3 font-medium">日期</th>
                      <th className="px-4 py-3 font-medium">分類</th>
                      <th className="px-4 py-3 font-medium">項目</th>
                      <th className="px-4 py-3 font-medium">金額</th>
                      <th className="px-4 py-3 font-medium">付款方式</th>
                      <th className="px-4 py-3 font-medium">店家 / 廠商</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((row) => (
                      <tr key={row.id} className="border-t border-border">
                        <td className="px-4 py-3">{row.expenseDate.slice(5).replace("-", "/")}</td>
                        <td className="px-4 py-3">{row.categoryLabel}</td>
                        <td className="px-4 py-3">{row.name}</td>
                        <td className="px-4 py-3 tabular-nums">{formatTwd(row.amountMinor)}</td>
                        <td className="px-4 py-3">{row.paymentLabel}</td>
                        <td className="px-4 py-3">{row.vendor || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-border min-[1024px]:hidden">
                {expenses.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{row.name}</p>
                      <p className="text-[12px] text-secondary-text">
                        {row.expenseDate.slice(5).replace("-", "/")} · {row.categoryLabel}
                      </p>
                    </div>
                    <p className="tabular-nums text-sm text-[#B15B5B]">{formatTwd(row.amountMinor)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {surface === "reports" ? (
            <>
              <div className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-3">
                <Card padding="md">
                  <p className="text-[12px] text-secondary-text">實收收入</p>
                  <p className="mt-1 text-[22px] font-semibold text-primary tabular-nums">
                    {formatTwd(ctx.totals.collectedRevenueMinor)}
                  </p>
                </Card>
                <Card padding="md">
                  <p className="text-[12px] text-secondary-text">支出總額</p>
                  <p className="mt-1 text-[22px] font-semibold text-[#B15B5B] tabular-nums">
                    {formatTwd(ctx.totals.expenseMinor)}
                  </p>
                </Card>
                <Card padding="md">
                  <p className="text-[12px] text-secondary-text">營運收支差額</p>
                  <p className="mt-1 text-[22px] font-semibold text-[#5C7F66] tabular-nums">
                    {formatTwd(ctx.totals.operatingCashDeltaMinor)}
                  </p>
                </Card>
              </div>
              <div className="grid grid-cols-1 gap-4 min-[1024px]:grid-cols-2">
                <Card padding="md">
                  <h2 className="mb-3 text-base font-semibold">收入來源分析</h2>
                  <FinanceDonut
                    total={ctx.totals.collectedRevenueMinor}
                    totalLabel="實收收入"
                    rows={[
                      {
                        key: "SERVICE",
                        label: "服務",
                        amountMinor: ctx.totals.serviceCollectedMinor,
                        share: shareOf(ctx.totals.serviceCollectedMinor, ctx.totals.collectedRevenueMinor),
                      },
                      {
                        key: "PACKAGE_SALE",
                        label: "套票銷售",
                        amountMinor: ctx.totals.packageSalesMinor,
                        share: shareOf(ctx.totals.packageSalesMinor, ctx.totals.collectedRevenueMinor),
                      },
                    ]}
                  />
                </Card>
                <Card padding="md">
                  <h2 className="mb-3 text-base font-semibold">支出分類分析</h2>
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
                </Card>
              </div>
              <p className="text-sm text-secondary-text">
                本月服務價值 {formatTwd(ctx.totals.serviceValueMinor)} · 套票抵用價值{" "}
                {formatTwd(ctx.totals.packageRedemptionValueMinor)} · 佔比{" "}
                {formatSharePercent(shareOf(ctx.totals.packageSalesMinor, ctx.totals.collectedRevenueMinor))}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
