"use client";

import { FinanceDashboardBody, FinanceWorkspace } from "./FinanceWorkspace";

export function FinanceDashboardPageClient({
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
      title="營運總覽"
      description="查看店舖的收入、支出與營運狀況"
    >
      {(ctx) => <FinanceDashboardBody ctx={ctx} />}
    </FinanceWorkspace>
  );
}
