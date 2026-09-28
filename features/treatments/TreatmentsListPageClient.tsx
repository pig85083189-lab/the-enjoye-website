"use client";

import Link from "next/link";
import {
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import {
  CalendarDays,
  ChevronRight,
  Crown,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TreatmentQuickView } from "@/features/treatments/TreatmentQuickView";
import { getServicesForOrganization } from "@/data/mock-services";
import { formatHm } from "@/lib/appointments/domain";
import {
  getAppointmentStatusRaw,
  subscribeAppointments,
} from "@/lib/appointment-store";
import { listAppointments } from "@/lib/appointments/store";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { listCompletedTreatmentsForOrganization } from "@/lib/repositories/local-treatment-repository";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { useCrmJson, useIsClient } from "@/lib/repositories/use-crm-store";
import { getMembership } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import {
  getTreatmentDraftRevision,
  listOpenTreatmentDrafts,
  subscribeTreatmentDrafts,
} from "@/lib/treatment-draft";
import {
  buildTreatmentWorkspaceItems,
  countTreatmentWorkspaceSummary,
  deriveTreatmentEmptyState,
  filterTreatmentItems,
  isTreatmentRowKeyboardActivation,
  resolveSelectedTreatment,
  shouldRenderTreatmentQuickView,
  shouldResetTreatmentSelection,
  type TreatmentDateFilter,
  type TreatmentListFilter,
  type TreatmentWorkspaceItem,
} from "@/lib/treatments/treatment-workspace-derived";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types";

const FILTERS: Array<{ id: TreatmentListFilter; label: string }> = [
  { id: "open", label: "進行中 / 草稿" },
  { id: "completed", label: "已完成" },
  { id: "all", label: "全部" },
];

const DATE_FILTERS: Array<{ id: TreatmentDateFilter; label: string }> = [
  { id: "today", label: "今天" },
  { id: "7d", label: "最近 7 天" },
  { id: "all", label: "全部" },
];

const STATUS_PILL: Record<TreatmentWorkspaceItem["status"]["kind"], string> = {
  in_progress: "bg-[#F3E6E5] text-[#C56B70]",
  record_incomplete: "bg-[#F6EDE0] text-[#C08A3E]",
  not_started: "bg-[#F1EEEC] text-[#7A7272]",
  completed: "bg-[#E7F0EA] text-[#5C7F66]",
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
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-[80px] animate-pulse rounded-2xl bg-primary-light/40" />
      ))}
    </div>
  );
}

function selectFromPointer(event: SyntheticEvent<HTMLElement>) {
  event.preventDefault();
}

export function TreatmentsListPageClient() {
  const { organization, currentLocation } = useOrganization();
  const isClient = useIsClient();
  const draftRev = useSyncExternalStore(
    subscribeTreatmentDrafts,
    () => getTreatmentDraftRevision(organization.id),
    () => "",
  );
  const appointmentRev = useSyncExternalStore(
    subscribeAppointments,
    getAppointmentStatusRaw,
    () => "",
  );
  useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");

  const [filter, setFilter] = useState<TreatmentListFilter>("open");
  const [dateFilter, setDateFilter] = useState<TreatmentDateFilter>("today");
  const [query, setQuery] = useState("");
  const [selectedTreatmentId, setSelectedTreatmentId] = useState<string | null>(
    null,
  );
  const [now] = useState(() => new Date());

  const customers = useCrmJson(
    () => localCustomerRepository.list({ organizationId: organization.id }),
    [] as Customer[],
  );
  const catalog = useMemo(
    () => getServicesForOrganization(organization.id),
    [organization.id],
  );
  const appointments = useMemo(() => {
    void appointmentRev;
    if (!isClient) return [];
    return listAppointments({
      organizationId: organization.id,
      locationId: currentLocation?.id,
    });
  }, [appointmentRev, currentLocation?.id, isClient, organization.id]);

  const items = useMemo(() => {
    void draftRev;
    if (!isClient) return [];
    const staffNames: Record<string, string> = {};
    for (const appointment of appointments) {
      staffNames[appointment.staffId] = appointment.staffName;
      const membership = getMembership(organization.id, appointment.staffId);
      if (membership?.displayName) {
        staffNames[appointment.staffId] = membership.displayName;
      }
    }
    return buildTreatmentWorkspaceItems({
      openDrafts: listOpenTreatmentDrafts(organization.id),
      completedTreatments: listCompletedTreatmentsForOrganization(
        organization.id,
      ),
      appointments,
      customers,
      catalog,
      staffNames,
      locationId: currentLocation?.id,
      now,
    });
  }, [
    appointments,
    catalog,
    currentLocation?.id,
    customers,
    draftRev,
    isClient,
    now,
    organization.id,
  ]);

  const completedTreatments = useMemo(() => {
    void draftRev;
    return isClient
      ? listCompletedTreatmentsForOrganization(organization.id)
      : [];
  }, [draftRev, isClient, organization.id]);

  const visible = useMemo(
    () => filterTreatmentItems(items, filter, query, dateFilter, now),
    [dateFilter, filter, items, now, query],
  );
  const summary = useMemo(
    () => countTreatmentWorkspaceSummary(items, now),
    [items, now],
  );

  const selectedStillVisible = !shouldResetTreatmentSelection({
    selectedId: selectedTreatmentId,
    visibleItems: visible,
  });
  const selectedTreatment = selectedStillVisible
    ? resolveSelectedTreatment(items, selectedTreatmentId)
    : null;
  const showQuickView = shouldRenderTreatmentQuickView(selectedTreatment);

  const todayAppointments = appointments.filter((item) => {
    const start = new Date(item.startAt);
    return (
      start.getFullYear() === now.getFullYear() &&
      start.getMonth() === now.getMonth() &&
      start.getDate() === now.getDate()
    );
  });

  const emptyState = deriveTreatmentEmptyState({
    visibleCount: visible.length,
    query,
    filter,
    todayAppointments,
    now,
  });

  function selectTreatment(id: string) {
    setSelectedTreatmentId(id);
  }

  function closeQuickView() {
    setSelectedTreatmentId(null);
  }

  function applyFilters(
    nextFilter: TreatmentListFilter,
    nextDate: TreatmentDateFilter,
    nextQuery: string,
  ) {
    setFilter(nextFilter);
    setDateFilter(nextDate);
    setQuery(nextQuery);
    const nextVisible = filterTreatmentItems(
      items,
      nextFilter,
      nextQuery,
      nextDate,
      now,
    );
    if (
      shouldResetTreatmentSelection({
        selectedId: selectedTreatmentId,
        visibleItems: nextVisible,
      })
    ) {
      setSelectedTreatmentId(null);
    }
  }

  function handleRowKeyDown(
    event: KeyboardEvent<HTMLElement>,
    treatmentId: string,
  ) {
    if (!isTreatmentRowKeyboardActivation(event.key)) return;
    event.preventDefault();
    selectTreatment(treatmentId);
  }

  const selectedCustomer = selectedTreatment
    ? customers.find((item) => item.id === selectedTreatment.customerId) ?? null
    : null;

  return (
    <div
      data-treatment-workspace
      data-has-quickview={showQuickView ? "true" : "false"}
      className="min-w-0"
    >
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">
            {PLATFORM_NAME}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            療程紀錄
          </h1>
          <p className="text-sm text-secondary-text">
            草稿區與已完成療程 · 繼續編輯或前往結帳
          </p>
        </div>
        <Link href="/staff/treatments/new" className="shrink-0">
          <Button
            className="h-9 min-h-9 rounded-full px-4 text-[13px]"
            onClick={closeQuickView}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            新增療程
          </Button>
        </Link>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 min-[1200px]:grid-cols-4 min-[1200px]:gap-3">
        <TreatmentSummaryCard
          label="今日療程"
          value={isClient ? summary.today : "—"}
        />
        <TreatmentSummaryCard
          label="進行中"
          value={isClient ? summary.inProgress : "—"}
          accent="primary"
        />
        <TreatmentSummaryCard
          label="待完成紀錄"
          value={isClient ? summary.incompleteRecords : "—"}
          accent="warning"
        />
        <TreatmentSummaryCard
          label="已完成"
          value={isClient ? summary.completedToday : "—"}
          accent="success"
        />
      </section>

      <div
        className={cn(
          "flex items-start",
          showQuickView ? "min-[1200px]:gap-[16px]" : "",
        )}
      >
        <div className="min-w-0 flex-1">
          <div
            data-treatment-toolbar
            className="mb-3 rounded-2xl border border-border bg-surface px-3 py-2.5"
          >
            <div className="flex flex-col gap-2 min-[720px]:flex-row min-[720px]:items-center min-[720px]:justify-between">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-treatment-filter={item.id}
                    onClick={() => applyFilters(item.id, dateFilter, query)}
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
                    onChange={(e) =>
                      applyFilters(filter, dateFilter, e.target.value)
                    }
                    placeholder="搜尋客戶、服務、員工"
                    className="h-10 min-h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[14px] text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
                    aria-label="搜尋療程"
                  />
                </div>
                <div className="flex shrink-0 gap-1">
                  {DATE_FILTERS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-treatment-date={item.id}
                      onClick={() => applyFilters(filter, item.id, query)}
                      className={cn(
                        "h-8 min-h-8 rounded-full px-2.5 text-[12px] font-medium transition-colors",
                        dateFilter === item.id
                          ? "bg-primary text-white"
                          : "bg-[#F6F1EE] text-text hover:bg-primary-light",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {!isClient ? (
            <ListSkeleton />
          ) : visible.length === 0 ? (
            <TreatmentEmptyState
              emptyState={emptyState}
              onShowCompleted={() => applyFilters("completed", dateFilter, "")}
            />
          ) : (
            <>
              <div
                data-treatment-table
                className="hidden overflow-hidden rounded-2xl border border-border bg-surface min-[1200px]:block"
              >
                <div className="grid grid-cols-[80px_minmax(180px,1.3fr)_minmax(140px,1fr)_130px_minmax(160px,1fr)_150px_32px] bg-[#FAF7F5] px-4 py-2.5 text-[12px] text-[#7A7272]">
                  <span>時間</span>
                  <span>客戶</span>
                  <span>服務項目</span>
                  <span>美容師</span>
                  <span>紀錄完成度</span>
                  <span>狀態</span>
                  <span className="sr-only">開啟</span>
                </div>
                {visible.map((item) => (
                  <TreatmentDesktopRow
                    key={item.id}
                    item={item}
                    selected={selectedTreatmentId === item.id}
                    onSelect={selectTreatment}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>

              <div className="space-y-2.5 min-[1200px]:hidden">
                {visible.map((item) => (
                  <TreatmentMobileCard
                    key={item.id}
                    item={item}
                    selected={selectedTreatmentId === item.id}
                    onSelect={selectTreatment}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {showQuickView && selectedTreatment ? (
          <div className="hidden min-[1200px]:block">
            <TreatmentQuickView
              key={selectedTreatment.id}
              item={selectedTreatment}
              customer={selectedCustomer}
              catalog={catalog}
              completedTreatments={completedTreatments}
              organizationId={organization.id}
              onClose={closeQuickView}
            />
          </div>
        ) : null}
      </div>

      {showQuickView && selectedTreatment ? (
        <div className="min-[1200px]:hidden">
          <TreatmentQuickView
            key={selectedTreatment.id}
            item={selectedTreatment}
            customer={selectedCustomer}
            catalog={catalog}
            completedTreatments={completedTreatments}
            organizationId={organization.id}
            onClose={closeQuickView}
          />
        </div>
      ) : null}
    </div>
  );
}

function TreatmentEmptyState({
  emptyState,
  onShowCompleted,
}: {
  emptyState: ReturnType<typeof deriveTreatmentEmptyState>;
  onShowCompleted: () => void;
}) {
  if (!emptyState || emptyState.kind === "search") {
    return (
      <Card padding="lg" className="text-center">
        <Sparkles className="mx-auto h-10 w-10 text-primary/50" aria-hidden />
        <p className="mt-3 text-[15px] font-medium text-text">
          找不到符合搜尋條件的療程
        </p>
        <p className="mt-1 text-sm text-secondary-text">
          試試調整搜尋、狀態或日期篩選
        </p>
      </Card>
    );
  }

  if (emptyState.kind === "no_completed") {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-[15px] font-medium text-text">尚無已完成療程</p>
        <p className="mt-1 text-sm text-secondary-text">
          完成療程紀錄後會出現在這裡
        </p>
      </Card>
    );
  }

  if (emptyState.kind === "next_appointment") {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-[15px] font-medium text-text">
          目前沒有進行中的療程
        </p>
        <p className="mt-2 text-sm text-secondary-text">下一位客人</p>
        <p className="mt-1 text-[15px] font-medium text-text">
          {emptyState.startLabel} {emptyState.customerName} · {emptyState.serviceName}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Link href="/staff/today">
            <Button variant="secondary" className="h-9 min-h-9 rounded-full px-4 text-[13px]">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              查看今日行程
            </Button>
          </Link>
          <Link href="/staff/treatments/new">
            <Button className="h-9 min-h-9 rounded-full px-4 text-[13px]">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新增療程
            </Button>
          </Link>
        </div>
      </Card>
    );
  }

  if (emptyState.kind === "all_clear") {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-[15px] font-medium text-text">今天的療程都整理好了</p>
        <p className="mt-1 text-sm text-secondary-text">
          目前沒有進行中的療程或待完成紀錄。
        </p>
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            className="h-9 min-h-9 rounded-full px-4 text-[13px]"
            onClick={onShowCompleted}
          >
            查看已完成療程
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="lg" className="text-center">
      <p className="text-[15px] font-medium text-text">尚無療程紀錄</p>
    </Card>
  );
}

interface RowProps {
  item: TreatmentWorkspaceItem;
  selected: boolean;
  onSelect: (id: string) => void;
  onPointerDown: (event: SyntheticEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void;
}

function TreatmentSummaryCard({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: number | string;
  accent?: "default" | "primary" | "warning" | "success";
}) {
  return (
    <div className="flex h-[72px] min-h-[72px] max-h-[76px] min-w-0 flex-col justify-center rounded-2xl border border-border bg-surface px-3.5 py-2 shadow-[0_1px_1px_rgba(48,43,43,0.025)]">
      <p
        className={cn(
          "text-[26px] font-semibold leading-none tracking-tight tabular-nums",
          SUMMARY_VALUE[accent],
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[10px] leading-tight text-secondary-text">
        {label}
      </p>
    </div>
  );
}

function TreatmentDesktopRow({
  item,
  selected,
  onSelect,
  onPointerDown,
  onKeyDown,
}: RowProps) {
  const time = item.startAt ? formatHm(new Date(item.startAt)) : "—";

  return (
    <div
      data-treatment-row
      data-treatment-id={item.id}
      aria-pressed={selected}
      className={cn(
        "relative grid min-h-[80px] cursor-pointer grid-cols-[80px_minmax(180px,1.3fr)_minmax(140px,1fr)_130px_minmax(160px,1fr)_150px_32px] items-center border-b border-[#EFE8E4] px-4 last:border-b-0",
        "hover:bg-[#F7F2F0]",
        selected && "bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(item.id)}
    >
      {selected ? (
        <span
          className="pointer-events-none absolute inset-y-0 left-0 z-20 w-[3px] bg-[#C56B70]"
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        data-treatment-row-focus
        aria-label={`${item.customerName}，開啟療程摘要`}
        aria-pressed={selected}
        className="absolute inset-0 z-10 cursor-pointer rounded-none bg-transparent"
        onPointerDown={onPointerDown}
        onMouseDown={onPointerDown}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(item.id);
        }}
        onKeyDown={(event) => onKeyDown(event, item.id)}
      />
      <div className="pointer-events-none relative z-0 pr-2">
        <p className="text-[14px] font-semibold tabular-nums text-text">{time}</p>
      </div>
      <div className="pointer-events-none relative z-0 flex min-w-0 items-center gap-2.5 pr-2">
        <Avatar initials={item.customerInitials} size="sm" className="gap-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold text-text">
              {item.customerName}
            </span>
            {item.membership ? (
              <Badge
                tone={item.membership.id === "vip" ? "vip" : "new"}
                className="shrink-0 px-1.5 py-px text-[10px]"
              >
                {item.membership.id === "vip" ? (
                  <Crown className="mr-0.5 h-2.5 w-2.5" aria-hidden />
                ) : null}
                {item.membership.label}
              </Badge>
            ) : null}
          </div>
          {item.customerPhone ? (
            <p className="truncate text-[12px] text-[#6E6666]">
              {item.customerPhone}
            </p>
          ) : null}
        </div>
      </div>
      <div className="pointer-events-none relative z-0 min-w-0 pr-2">
        <p className="truncate text-[14px] font-medium text-text">{item.serviceName}</p>
        <p className="text-[12px] text-[#6E6666]">
          {item.durationMinutes ? `${item.durationMinutes} 分鐘` : ""}
          {item.serviceCategory ? (
            <span className="ml-1 rounded-full bg-[#F6F1EE] px-1.5 py-px text-[10px] text-[#7A7272]">
              {item.serviceCategory}
            </span>
          ) : null}
        </p>
      </div>
      <div className="pointer-events-none relative z-0 flex min-w-0 items-center gap-2 pr-2">
        <Avatar initials={item.staffInitials} size="sm" className="gap-0" />
        <span className="truncate text-[13px] font-medium text-text">{item.staffName}</span>
      </div>
      <div className="pointer-events-none relative z-0 pr-2">
        <ProgressDots item={item} />
      </div>
      <div className="pointer-events-none relative z-0 pr-1">
        <StatusCell item={item} />
      </div>
      <div className="pointer-events-none relative z-0 flex justify-end text-secondary-text">
        <ChevronRight className="h-4 w-4" aria-hidden />
      </div>
    </div>
  );
}

function TreatmentMobileCard({
  item,
  selected,
  onSelect,
  onPointerDown,
  onKeyDown,
}: RowProps) {
  const time = item.startAt ? formatHm(new Date(item.startAt)) : "—";

  return (
    <div
      data-treatment-row
      data-treatment-id={item.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className={cn(
        "cursor-pointer rounded-2xl border border-border bg-surface px-3.5 py-3 outline-none transition-colors",
        "hover:border-primary/30 focus-visible:bg-primary-light/30",
        selected && "border-primary/40 bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(item.id)}
      onKeyDown={(event) => onKeyDown(event, item.id)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar initials={item.customerInitials} size="sm" className="gap-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-[15px] font-semibold text-text">
                {item.customerName}
              </p>
              {item.membership ? (
                <Badge
                  tone={item.membership.id === "vip" ? "vip" : "new"}
                  className="px-1.5 py-px text-[10px]"
                >
                  {item.membership.label}
                </Badge>
              ) : null}
            </div>
            <p className="mt-0.5 text-[13px] text-[#6E6666]">
              {time} · {item.serviceName}
            </p>
            <p className="text-[12px] text-[#6E6666]">{item.staffName}</p>
          </div>
        </div>
        <StatusCell item={item} compact />
      </div>
      <div className="mt-2.5">
        <ProgressDots item={item} />
      </div>
    </div>
  );
}

function ProgressDots({ item }: { item: TreatmentWorkspaceItem }) {
  return (
    <div
      className="flex items-start gap-2.5"
      aria-label={`紀錄完成度 ${item.record.completedCount} / ${item.record.totalCount}`}
    >
      {item.record.sections.map((section) => (
        <span
          key={section.id}
          className="flex min-w-0 flex-col items-center gap-1"
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              section.complete
                ? "bg-[#7A9480]"
                : "border border-[#C9BEB8] bg-transparent",
            )}
            aria-hidden
          />
          <span
            className={cn(
              "text-[10px] leading-none",
              section.complete ? "text-text" : "text-[#7A7272]",
            )}
          >
            {section.shortLabel}
          </span>
        </span>
      ))}
    </div>
  );
}

function StatusCell({
  item,
  compact,
}: {
  item: TreatmentWorkspaceItem;
  compact?: boolean;
}) {
  return (
    <div className={cn(compact && "text-right")}>
      <span
        className={cn(
          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
          STATUS_PILL[item.status.kind],
        )}
      >
        {item.status.title}
      </span>
      <p className="mt-0.5 text-[11px] text-[#6E6666]">{item.status.detail}</p>
    </div>
  );
}
