"use client";

import { Card } from "@/components/ui/Card";
import { formatTwd } from "@/lib/commerce/money";
import { EXPENSE_CATEGORY_LABEL, FINANCE_INCOME_KIND_LABEL } from "@/lib/finance/domain";
import { shareOf } from "@/lib/finance/derived";
import { type DonutSlice, FinanceDonut } from "./FinanceCharts";
import {
  FinanceKpiCard,
  FinanceWorkspace,
  type FinanceWorkspaceContext,
} from "./FinanceWorkspace";

function incomeSourceSlices(ctx: FinanceWorkspaceContext): DonutSlice[] {
  const rows = [
    { key: "SERVICE", label: FINANCE_INCOME_KIND_LABEL.SERVICE, amountMinor: ctx.totals.serviceCollectedMinor },
    { key: "PACKAGE_SALE", label: FINANCE_INCOME_KIND_LABEL.PACKAGE_SALE, amountMinor: ctx.totals.packageSalesMinor },
    { key: "PRODUCT", label: FINANCE_INCOME_KIND_LABEL.PRODUCT, amountMinor: ctx.totals.productSalesMinor },
    { key: "OTHER", label: FINANCE_INCOME_KIND_LABEL.OTHER, amountMinor: ctx.totals.otherCollectedMinor },
  ];
  const whole = ctx.totals.collectedRevenueMinor;
  return rows
    .filter((row) => row.amountMinor > 0)
    .map((row) => ({ ...row, share: shareOf(row.amountMinor, whole) }));
}

function ReportsBody({ ctx }: { ctx: FinanceWorkspaceContext }) {
  return (
    <>
      <section className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-3">
        <FinanceKpiCard
          primary
          label="實收收入"
          value={formatTwd(ctx.totals.collectedRevenueMinor)}
        />
        <FinanceKpiCard
          tone="expense"
          label="支出總額"
          value={formatTwd(ctx.totals.expenseMinor)}
        />
        <FinanceKpiCard
          tone="delta"
          label="營運收支差額"
          value={formatTwd(ctx.totals.operatingCashDeltaMinor)}
        />
      </section>
      <div className="grid grid-cols-1 gap-4 min-[1024px]:grid-cols-2">
        <Card padding="md">
          <h2 className="mb-3 text-base font-semibold text-text">收入來源分析</h2>
          <FinanceDonut
            total={ctx.totals.collectedRevenueMinor}
            totalLabel="實收收入"
            rows={incomeSourceSlices(ctx)}
          />
          <ul className="mt-4 space-y-1 text-sm text-secondary-text">
            <li>服務收入 {formatTwd(ctx.totals.serviceCollectedMinor)}</li>
            <li>套票銷售 {formatTwd(ctx.totals.packageSalesMinor)}</li>
            <li>產品銷售 {formatTwd(ctx.totals.productSalesMinor)}</li>
            <li>其他 {formatTwd(ctx.totals.otherCollectedMinor)}</li>
          </ul>
        </Card>
        <Card padding="md">
          <h2 className="mb-3 text-base font-semibold text-text">支出分類分析</h2>
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
      <section className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-2">
        <FinanceKpiCard
          label="本月服務價值"
          value={formatTwd(ctx.totals.serviceValueMinor)}
          hint="完成服務的價值，不含套票購買"
        />
        <FinanceKpiCard
          label="套票抵用價值"
          value={formatTwd(ctx.totals.packageRedemptionValueMinor)}
          hint="核銷堂數對應的服務價值，不計入實收"
        />
      </section>
    </>
  );
}

export function FinanceReportsPageClient({
  financeRemoteReadPilot,
  expenseRemoteWritePilot,
}: {
  financeRemoteReadPilot: boolean;
  expenseRemoteWritePilot: boolean;
}) {
  return (
    <FinanceWorkspace
      financeRemoteReadPilot={financeRemoteReadPilot}
      expenseRemoteWritePilot={expenseRemoteWritePilot}
      title="月報表"
      description="查看每月的收入、支出與營運報表"
    >
      {(ctx) => <ReportsBody ctx={ctx} />}
    </FinanceWorkspace>
  );
}
