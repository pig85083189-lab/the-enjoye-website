"use client";

import Link from "next/link";
import {
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { ChevronRight, Crown, Plus, Search, WalletCards } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StoredValueQuickView } from "@/features/stored-value/StoredValueQuickView";
import { StoredValueTopUpModal } from "@/features/stored-value/StoredValueTopUpModal";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { formatTwd } from "@/lib/commerce/money";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { useCrmJson, useIsClient } from "@/lib/repositories/use-crm-store";
import {
  getCustomerStoredValueBalance,
  listStoredValueAccounts,
  listStoredValueLedger,
} from "@/lib/stored-value/store";
import {
  STORED_VALUE_FILTER_OPTIONS,
  STORED_VALUE_SORT_OPTIONS,
  STORED_VALUE_WORKSPACE_GAP_PX,
  buildStoredValueWorkspaceRows,
  countStoredValueSummary,
  filterStoredValueRows,
  formatStoredValueTimestamp,
  isStoredValueRowKeyboardActivation,
  mapStoredValueLedgerViews,
  resolveSelectedStoredValueRow,
  shouldRenderStoredValueQuickView,
  shouldResetStoredValueSelection,
  sortStoredValueRows,
  type StoredValueListFilter,
  type StoredValueListSort,
  type StoredValueWorkspaceRow,
} from "@/lib/stored-value/stored-value-workspace-derived";
import { getMembership } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types";

const STATUS_PILL: Record<StoredValueWorkspaceRow["status"]["kind"], string> = {
  positive: "bg-[#E7F0EA] text-[#5C7F66]",
  zero: "bg-[#F1EEEC] text-[#7A7272]",
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

export function StoredValuePageClient() {
  const { organization, currentLocation, locations, membership } = useOrganization();
  const isClient = useIsClient();
  const commerceRev = useSyncExternalStore(
    subscribeCommerce,
    getCommerceRevision,
    () => "",
  );

  const locationId = currentLocation?.id ?? locations[0]?.id ?? "";
  const staffId = membership?.userId ?? "staff-001";
  const canAdjust = membership?.role === "OWNER" || membership?.role === "MANAGER";

  const [filter, setFilter] = useState<StoredValueListFilter>("all");
  const [sort, setSort] = useState<StoredValueListSort>("recent");
  const [query, setQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpCustomerId, setTopUpCustomerId] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const customers = useCrmJson(
    () => localCustomerRepository.list({ organizationId: organization.id }),
    [] as Customer[],
  );

  const ledger = useMemo(() => {
    void commerceRev;
    if (!isClient) return [];
    return listStoredValueLedger(organization.id);
  }, [commerceRev, isClient, organization.id]);

  const rows = useMemo(() => {
    void commerceRev;
    if (!isClient) return [];
    return buildStoredValueWorkspaceRows({
      organizationId: organization.id,
      accounts: listStoredValueAccounts(organization.id),
      ledger,
      customers,
    });
  }, [commerceRev, customers, isClient, ledger, organization.id]);

  const visible = useMemo(
    () => sortStoredValueRows(filterStoredValueRows(rows, filter, query), sort),
    [filter, query, rows, sort],
  );
  const summary = useMemo(
    () => countStoredValueSummary(rows, ledger, now, organization.id),
    [ledger, now, organization.id, rows],
  );

  const selectedStillVisible = !shouldResetStoredValueSelection({
    selectedCustomerId,
    visibleRows: visible,
  });
  const selectedRow = selectedStillVisible
    ? resolveSelectedStoredValueRow(rows, selectedCustomerId)
    : null;
  const showQuickView = shouldRenderStoredValueQuickView(selectedRow);
  const selectedCustomer = selectedRow
    ? customers.find((row) => row.id === selectedRow.customerId) ?? null
    : null;
  const liveBalanceMinor = selectedRow
    ? getCustomerStoredValueBalance(organization.id, selectedRow.customerId)
    : 0;

  const selectedLedger = useMemo(() => {
    if (!selectedCustomerId) return [];
    const names: Record<string, string> = {};
    const entries = ledger.filter((entry) => entry.customerId === selectedCustomerId);
    for (const entry of entries) {
      if (!names[entry.createdByStaffId]) {
        names[entry.createdByStaffId] =
          getMembership(organization.id, entry.createdByStaffId)?.displayName ?? "";
      }
    }
    return mapStoredValueLedgerViews(entries, names);
  }, [ledger, organization.id, selectedCustomerId]);

  function selectCustomer(id: string) {
    setSelectedCustomerId(id);
  }

  function closeQuickView() {
    setSelectedCustomerId(null);
  }

  function applyFilter(next: StoredValueListFilter) {
    setFilter(next);
    const nextVisible = filterStoredValueRows(rows, next, query);
    if (
      shouldResetStoredValueSelection({
        selectedCustomerId,
        visibleRows: nextVisible,
      })
    ) {
      setSelectedCustomerId(null);
    }
  }

  function applyQuery(nextQuery: string) {
    setQuery(nextQuery);
    const nextVisible = filterStoredValueRows(rows, filter, nextQuery);
    if (
      shouldResetStoredValueSelection({
        selectedCustomerId,
        visibleRows: nextVisible,
      })
    ) {
      setSelectedCustomerId(null);
    }
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, customerId: string) {
    if (!isStoredValueRowKeyboardActivation(event.key)) return;
    event.preventDefault();
    selectCustomer(customerId);
  }

  function openTopUp(customerId?: string | null) {
    setTopUpCustomerId(customerId ?? selectedCustomerId);
    setTopUpOpen(true);
  }

  const emptyAll = isClient && rows.length === 0;
  const emptyFiltered = isClient && rows.length > 0 && visible.length === 0;

  return (
    <div
      data-stored-value-workspace
      data-has-quickview={showQuickView ? "true" : "false"}
      className="min-w-0"
    >
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">
            {PLATFORM_NAME}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            儲值管理
          </h1>
          <p className="text-sm text-secondary-text">
            管理客戶儲值、使用紀錄與可用餘額
          </p>
        </div>
        <div className="hidden shrink-0 min-[720px]:block">
          <Button
            className="h-9 min-h-9 rounded-full px-4 text-[13px]"
            onClick={() => openTopUp(null)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            新增儲值
          </Button>
        </div>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 min-[1200px]:grid-cols-4 min-[1200px]:gap-3">
        <SummaryCard
          label="持有儲值客戶"
          value={isClient ? summary.holders : "—"}
          accent="primary"
        />
        <SummaryCard
          label="可用儲值餘額"
          value={isClient ? formatTwd(summary.availableMinor) : "—"}
        />
        <SummaryCard
          label="本月儲值"
          value={isClient ? formatTwd(summary.monthTopUpMinor) : "—"}
          accent="success"
        />
        <SummaryCard
          label="本月使用"
          value={isClient ? formatTwd(summary.monthUsageMinor) : "—"}
          accent="warning"
        />
      </section>

      <div
        data-stored-value-workspace-split
        data-stored-value-gap={showQuickView ? STORED_VALUE_WORKSPACE_GAP_PX : 0}
        className={cn("flex items-start", showQuickView && "min-[1200px]:gap-4")}
      >
        <div className="min-w-0 flex-1">
          <div
            data-stored-value-toolbar
            className="mb-3 rounded-2xl border border-border bg-surface px-3 py-2.5"
          >
            <div className="flex flex-col gap-2 min-[720px]:flex-row min-[720px]:items-center min-[720px]:justify-between">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {STORED_VALUE_FILTER_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-stored-value-filter={item.id}
                    onClick={() => applyFilter(item.id)}
                    className={cn(
                      "h-8 min-h-8 shrink-0 rounded-full px-3 text-[12px] font-medium transition-colors",
                      filter === item.id
                        ? "bg-primary text-white"
                        : "bg-[#F6F1EE] text-text hover:bg-primary-light",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2 min-[720px]:max-w-md min-[720px]:flex-row min-[720px]:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary-text"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => applyQuery(event.target.value)}
                    placeholder="搜尋客戶姓名 / 電話"
                    className="h-10 min-h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[14px] text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
                    aria-label="搜尋客戶姓名或電話"
                  />
                </div>
                <label className="flex h-8 items-center gap-1.5 text-[12px] text-secondary-text">
                  排序
                  <select
                    value={sort}
                    onChange={(event) =>
                      setSort(event.target.value as StoredValueListSort)
                    }
                    className="h-8 min-h-8 rounded-full border border-border bg-surface px-2.5 text-[12px] text-text outline-none"
                    aria-label="排序"
                  >
                    {STORED_VALUE_SORT_OPTIONS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>

          {!isClient ? (
            <ListSkeleton />
          ) : emptyAll ? (
            <Card padding="lg" className="text-center">
              <WalletCards className="mx-auto h-10 w-10 text-primary/50" aria-hidden />
              <p className="mt-3 text-[15px] font-medium text-text">尚無儲值紀錄</p>
              <p className="mt-1 text-sm text-secondary-text">
                客戶完成第一次儲值後，會顯示在這裡。
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button className="h-10 min-h-10 rounded-full px-4 text-[13px]" onClick={() => openTopUp(null)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  新增儲值
                </Button>
                <Link href="/staff/customers">
                  <Button variant="outline" className="h-10 min-h-10 rounded-full px-4 text-[13px]">
                    查看客戶
                  </Button>
                </Link>
              </div>
            </Card>
          ) : emptyFiltered ? (
            <Card padding="lg" className="text-center">
              <p className="text-[15px] font-medium text-text">找不到符合的儲值客戶</p>
              <p className="mt-1 text-sm text-secondary-text">試試調整搜尋或篩選條件</p>
            </Card>
          ) : (
            <>
              <div
                data-stored-value-list
                className="hidden overflow-hidden rounded-2xl border border-border bg-surface min-[1200px]:block"
              >
                <div className="grid grid-cols-[minmax(180px,1.4fr)_120px_120px_130px_96px_28px] border-b border-[#EFE8E4] bg-[#FAF7F5] px-4 py-2.5 text-[12px] text-secondary-text">
                  <span>客戶</span>
                  <span>目前餘額</span>
                  <span>累計儲值</span>
                  <span>最近異動</span>
                  <span>狀態</span>
                  <span className="sr-only">開啟</span>
                </div>
                {visible.map((row) => (
                  <DesktopRow
                    key={row.customerId}
                    row={row}
                    selected={selectedCustomerId === row.customerId}
                    onSelect={selectCustomer}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>

              <div className="space-y-2.5 min-[1200px]:hidden">
                {visible.map((row) => (
                  <MobileCard
                    key={row.customerId}
                    row={row}
                    selected={selectedCustomerId === row.customerId}
                    onSelect={selectCustomer}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {showQuickView && selectedRow ? (
          <div className="hidden min-[1200px]:block">
            <StoredValueQuickView
              key={selectedRow.customerId}
              row={selectedRow}
              customer={selectedCustomer}
              liveBalanceMinor={liveBalanceMinor}
              ledger={selectedLedger}
              canAdjust={canAdjust}
              organizationId={organization.id}
              locationId={locationId}
              staffId={staffId}
              onClose={closeQuickView}
              onTopUp={() => openTopUp(selectedRow.customerId)}
            />
          </div>
        ) : null}
      </div>

      {showQuickView && selectedRow ? (
        <div className="min-[1200px]:hidden">
          <StoredValueQuickView
            key={selectedRow.customerId}
            row={selectedRow}
            customer={selectedCustomer}
            liveBalanceMinor={liveBalanceMinor}
            ledger={selectedLedger}
            canAdjust={canAdjust}
            organizationId={organization.id}
            locationId={locationId}
            staffId={staffId}
            onClose={closeQuickView}
            onTopUp={() => openTopUp(selectedRow.customerId)}
          />
        </div>
      ) : null}

      <div className="sticky bottom-20 z-20 mt-4 min-[720px]:hidden">
        <Button
          className="h-12 min-h-12 w-full rounded-2xl text-[15px] shadow-[0_8px_24px_rgba(197,107,112,0.22)]"
          onClick={() => openTopUp(null)}
        >
          <Plus className="h-4 w-4" aria-hidden />
          新增儲值
        </Button>
      </div>

      {topUpOpen ? (
        <StoredValueTopUpModal
          key={topUpCustomerId ?? "new"}
          open={topUpOpen}
          organizationId={organization.id}
          locationId={locationId}
          staffId={staffId}
          customers={customers}
          initialCustomerId={topUpCustomerId}
          onClose={() => {
            setTopUpOpen(false);
            setTopUpCustomerId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: number | string;
  accent?: "default" | "primary" | "warning" | "success";
}) {
  return (
    <div
      data-stored-value-summary
      className="flex h-[72px] min-h-[72px] max-h-[76px] min-w-0 flex-col justify-center rounded-2xl border border-border bg-surface px-3.5 py-2 shadow-[0_1px_1px_rgba(48,43,43,0.025)]"
    >
      <p
        className={cn(
          "text-[22px] font-semibold leading-none tracking-tight tabular-nums sm:text-[26px]",
          SUMMARY_VALUE[accent],
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[10px] leading-tight text-secondary-text">{label}</p>
    </div>
  );
}

interface RowProps {
  row: StoredValueWorkspaceRow;
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
  const activity = formatStoredValueTimestamp(row.lastActivityAt);

  return (
    <div
      data-stored-value-row
      data-customer-id={row.customerId}
      aria-pressed={selected}
      className={cn(
        "relative grid min-h-[78px] cursor-pointer grid-cols-[minmax(180px,1.4fr)_120px_120px_130px_96px_28px] items-center border-b border-[#EFE8E4] px-4 last:border-b-0",
        "hover:bg-[#F7F2F0]",
        selected && "bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.customerId)}
    >
      {selected ? (
        <span
          data-stored-value-row-accent
          className="pointer-events-none absolute inset-y-0 left-0 z-20 w-[3px] bg-[#C56B70]"
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        data-stored-value-row-focus
        aria-label={`${row.customerName}，開啟儲值摘要`}
        aria-pressed={selected}
        className="absolute inset-0 z-10 cursor-pointer rounded-none bg-transparent"
        onPointerDown={onPointerDown}
        onMouseDown={onPointerDown}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(row.customerId);
        }}
        onKeyDown={(event) => onKeyDown(event, row.customerId)}
      />
      <div className="pointer-events-none relative z-0 flex min-w-0 items-center gap-2.5 pr-2">
        <Avatar initials={row.customerInitials} size="sm" className="gap-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold text-text">
              {row.customerName}
            </span>
            {row.membership ? (
              <Badge
                tone={row.membership.id === "vip" ? "vip" : "new"}
                className="shrink-0 px-1.5 py-px text-[10px]"
              >
                {row.membership.id === "vip" ? (
                  <Crown className="mr-0.5 h-2.5 w-2.5" aria-hidden />
                ) : null}
                {row.membership.label}
              </Badge>
            ) : null}
          </div>
          {row.customerPhone ? (
            <p className="truncate text-[12px] text-[#6E6666]">{row.customerPhone}</p>
          ) : null}
        </div>
      </div>
      <div className="pointer-events-none relative z-0 pr-2">
        <p className="text-[14px] font-semibold tabular-nums text-text">
          {formatTwd(row.balanceMinor)}
        </p>
      </div>
      <div className="pointer-events-none relative z-0 pr-2">
        <p className="text-[13px] tabular-nums text-text">
          {formatTwd(row.lifetimeTopUpMinor)}
        </p>
      </div>
      <div className="pointer-events-none relative z-0 pr-2">
        {activity.dateLabel ? (
          <div>
            <p className="whitespace-nowrap text-[13px] font-medium text-text">
              {activity.dateLabel}
            </p>
            <p className="text-[12px] text-secondary-text">{activity.timeLabel}</p>
          </div>
        ) : (
          <span className="text-secondary-text">—</span>
        )}
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
  const activity = formatStoredValueTimestamp(row.lastActivityAt);

  return (
    <div
      data-stored-value-row
      data-customer-id={row.customerId}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${row.customerName}，開啟儲值摘要`}
      className={cn(
        "cursor-pointer rounded-2xl border border-border bg-surface px-3.5 py-3 outline-none transition-colors",
        "hover:border-primary/30 focus-visible:bg-primary-light/30",
        selected && "border-primary/40 bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.customerId)}
      onKeyDown={(event) => onKeyDown(event, row.customerId)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar initials={row.customerInitials} size="sm" className="gap-0" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-text">{row.customerName}</p>
            <p className="truncate text-[12px] text-[#6E6666]">{row.customerPhone}</p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            STATUS_PILL[row.status.kind],
          )}
        >
          {row.status.title}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[12px] text-[#6E6666]">
        <span>
          {activity.dateLabel || "尚無異動"}
        </span>
        <span className="font-semibold tabular-nums text-text">
          {formatTwd(row.balanceMinor)}
        </span>
      </div>
    </div>
  );
}
