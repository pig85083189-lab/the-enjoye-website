"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatTwd } from "@/lib/commerce/money";
import { EXPENSE_LEDGER_UNAVAILABLE_MESSAGE } from "@/lib/finance/domain";
import { buildFinanceExpenseRows } from "@/lib/finance/expense";
import { addDaysYmd, formatShortYmd, resolveFinancePeriod, taipeiYmdFromInstant } from "@/lib/finance/period";
import { listMemberships } from "@/lib/tenant/organization-store";
import { cn } from "@/lib/utils";
import { ExpenseFormDialog } from "./ExpenseFormDialog";
import { FinanceWorkspace, type FinanceWorkspaceContext } from "./FinanceWorkspace";

const FILTERS: Array<{ id: "today" | "7d" | "month" | "custom"; label: string }> = [
  { id: "today", label: "今天" },
  { id: "7d", label: "最近7天" },
  { id: "month", label: "本月" },
  { id: "custom", label: "自訂" },
];

function ExpensesBody({ ctx }: { ctx: FinanceWorkspaceContext }) {
  const nowYmd = taipeiYmdFromInstant(new Date());
  const [filter, setFilter] = useState<"today" | "7d" | "month" | "custom">("month");
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const listRange = useMemo(() => {
    if (filter === "today") return resolveFinancePeriod("day", nowYmd);
    if (filter === "7d") return { startYmd: addDaysYmd(nowYmd, -6), endYmd: nowYmd };
    if (filter === "custom") return ctx.range;
    return resolveFinancePeriod("month", nowYmd);
  }, [filter, nowYmd, ctx.range]);
  const staffNameById = useMemo(() => {
    const names: Record<string, string> = {};
    for (const row of listMemberships(ctx.organizationId)) {
      names[row.userId] = row.displayName;
    }
    return names;
  }, [ctx.organizationId]);
  const rows = buildFinanceExpenseRows({
    expenses: ctx.allExpenses,
    organizationId: ctx.organizationId,
    locationId: ctx.locationId,
    range: listRange,
    query,
    staffNameById,
  });

  const formDisabled = !ctx.canCreateExpense;
  const addButton = (
    <Button
      fullWidth
      variant={formDisabled ? "outline" : "primary"}
      disabled={formDisabled}
      aria-disabled={formDisabled}
      data-expense-add
      onClick={() => setSheetOpen(true)}
    >
      新增支出
    </Button>
  );

  return (
    <>
      {ctx.expenseAvailability === "unavailable" ? (
        <Card padding="md">
          <p className="text-sm text-secondary-text">{EXPENSE_LEDGER_UNAVAILABLE_MESSAGE}</p>
        </Card>
      ) : null}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={cn(
                "min-h-11 rounded-2xl px-4 text-sm font-medium",
                filter === item.id
                  ? "bg-primary text-white"
                  : "border border-border bg-surface text-secondary-text",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋項目 / 廠商 / 備註"
          className="min-h-11 w-full rounded-2xl border border-border bg-surface px-4 text-sm"
        />
        {addButton}
        <Card padding="none">
          <div className="hidden min-w-0 overflow-x-auto min-[1024px]:block">
            <table className="w-full min-w-0 text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[12px] text-secondary-text">
                  <th className="px-4 py-3 font-medium">日期</th>
                  <th className="px-4 py-3 font-medium">分類</th>
                  <th className="px-4 py-3 font-medium">名稱</th>
                  <th className="px-4 py-3 font-medium">金額</th>
                  <th className="px-4 py-3 font-medium">付款方式</th>
                  <th className="px-4 py-3 font-medium">廠商</th>
                  <th className="px-4 py-3 font-medium">建立人</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-secondary-text">
                      此期間尚無支出紀錄
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-4 py-3 tabular-nums">{formatShortYmd(row.expenseDate)}</td>
                      <td className="px-4 py-3">{row.categoryLabel}</td>
                      <td className="px-4 py-3">{row.name}</td>
                      <td className="px-4 py-3 tabular-nums">{formatTwd(row.amountMinor)}</td>
                      <td className="px-4 py-3">{row.paymentLabel}</td>
                      <td className="px-4 py-3 text-secondary-text">{row.vendor || "—"}</td>
                      <td className="px-4 py-3 text-secondary-text">{row.createdByLabel}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-border min-[1024px]:hidden">
            {rows.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-secondary-text">此期間尚無支出紀錄</li>
            ) : (
              rows.map((row) => (
                <li key={row.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text">{row.name}</p>
                      <p className="text-[12px] text-secondary-text">
                        {formatShortYmd(row.expenseDate)} · {row.categoryLabel} · {row.paymentLabel}
                      </p>
                      <p className="text-[12px] text-secondary-text">
                        {row.vendor || "—"} · {row.createdByLabel}
                      </p>
                    </div>
                    <p className="shrink-0 tabular-nums text-sm text-[#B15B5B]">
                      {formatTwd(row.amountMinor)}
                    </p>
                  </div>
                </li>
              ))
            )}
          </ul>
        </Card>
      </div>
      {sheetOpen ? (
        <ExpenseFormDialog
          open
          organizationId={ctx.organizationId}
          locationId={ctx.locationId}
          defaultDate={nowYmd}
          canCreate={ctx.canCreateExpense}
          writeEnabled={ctx.expenseRemoteWritePilot && ctx.expenseAvailability === "ready"}
          onClose={() => setSheetOpen(false)}
          onCreated={() => ctx.refreshFinance()}
        />
      ) : null}
    </>
  );
}

export function FinanceExpensesPageClient({
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
      title="支出記帳"
      description="記錄店舖支出。寫入僅限店主與店長。"
    >
      {(ctx) => <ExpensesBody ctx={ctx} />}
    </FinanceWorkspace>
  );
}
