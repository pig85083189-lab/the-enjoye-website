"use client";

import Link from "next/link";
import {
  Suspense,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, ReceiptText, Search } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TransactionQuickView } from "@/features/transactions/TransactionQuickView";
import { useCommerceRemoteTransactions } from "@/features/transactions/use-commerce-remote-transactions";
import { listAppointments } from "@/lib/appointments/store";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { formatTwd } from "@/lib/commerce/money";
import { listTransactions } from "@/lib/commerce/transaction-store";
import {
  TRANSACTIONS_WORKSPACE_GAP_PX,
  TRANSACTION_DATE_FILTER_OPTIONS,
  TRANSACTION_PAYMENT_FILTER_OPTIONS,
  TRANSACTION_STATUS_FILTER_OPTIONS,
  buildTransactionWorkspaceRows,
  countTodayPaymentBreakdown,
  countTransactionSummary,
  filterTransactionRows,
  formatTransactionTimestamp,
  isTransactionRowKeyboardActivation,
  mapTransactionQuickView,
  resolveSelectedTransactionRow,
  shouldRenderTransactionQuickView,
  shouldResetTransactionSelection,
  type TransactionDateFilter,
  type TransactionListStatusFilter,
  type TransactionPaymentFilter,
  type TransactionWorkspaceRow,
} from "@/lib/commerce/transactions-workspace-derived";
import {
  canActorVoidTransaction,
  voidTransaction,
} from "@/lib/commerce/void-transaction";
import { getServicesForOrganization } from "@/data/mock-services";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { useCrmJson, useIsClient } from "@/lib/repositories/use-crm-store";
import { getMembership, listLocations } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types";

const STATUS_PILL: Record<TransactionWorkspaceRow["status"]["kind"], string> = {
  COMPLETED: "bg-[#E7F0EA] text-[#5C7F66]",
  VOIDED: "bg-[#F7E8E8] text-[#B15B5B]",
};

const SUMMARY_VALUE: Record<"default" | "primary" | "warning" | "success", string> = {
  default: "text-text",
  primary: "text-[#C56B70]",
  warning: "text-[#C08A3E]",
  success: "text-[#5C7F66]",
};

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-[80px] animate-pulse rounded-2xl bg-primary-light/40" />
      ))}
    </div>
  );
}

function selectFromPointer(event: SyntheticEvent<HTMLElement>) {
  event.preventDefault();
}

function TransactionsInner({
  commerceRemoteReadPilot = false,
}: {
  commerceRemoteReadPilot?: boolean;
}) {
  const searchParams = useSearchParams();
  const inboundId = searchParams.get("id");
  const { organization, currentLocation, membership } = useOrganization();
  const isClient = useIsClient();
  const commerceRev = useSyncExternalStore(
    subscribeCommerce,
    getCommerceRevision,
    () => "",
  );

  const staffId = membership?.userId ?? "";
  const canVoid =
    !commerceRemoteReadPilot &&
    Boolean(staffId) &&
    canActorVoidTransaction(organization.id, staffId);

  const [filters, setFilters] = useState<{
    status: TransactionListStatusFilter;
    date: TransactionDateFilter;
    payment: TransactionPaymentFilter;
    query: string;
  }>({
    status: "all",
    date: inboundId ? "all" : "today",
    payment: "all",
    query: "",
  });
  const statusFilter = filters.status;
  const dateFilter = filters.date;
  const paymentFilter = filters.payment;
  const query = filters.query;
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(
    inboundId,
  );
  const [now] = useState(() => new Date());
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState("");

  const remoteTransactionState = useCommerceRemoteTransactions({
    organizationId: organization.id,
    enabled: commerceRemoteReadPilot,
  });
  const customers = useCrmJson(
    () =>
      commerceRemoteReadPilot
        ? ([] as Customer[])
        : localCustomerRepository.list({ organizationId: organization.id }),
    [] as Customer[],
  );
  const catalog = useMemo(
    () => (commerceRemoteReadPilot ? [] : getServicesForOrganization(organization.id)),
    [commerceRemoteReadPilot, organization.id],
  );
  const locations = useMemo(
    () => listLocations(organization.id).map((row) => ({ id: row.id, name: row.name })),
    [organization.id],
  );

  const transactions = useMemo(() => {
    void commerceRev;
    if (!isClient) return [];
    if (commerceRemoteReadPilot) {
      return remoteTransactionState.status === "data"
        ? remoteTransactionState.transactions
        : [];
    }
    return listTransactions(organization.id);
  }, [
    commerceRemoteReadPilot,
    commerceRev,
    isClient,
    organization.id,
    remoteTransactionState,
  ]);

  const remoteCustomers =
    remoteTransactionState.status === "data" ? remoteTransactionState.customers : [];

  const appointments = useMemo(() => {
    void commerceRev;
    if (!isClient || commerceRemoteReadPilot) return [];
    return listAppointments({ organizationId: organization.id }).map((row) => ({
      id: row.id,
      staffId: row.staffId,
      staffName: row.staffName,
      locationId: row.locationId,
    }));
  }, [commerceRemoteReadPilot, commerceRev, isClient, organization.id]);

  const staff = useMemo(() => {
    const ids = new Set(transactions.map((row) => row.createdByStaffId));
    return [...ids].flatMap((id) => {
      const member = getMembership(organization.id, id);
      return member ? [{ id, displayName: member.displayName }] : [];
    });
  }, [organization.id, transactions]);

  const rows = useMemo(
    () =>
      buildTransactionWorkspaceRows({
        organizationId: organization.id,
        transactions,
        customers: commerceRemoteReadPilot
          ? remoteCustomers.map((row) => ({
              id: row.id,
              organizationId: organization.id,
              name: row.name,
              phone: row.phone,
            }))
          : customers,
        locations,
        staff,
        appointments,
        catalog,
      }),
    [
      appointments,
      catalog,
      commerceRemoteReadPilot,
      customers,
      locations,
      organization.id,
      remoteCustomers,
      staff,
      transactions,
    ],
  );

  const visible = useMemo(
    () =>
      filterTransactionRows(rows, {
        status: statusFilter,
        query,
        date: dateFilter,
        payment: paymentFilter,
        now,
      }),
    [dateFilter, now, paymentFilter, query, rows, statusFilter],
  );

  const summary = useMemo(() => countTransactionSummary(rows, now), [now, rows]);
  const breakdown = useMemo(
    () => countTodayPaymentBreakdown(rows, now),
    [now, rows],
  );

  const selectedFromAll = resolveSelectedTransactionRow(rows, selectedTransactionId);
  const selectedStillVisible = !shouldResetTransactionSelection({
    selectedTransactionId,
    visibleRows: visible,
  });
  const selectedRow =
    selectedFromAll && (selectedStillVisible || selectedTransactionId === inboundId)
      ? selectedFromAll
      : selectedStillVisible
        ? resolveSelectedTransactionRow(visible, selectedTransactionId)
        : null;
  const showQuickView = shouldRenderTransactionQuickView(selectedRow);
  const quickViewModel = selectedRow
    ? mapTransactionQuickView(selectedRow, catalog)
    : null;

  function selectTransaction(id: string) {
    setSelectedTransactionId(id);
    setVoidError("");
  }

  function closeQuickView() {
    setSelectedTransactionId(null);
    setVoidError("");
  }

  function applyFilters(next: {
    status?: TransactionListStatusFilter;
    date?: TransactionDateFilter;
    payment?: TransactionPaymentFilter;
    query?: string;
  }) {
    const merged = {
      status: next.status ?? filters.status,
      date: next.date ?? filters.date,
      payment: next.payment ?? filters.payment,
      query: next.query ?? filters.query,
    };
    setFilters(merged);
    const nextVisible = filterTransactionRows(rows, {
      status: merged.status,
      query: merged.query,
      date: merged.date,
      payment: merged.payment,
      now,
    });
    if (
      shouldResetTransactionSelection({
        selectedTransactionId,
        visibleRows: nextVisible,
      })
    ) {
      setSelectedTransactionId(null);
    }
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, id: string) {
    if (!isTransactionRowKeyboardActivation(event.key)) return;
    event.preventDefault();
    selectTransaction(id);
  }

  function confirmVoid(reason: string) {
    if (!selectedRow) return;
    if (commerceRemoteReadPilot) {
      setVoidError("此交易目前無法作廢");
      return;
    }
    setVoidBusy(true);
    setVoidError("");
    try {
      voidTransaction(organization.id, selectedRow.transactionId, {
        actorStaffId: staffId,
        reason,
      });
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : "作廢失敗");
    } finally {
      setVoidBusy(false);
    }
  }

  const emptyAll = isClient && rows.length === 0;
  const emptyFiltered = isClient && rows.length > 0 && visible.length === 0;
  const contextLabel = [organization.name, currentLocation?.name]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      data-transactions-workspace
      data-has-quickview={showQuickView ? "true" : "false"}
      className="min-w-0"
    >
      <header className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">
            {PLATFORM_NAME}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            交易紀錄
          </h1>
          <p className="text-sm text-secondary-text">查看所有收款與交易明細</p>
          {contextLabel ? (
            <p className="text-[12px] text-secondary-text/80">{contextLabel}</p>
          ) : null}
        </div>
      </header>

      <section className="mb-2.5 grid grid-cols-2 gap-2 min-[1200px]:grid-cols-4 min-[1200px]:gap-3">
        <SummaryCard
          label="今日實收"
          value={isClient ? formatTwd(summary.todayExternalInflowMinor) : "—"}
          accent="success"
          emphasis="amount"
        />
        <SummaryCard
          label="今日交易"
          value={isClient ? `${summary.todayTransactionCount} 筆` : "—"}
          emphasis="count"
        />
        <SummaryCard
          label="本月實收"
          value={isClient ? formatTwd(summary.monthExternalInflowMinor) : "—"}
          hint="外部付款"
          accent="primary"
          emphasis="amount"
        />
        <SummaryCard
          label="已作廢"
          value={isClient ? `${summary.voidedCount} 筆` : "—"}
          emphasis="count"
        />
      </section>

      <section
        data-transactions-breakdown
        className="mb-3 flex min-h-[80px] flex-col justify-center gap-1.5 rounded-2xl border border-border bg-surface px-3.5 py-2 min-[1200px]:h-[92px] min-[1200px]:max-h-[100px] min-[1200px]:py-2"
      >
        <BreakdownRow
          title="今日收款方式"
          items={breakdown.external.map((row) => ({
            key: String(row.method),
            label: row.label,
            amountMinor: isClient ? row.amountMinor : 0,
            count: isClient ? row.count : 0,
          }))}
        />
        <BreakdownRow
          title="非現金抵用"
          items={breakdown.nonCash.map((row) => ({
            key: String(row.method),
            label: row.label,
            amountMinor: isClient ? row.amountMinor : 0,
            count: isClient ? row.count : 0,
          }))}
        />
      </section>

      <div
        data-transactions-workspace-split
        data-transactions-gap={showQuickView ? TRANSACTIONS_WORKSPACE_GAP_PX : 0}
        className={cn("flex items-start", showQuickView && "min-[1200px]:gap-4")}
      >
        <div className="min-w-0 flex-1">
          <div
            data-transactions-toolbar
            className="mb-2.5 rounded-2xl border border-border bg-surface px-3 py-2"
          >
            <div className="flex flex-col gap-1.5 min-[720px]:flex-row min-[720px]:items-center min-[720px]:justify-between">
              <div className="flex min-w-0 flex-wrap gap-1">
                {TRANSACTION_STATUS_FILTER_OPTIONS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    data-transactions-filter={entry.id}
                    onClick={() => applyFilters({ status: entry.id })}
                    className={cn(
                      "h-7 min-h-7 shrink-0 rounded-full px-2.5 text-[12px] font-medium transition-colors",
                      statusFilter === entry.id
                        ? "bg-primary text-white"
                        : "bg-[#F6F1EE] text-text hover:bg-primary-light",
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 min-[980px]:max-w-xl min-[980px]:flex-row min-[980px]:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary-text"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => applyFilters({ query: event.target.value })}
                    placeholder="搜尋客戶姓名、電話或交易編號"
                    className="h-9 min-h-9 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[13px] text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
                    aria-label="搜尋客戶姓名、電話或交易編號"
                  />
                </div>
                <div className="flex min-w-0 flex-wrap gap-1">
                  {TRANSACTION_DATE_FILTER_OPTIONS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      data-transactions-date={entry.id}
                      onClick={() => applyFilters({ date: entry.id })}
                      className={cn(
                        "h-7 min-h-7 rounded-full px-2 text-[11px] font-medium transition-colors",
                        dateFilter === entry.id
                          ? "bg-primary text-white"
                          : "bg-[#F6F1EE] text-text hover:bg-primary-light",
                      )}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-1.5 flex min-w-0 flex-wrap gap-1">
              {TRANSACTION_PAYMENT_FILTER_OPTIONS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  data-transactions-payment={entry.id}
                  onClick={() => applyFilters({ payment: entry.id })}
                  className={cn(
                    "h-7 min-h-7 rounded-full px-2 text-[11px] font-medium transition-colors",
                    paymentFilter === entry.id
                      ? "bg-primary text-white"
                      : "bg-[#F6F1EE] text-text hover:bg-primary-light",
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          {!isClient ? (
            <ListSkeleton />
          ) : emptyAll ? (
            <Card padding="lg" className="text-center">
              <ReceiptText className="mx-auto h-10 w-10 text-primary/50" aria-hidden />
              <p className="mt-3 text-[15px] font-medium text-text">尚無交易紀錄</p>
              <p className="mt-1 text-sm text-secondary-text">
                完成結帳後，交易會自動出現在這裡。
                <br />
                你可以前往「結帳」查看目前待收款項目。
              </p>
              <Link href="/staff/checkout" className="mt-4 inline-flex">
                <Button className="h-10 min-h-10 rounded-full px-4 text-[13px]">
                  前往結帳
                </Button>
              </Link>
            </Card>
          ) : emptyFiltered ? (
            <Card padding="lg" className="text-center">
              <p className="text-[15px] font-medium text-text">找不到符合的交易</p>
              <p className="mt-1 text-sm text-secondary-text">
                試試調整搜尋、狀態、日期或付款方式
              </p>
            </Card>
          ) : (
            <>
              <div
                data-transactions-list
                className="hidden overflow-hidden rounded-2xl border border-border bg-surface min-[1200px]:block"
              >
                <div className="grid grid-cols-[64px_minmax(150px,1.2fr)_minmax(130px,1.1fr)_88px_72px_96px_64px_24px] bg-[#FAF7F5]/80 px-4 py-2 text-[11px] text-secondary-text">
                  <span>時間</span>
                  <span>客戶</span>
                  <span>內容</span>
                  <span>付款方式</span>
                  <span>經手人</span>
                  <span>金額</span>
                  <span>狀態</span>
                  <span className="sr-only">開啟</span>
                </div>
                {visible.map((row) => (
                  <DesktopRow
                    key={row.transactionId}
                    row={row}
                    selected={selectedTransactionId === row.transactionId}
                    onSelect={selectTransaction}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>

              <div className="space-y-2.5 min-[1200px]:hidden">
                {visible.map((row) => (
                  <MobileCard
                    key={row.transactionId}
                    row={row}
                    selected={selectedTransactionId === row.transactionId}
                    onSelect={selectTransaction}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {showQuickView && selectedRow && quickViewModel ? (
          <div className="hidden min-[1200px]:block">
            <TransactionQuickView
              key={selectedRow.transactionId}
              model={quickViewModel}
              canVoid={canVoid}
              voidBusy={voidBusy}
              voidError={voidError}
              onClose={closeQuickView}
              onConfirmVoid={confirmVoid}
            />
          </div>
        ) : null}
      </div>

      {showQuickView && selectedRow && quickViewModel ? (
        <div className="min-[1200px]:hidden">
          <TransactionQuickView
            key={selectedRow.transactionId}
            model={quickViewModel}
            canVoid={canVoid}
            voidBusy={voidBusy}
            voidError={voidError}
            onClose={closeQuickView}
            onConfirmVoid={confirmVoid}
          />
        </div>
      ) : null}
    </div>
  );
}

export function TransactionsPageClient({
  commerceRemoteReadPilot = false,
}: {
  commerceRemoteReadPilot?: boolean;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-secondary-text">載入交易…</p>}>
      <TransactionsInner commerceRemoteReadPilot={commerceRemoteReadPilot} />
    </Suspense>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  accent = "default",
  emphasis = "amount",
}: {
  label: string;
  value: number | string;
  hint?: string;
  accent?: "default" | "primary" | "warning" | "success";
  emphasis?: "amount" | "count";
}) {
  return (
    <div
      data-transactions-summary
      data-emphasis={emphasis}
      className="flex h-[72px] min-h-[72px] max-h-[76px] min-w-0 flex-col justify-center rounded-2xl border border-border bg-surface px-3.5 py-2 shadow-[0_1px_1px_rgba(48,43,43,0.025)]"
    >
      <p
        className={cn(
          "leading-none tracking-tight tabular-nums",
          emphasis === "amount"
            ? "text-[22px] font-semibold sm:text-[26px]"
            : "text-[16px] font-medium sm:text-[18px] text-secondary-text",
          emphasis === "amount" ? SUMMARY_VALUE[accent] : "text-secondary-text",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[10px] leading-tight text-secondary-text">
        {label}
        {hint ? (
          <span className="ml-1 font-normal text-secondary-text/65">· {hint}</span>
        ) : null}
      </p>
    </div>
  );
}

function BreakdownRow({
  title,
  items,
}: {
  title: string;
  items: Array<{ key: string; label: string; amountMinor: number; count: number }>;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <p className="w-[72px] shrink-0 text-[11px] font-medium text-secondary-text min-[1200px]:w-[84px]">
          {title}
        </p>
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5 min-[1200px]:gap-x-4">
        {items.map((item) => {
          const active = item.amountMinor > 0;
          return (
            <p
              key={item.key}
              className={cn(
                "whitespace-nowrap text-[12px] tabular-nums",
                active ? "text-text" : "text-secondary-text/55",
              )}
            >
              <span className={active ? "font-medium" : ""}>{item.label}</span>
              <span className={cn("ml-1.5", active && "font-semibold")}>
                {formatTwd(item.amountMinor)}
              </span>
              <span className="ml-1 text-[11px] text-secondary-text/80">
                {item.count} 筆
              </span>
            </p>
          );
        })}
      </div>
    </div>
  );
}

interface RowProps {
  row: TransactionWorkspaceRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onPointerDown: (event: SyntheticEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void;
}

function DesktopRow({
  row,
  selected,
  onSelect,
  onPointerDown,
  onKeyDown,
}: RowProps) {
  const time = formatTransactionTimestamp(row.completedAt);
  const handlerName = row.beauticianName || row.cashierName;

  return (
    <div
      data-transactions-row
      data-transaction-id={row.transactionId}
      aria-pressed={selected}
      className={cn(
        "relative grid min-h-[74px] cursor-pointer grid-cols-[64px_minmax(150px,1.2fr)_minmax(130px,1.1fr)_88px_72px_96px_64px_24px] items-center border-b border-[#EFE8E4]/80 px-4 last:border-b-0",
        "hover:bg-[#F7F2F0]",
        selected && "bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.transactionId)}
    >
      {selected ? (
        <span
          data-transactions-row-accent
          className="pointer-events-none absolute inset-y-0 left-0 z-20 w-[3px] bg-[#C56B70]"
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        data-transactions-row-focus
        aria-label={`${row.customerName}，開啟交易詳情`}
        aria-pressed={selected}
        className="absolute inset-0 z-10 cursor-pointer rounded-none bg-transparent"
        onPointerDown={onPointerDown}
        onMouseDown={onPointerDown}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(row.transactionId);
        }}
        onKeyDown={(event) => onKeyDown(event, row.transactionId)}
      />
      <div className="pointer-events-none relative z-0 pr-2">
        <p className="text-[12px] tabular-nums text-secondary-text">
          {time.timeLabel || "—"}
        </p>
        <p className="text-[11px] text-secondary-text/75">
          {time.dateLabel.slice(5) || ""}
        </p>
      </div>
      <div className="pointer-events-none relative z-0 flex min-w-0 items-center gap-2.5 pr-2">
        <Avatar initials={row.customerInitials} size="sm" className="gap-0" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-text">
            {row.customerName}
          </p>
          {row.customerPhone ? (
            <p className="truncate text-[12px] text-secondary-text">{row.customerPhone}</p>
          ) : null}
        </div>
      </div>
      <div className="pointer-events-none relative z-0 min-w-0 pr-2">
        <p className="truncate text-[14px] font-medium text-text">{row.lineSummary}</p>
      </div>
      <div className="pointer-events-none relative z-0 pr-2">
        <span className="inline-flex max-w-full truncate text-[12px] text-secondary-text">
          {row.paymentBadge}
        </span>
      </div>
      <div className="pointer-events-none relative z-0 truncate pr-2 text-[12px] text-secondary-text">
        {handlerName || ""}
      </div>
      <div className="pointer-events-none relative z-0 pr-2">
        <p className="text-[15px] font-semibold tabular-nums text-text">
          {formatTwd(row.totalMinor)}
        </p>
      </div>
      <div className="pointer-events-none relative z-0 pr-1">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
            STATUS_PILL[row.status.kind],
          )}
        >
          {row.status.title}
        </span>
      </div>
      <div className="pointer-events-none relative z-0 flex justify-end text-secondary-text">
        <ChevronRight className="h-4 w-4" aria-hidden />
      </div>
    </div>
  );
}

function MobileCard({
  row,
  selected,
  onSelect,
  onPointerDown,
  onKeyDown,
}: RowProps) {
  const time = formatTransactionTimestamp(row.completedAt);
  const handlerName = row.beauticianName || row.cashierName;

  return (
    <div
      data-transactions-row
      data-transaction-id={row.transactionId}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${row.customerName}，開啟交易詳情`}
      className={cn(
        "cursor-pointer rounded-2xl border border-border bg-surface px-3.5 py-3 outline-none transition-colors",
        "hover:border-primary/30 focus-visible:bg-primary-light/30",
        selected && "border-primary/40 bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.transactionId)}
      onKeyDown={(event) => onKeyDown(event, row.transactionId)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[14px] font-semibold text-text">
          {row.customerName}
        </p>
        <p className="shrink-0 text-[14px] font-semibold tabular-nums text-text">
          {formatTwd(row.totalMinor)}
        </p>
      </div>
      <p className="mt-0.5 truncate text-[13px] text-text">{row.lineSummary}</p>
      <p className="mt-1 truncate text-[12px] text-[#6E6666]">
        {[time.timeLabel, row.paymentBadge, handlerName].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-1.5 flex items-center justify-between">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
            STATUS_PILL[row.status.kind],
          )}
        >
          {row.status.title}
        </span>
        <ChevronRight className="h-4 w-4 text-secondary-text" aria-hidden />
      </div>
    </div>
  );
}
