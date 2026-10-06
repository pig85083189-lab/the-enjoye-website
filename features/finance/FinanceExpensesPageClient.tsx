"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatTwd } from "@/lib/commerce/money";
import {
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_CATEGORY_ORDER,
  EXPENSE_PAYMENT_METHOD_LABEL,
  type ExpenseCategory,
  type ExpensePaymentMethod,
} from "@/lib/finance/domain";
import { buildFinanceExpenseRows } from "@/lib/finance/expense";
import { addDaysYmd, formatShortYmd, resolveFinancePeriod, taipeiYmdFromInstant } from "@/lib/finance/period";
import { cn } from "@/lib/utils";
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
  const [form, setForm] = useState({
    expenseDate: nowYmd,
    category: "SUPPLIES" as ExpenseCategory,
    name: "",
    amount: "",
    paymentMethod: "CASH" as ExpensePaymentMethod,
    vendor: "",
    note: "",
  });
  const listRange = useMemo(() => {
    if (filter === "today") return resolveFinancePeriod("day", nowYmd);
    if (filter === "7d") return { startYmd: addDaysYmd(nowYmd, -6), endYmd: nowYmd };
    if (filter === "custom") return ctx.range;
    return resolveFinancePeriod("month", nowYmd);
  }, [filter, nowYmd, ctx.range]);
  const rows = buildFinanceExpenseRows({
    expenses: ctx.allExpenses,
    organizationId: ctx.organizationId,
    locationId: ctx.locationId,
    range: listRange,
    query,
  });

  const formDisabled = !ctx.expenseRemoteWritePilot;
  const formNode = (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <h2 className="text-base font-semibold text-text">新增支出</h2>
      <label className="block text-sm text-secondary-text">
        日期 *
        <input
          required
          type="date"
          value={form.expenseDate}
          onChange={(event) => setForm((prev) => ({ ...prev, expenseDate: event.target.value }))}
          className="mt-1 block min-h-11 w-full rounded-2xl border border-border bg-surface px-3 text-sm text-text"
        />
      </label>
      <label className="block text-sm text-secondary-text">
        支出分類 *
        <select
          value={form.category}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, category: event.target.value as ExpenseCategory }))
          }
          className="mt-1 block min-h-11 w-full rounded-2xl border border-border bg-surface px-3 text-sm text-text"
        >
          {EXPENSE_CATEGORY_ORDER.map((category) => (
            <option key={category} value={category}>
              {EXPENSE_CATEGORY_LABEL[category]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm text-secondary-text">
        項目名稱 *
        <input
          required
          value={form.name}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          className="mt-1 block min-h-11 w-full rounded-2xl border border-border bg-surface px-3 text-sm text-text"
        />
      </label>
      <label className="block text-sm text-secondary-text">
        金額 *
        <input
          required
          inputMode="numeric"
          value={form.amount}
          onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
          className="mt-1 block min-h-11 w-full rounded-2xl border border-border bg-surface px-3 text-sm text-text"
        />
      </label>
      <label className="block text-sm text-secondary-text">
        付款方式
        <select
          value={form.paymentMethod}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              paymentMethod: event.target.value as ExpensePaymentMethod,
            }))
          }
          className="mt-1 block min-h-11 w-full rounded-2xl border border-border bg-surface px-3 text-sm text-text"
        >
          {(Object.keys(EXPENSE_PAYMENT_METHOD_LABEL) as ExpensePaymentMethod[]).map((method) => (
            <option key={method} value={method}>
              {EXPENSE_PAYMENT_METHOD_LABEL[method]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm text-secondary-text">
        店家 / 廠商
        <input
          value={form.vendor}
          onChange={(event) => setForm((prev) => ({ ...prev, vendor: event.target.value }))}
          className="mt-1 block min-h-11 w-full rounded-2xl border border-border bg-surface px-3 text-sm text-text"
        />
      </label>
      <label className="block text-sm text-secondary-text">
        備註
        <textarea
          value={form.note}
          onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
          className="mt-1 block min-h-24 w-full rounded-2xl border border-border bg-surface px-3 py-2 text-sm text-text"
        />
      </label>
      <label className="block text-sm text-secondary-text">
        收據照片
        <input type="file" accept="image/*" disabled className="mt-1 block w-full text-sm" />
      </label>
      {formDisabled ? (
        <p className="text-sm text-secondary-text">支出寫入尚未開放（Finance V1A）</p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={() => setSheetOpen(false)}>
          取消
        </Button>
        <Button type="submit" className="flex-1" disabled={formDisabled}>
          儲存
        </Button>
      </div>
    </form>
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-4 min-[1024px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <Card padding="md" className="hidden min-[1024px]:block">
          {formNode}
        </Card>
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
            placeholder="搜尋項目 / 店家 / 備註"
            className="min-h-11 w-full rounded-2xl border border-border bg-surface px-4 text-sm"
          />
          <Button className="min-[1024px]:hidden" fullWidth onClick={() => setSheetOpen(true)}>
            新增支出
          </Button>
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
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-secondary-text">
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
                        {row.vendor ? (
                          <p className="text-[12px] text-secondary-text">{row.vendor}</p>
                        ) : null}
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
      </div>
      {sheetOpen ? (
        <div className="fixed inset-0 z-50 min-[1024px]:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-text/30"
            aria-label="關閉"
            onClick={() => setSheetOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
            {formNode}
          </div>
        </div>
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
      description="記錄店舖支出。寫入尚未開放。"
    >
      {(ctx) => <ExpensesBody ctx={ctx} />}
    </FinanceWorkspace>
  );
}
