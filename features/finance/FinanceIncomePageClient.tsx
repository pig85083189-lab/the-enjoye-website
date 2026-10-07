"use client";

import Link from "next/link";
import { formatTwd } from "@/lib/commerce/money";
import { buildFinanceIncomeRows } from "@/lib/finance/income";
import { Card } from "@/components/ui/Card";
import { FinanceWorkspace, type FinanceWorkspaceContext } from "./FinanceWorkspace";

function IncomeBody({ ctx }: { ctx: FinanceWorkspaceContext }) {
  const rows = buildFinanceIncomeRows({
    transactions: ctx.transactions,
    organizationId: ctx.organizationId,
    locationId: ctx.locationId,
    range: ctx.range,
    customers: ctx.customers,
  });

  return (
    <Card padding="none">
      <div className="hidden min-w-0 overflow-x-auto min-[1024px]:block">
        <table className="w-full min-w-0 text-left text-sm">
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
              <th className="px-4 py-3 font-medium">經手人</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-secondary-text">
                  此期間尚無收入紀錄
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.transactionId} className="border-t border-border">
                  <td className="px-4 py-3 tabular-nums text-secondary-text">
                    {row.dateLabel}
                    <span className="block text-[11px]">{row.timeLabel}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/staff/transactions?id=${encodeURIComponent(row.transactionId)}`}
                      className="font-medium text-primary"
                    >
                      {row.transactionNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{row.customerName}</td>
                  <td className="px-4 py-3">{row.content}</td>
                  <td className="px-4 py-3">{row.incomeKindLabel}</td>
                  <td className="px-4 py-3 tabular-nums">{formatTwd(row.serviceValueMinor)}</td>
                  <td className="px-4 py-3 tabular-nums text-secondary-text">
                    {row.packageOffsetMinor > 0 ? `−${formatTwd(row.packageOffsetMinor)}` : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-medium">{formatTwd(row.collectedMinor)}</td>
                  <td className="px-4 py-3">{row.paymentLabel}</td>
                  <td className="px-4 py-3 text-secondary-text">{row.staffName}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border min-[1024px]:hidden">
        {rows.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-secondary-text">此期間尚無收入紀錄</li>
        ) : (
          rows.map((row) => (
            <li key={row.transactionId} className="px-4 py-3">
              <Link href={`/staff/transactions?id=${encodeURIComponent(row.transactionId)}`} className="block">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text">{row.content}</p>
                    <p className="mt-0.5 text-[12px] text-secondary-text">
                      {row.customerName} · {row.incomeKindLabel} · {row.paymentLabel}
                    </p>
                    <p className="mt-0.5 text-[12px] text-secondary-text">
                      {row.transactionNumber} · {row.dateLabel}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm tabular-nums text-text">{formatTwd(row.serviceValueMinor)}</p>
                    <p className="text-[12px] text-secondary-text">
                      實收 {formatTwd(row.collectedMinor)}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}

export function FinanceIncomePageClient({
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
      title="收入紀錄"
      description="來源為已完成交易，不是第二套收入帳本"
    >
      {(ctx) => <IncomeBody ctx={ctx} />}
    </FinanceWorkspace>
  );
}
