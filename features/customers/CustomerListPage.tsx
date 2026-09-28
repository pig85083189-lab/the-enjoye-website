"use client";

import Link from "next/link";
import {
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { Crown, Plus, Search, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/appointments/StatCard";
import { CustomerQuickView } from "@/features/customers/CustomerQuickView";
import { getServicesForOrganization } from "@/data/mock-services";
import {
  getAppointmentStatusRaw,
  subscribeAppointments,
} from "@/lib/appointment-store";
import { listAppointments } from "@/lib/appointments/store";
import {
  countCustomerCrmSummary,
  deriveCustomerRelationshipStatus,
  deriveLastService,
  deriveNextAppointment,
  formatLastVisitRelative,
  isCustomerRowKeyboardActivation,
  lifecycleTags,
  membershipBadge,
  RELATIONSHIP_STATUS_LABEL,
  resolveSelectedCustomer,
  serviceInterestTags,
  shouldRenderCustomerQuickView,
  shouldResetCustomerSelection,
  type CustomerRelationshipStatus,
} from "@/lib/customers/crm-derived";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { useCrmJson, useIsClient } from "@/lib/repositories/use-crm-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { getCompletedTreatmentsForCustomer } from "@/lib/treatment-draft";
import { cn } from "@/lib/utils";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import type { Customer } from "@/types";
import {
  FILTER_OPTIONS,
  SORT_OPTIONS,
  filterCustomers,
  sortCustomers,
  type CustomerListFilter,
  type CustomerListSort,
} from "./customer-list-utils";

const STATUS_DOT: Record<CustomerRelationshipStatus, string> = {
  STABLE: "bg-[#6A8F74]",
  NEW: "bg-[#6B7C93]",
  FOLLOW_UP: "bg-[#C56B70]",
  DORMANT: "bg-[#B0A6A2]",
};

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[74px] animate-pulse rounded-2xl bg-primary-light/40" />
      ))}
    </div>
  );
}

function selectFromPointer(event: SyntheticEvent<HTMLElement>) {
  event.preventDefault();
}

export function CustomerListPage() {
  const { organization } = useOrganization();
  const isClient = useIsClient();
  const customers = useCrmJson(
    () => localCustomerRepository.list({ organizationId: organization.id }),
    [] as Customer[],
  );
  useSyncExternalStore(
    subscribeAppointments,
    getAppointmentStatusRaw,
    () => "",
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CustomerListFilter>("all");
  const [sort, setSort] = useState<CustomerListSort>("lastVisit");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );
  const [now] = useState(() => new Date());

  const appointments = isClient
    ? listAppointments({ organizationId: organization.id })
    : [];
  const catalog = useMemo(
    () => getServicesForOrganization(organization.id),
    [organization.id],
  );

  const visible = useMemo(
    () => sortCustomers(filterCustomers(customers, filter, query, now), sort),
    [customers, filter, query, sort, now],
  );
  const summary = useMemo(
    () => countCustomerCrmSummary(customers, now),
    [customers, now],
  );
  const filterCounts = useMemo(
    () => ({
      all: summary.total,
      recent: summary.recent,
      needs_follow_up: summary.needsFollowUp,
      new: summary.newCustomers,
      vip: summary.vip,
    }),
    [summary],
  );

  const selectedStillVisible = !shouldResetCustomerSelection({
    selectedId: selectedCustomerId,
    visibleCustomers: visible,
  });
  const selectedCustomer = selectedStillVisible
    ? resolveSelectedCustomer(customers, selectedCustomerId)
    : null;
  const showQuickView = shouldRenderCustomerQuickView(selectedCustomer);

  function selectCustomer(id: string) {
    setSelectedCustomerId(id);
  }

  function closeQuickView() {
    setSelectedCustomerId(null);
  }

  function handleFilter(next: CustomerListFilter) {
    setFilter(next);
    const nextVisible = filterCustomers(customers, next, query, now);
    if (
      shouldResetCustomerSelection({
        selectedId: selectedCustomerId,
        visibleCustomers: nextVisible,
      })
    ) {
      setSelectedCustomerId(null);
    }
  }

  function handleRowKeyDown(
    event: KeyboardEvent<HTMLElement>,
    customerId: string,
  ) {
    if (!isCustomerRowKeyboardActivation(event.key)) return;
    event.preventDefault();
    selectCustomer(customerId);
  }

  const selectedExtras = selectedCustomer
    ? treatmentExtras(organization.id, selectedCustomer.id)
    : [];

  return (
    <div
      data-customer-workspace
      data-has-quickview={showQuickView ? "true" : "false"}
      className="min-w-0"
    >
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">
            {PLATFORM_NAME}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            客戶管理
          </h1>
          <p className="text-sm text-secondary-text">
            管理客戶資料、諮詢紀錄與療程歷史
          </p>
        </div>
        <Link href="/staff/customers/new" className="shrink-0">
          <Button className="h-9 min-h-9 rounded-full px-4 text-[13px]">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            新增客戶
          </Button>
        </Link>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 min-[1200px]:grid-cols-4 min-[1200px]:gap-3">
        <StatCard label="全部客戶" value={isClient ? summary.total : "—"} />
        <StatCard
          label="本月新客"
          value={isClient ? summary.newThisMonth : "—"}
        />
        <StatCard
          label="需要追蹤"
          value={isClient ? summary.needsFollowUp : "—"}
          accent="warning"
        />
        <StatCard
          label="VIP 客戶"
          value={isClient ? summary.vip : "—"}
          accent="primary"
        />
      </section>

      <div
        className={cn(
          "flex items-start",
          showQuickView ? "min-[1200px]:gap-4" : "",
        )}
      >
        <div className="min-w-0 flex-1">
          <div
            data-customer-toolbar
            className="mb-3 rounded-2xl border border-border bg-surface px-3 py-2.5"
          >
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary-text"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜尋姓名、手機號碼"
                className="h-10 min-h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[14px] text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
                aria-label="搜尋客戶"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {FILTER_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleFilter(item.id)}
                    className={cn(
                      "h-8 min-h-8 shrink-0 rounded-full px-3 text-[12px] font-medium transition-colors",
                      filter === item.id
                        ? "bg-primary text-white"
                        : "bg-[#F6F1EE] text-text hover:bg-primary-light",
                    )}
                  >
                    {item.label} {isClient ? filterCounts[item.id] : ""}
                  </button>
                ))}
              </div>
              <label className="ml-auto flex h-8 items-center gap-1.5 text-[12px] text-secondary-text">
                排序
                <select
                  value={sort}
                  onChange={(e) =>
                    setSort(e.target.value as CustomerListSort)
                  }
                  className="h-8 min-h-8 rounded-full border border-border bg-surface px-2.5 text-[12px] text-text outline-none"
                >
                  {SORT_OPTIONS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {!isClient ? (
            <ListSkeleton />
          ) : visible.length === 0 ? (
            <Card padding="lg" className="text-center">
              <Users className="mx-auto h-10 w-10 text-primary/50" aria-hidden />
              <p className="mt-3 text-[15px] font-medium text-text">
                {query || filter !== "all" ? "找不到符合的客戶" : "尚無客戶資料"}
              </p>
              <p className="mt-1 text-sm text-secondary-text">
                {query || filter !== "all"
                  ? "試試調整搜尋或篩選條件"
                  : "點右上角新增第一位客戶"}
              </p>
            </Card>
          ) : (
            <>
              <div
                data-customer-table
                className="hidden overflow-hidden rounded-2xl border border-border bg-surface min-[1200px]:block"
              >
                <table className="w-full table-fixed text-left text-[13px]">
                  <colgroup>
                    <col className="w-[210px]" />
                    <col />
                    <col className="w-[118px]" />
                    <col className="w-[118px]" />
                    <col className="w-[96px]" />
                    <col className="w-[88px]" />
                  </colgroup>
                  <thead className="bg-[#FAF7F5] text-[12px] text-secondary-text">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">客戶</th>
                      <th className="px-3 py-2.5 font-medium">最近服務</th>
                      <th className="px-3 py-2.5 font-medium">最近到店</th>
                      <th className="px-3 py-2.5 font-medium">下次預約</th>
                      <th className="px-3 py-2.5 font-medium">負責美容師</th>
                      <th className="px-3 py-2.5 font-medium">狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((customer) => (
                      <CustomerTableRow
                        key={customer.id}
                        customer={customer}
                        appointments={appointments}
                        catalog={catalog}
                        now={now}
                        selected={selectedCustomerId === customer.id}
                        onSelect={selectCustomer}
                        onPointerDown={selectFromPointer}
                        onKeyDown={handleRowKeyDown}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2.5 min-[1200px]:hidden">
                {visible.map((customer) => (
                  <CustomerMobileCard
                    key={customer.id}
                    customer={customer}
                    appointments={appointments}
                    catalog={catalog}
                    now={now}
                    selected={selectedCustomerId === customer.id}
                    onSelect={selectCustomer}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {showQuickView && selectedCustomer ? (
          <div className="hidden min-[1200px]:block">
            <CustomerQuickView
              key={selectedCustomer.id}
              customer={selectedCustomer}
              appointments={appointments}
              catalog={catalog}
              now={now}
              extras={selectedExtras}
              onClose={closeQuickView}
            />
          </div>
        ) : null}
      </div>

      {showQuickView && selectedCustomer ? (
        <div className="min-[1200px]:hidden">
          <CustomerQuickView
            key={selectedCustomer.id}
            customer={selectedCustomer}
            appointments={appointments}
            catalog={catalog}
            now={now}
            extras={selectedExtras}
            onClose={closeQuickView}
          />
        </div>
      ) : null}
    </div>
  );
}

function treatmentExtras(organizationId: string, customerId: string): string[] {
  if (typeof window === "undefined") return [];
  const latest = getCompletedTreatmentsForCustomer(organizationId, customerId)[0];
  if (!latest) return [];
  return [
    latest.professionalNote,
    latest.followUp.note,
    ...latest.followUp.tags,
    latest.discomfortNote,
  ];
}

interface RowProps {
  customer: Customer;
  appointments: ReturnType<typeof listAppointments>;
  catalog: ReturnType<typeof getServicesForOrganization>;
  now: Date;
  selected: boolean;
  onSelect: (id: string) => void;
  onPointerDown: (event: SyntheticEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void;
}

function CustomerTableRow({
  customer,
  appointments,
  catalog,
  now,
  selected,
  onSelect,
  onPointerDown,
  onKeyDown,
}: RowProps) {
  const lastService = deriveLastService({ customer, appointments, catalog });
  const lastVisit = formatLastVisitRelative(customer.lastVisit, now);
  const next = deriveNextAppointment({ customer, appointments, now });
  const status = deriveCustomerRelationshipStatus(customer, now);
  const membership = membershipBadge(customer);
  const interest = serviceInterestTags(customer);
  const lifecycle = lifecycleTags(customer).filter((tag) => tag.id === "regular");

  return (
    <tr
      data-customer-row
      data-customer-id={customer.id}
      aria-pressed={selected}
      className={cn(
        "min-h-[76px] cursor-pointer border-b border-[#EFE8E4] last:border-b-0",
        "hover:bg-primary-light/25",
        selected && "bg-primary-light/40",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(customer.id)}
    >
      <td className="relative px-4 py-2.5 align-middle">
        <button
          type="button"
          data-customer-row-focus
          aria-label={`${customer.name}，開啟客戶摘要`}
          aria-pressed={selected}
          className="absolute inset-0 z-10 cursor-pointer rounded-none bg-transparent"
          onPointerDown={onPointerDown}
          onMouseDown={onPointerDown}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(customer.id);
          }}
          onKeyDown={(event) => onKeyDown(event, customer.id)}
        />
        <div className="pointer-events-none relative z-0 flex items-center gap-2.5">
          <Avatar initials={customer.name.slice(0, 1)} size="sm" className="gap-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="whitespace-nowrap text-[14px] font-semibold text-text">
                {customer.name}
              </span>
              {membership ? (
                <Badge
                  tone={membership.id === "vip" ? "vip" : "new"}
                  className="shrink-0 px-1.5 py-px text-[10px]"
                >
                  {membership.id === "vip" ? (
                    <Crown className="mr-0.5 h-2.5 w-2.5" aria-hidden />
                  ) : null}
                  {membership.label}
                </Badge>
              ) : null}
            </div>
            <p className="whitespace-nowrap text-[12px] text-secondary-text">
              {customer.phone}
            </p>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {lifecycle.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-full bg-[#F6F1EE] px-1.5 py-px text-[10px] text-secondary-text"
                >
                  {tag.label}
                </span>
              ))}
              {interest.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-full bg-[#F6F1EE] px-1.5 py-px text-[10px] text-secondary-text"
                >
                  {tag.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 align-middle">
        {lastService ? (
          <div>
            <p className="font-medium text-text">{lastService.serviceName}</p>
            {lastService.durationMinutes ? (
              <p className="text-[12px] text-secondary-text">
                {lastService.durationMinutes} 分鐘
              </p>
            ) : null}
          </div>
        ) : (
          <span className="text-secondary-text">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 align-middle">
        {lastVisit.dateLabel ? (
          <div>
            <p className="whitespace-nowrap font-medium text-text">
              {lastVisit.dateLabel}
            </p>
            {lastVisit.relativeLabel ? (
              <p className="text-[12px] text-secondary-text">
                {lastVisit.relativeLabel}
              </p>
            ) : null}
          </div>
        ) : (
          <span className="text-secondary-text">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 align-middle">
        {next ? (
          <div>
            <p className="whitespace-nowrap font-medium text-text">
              {next.dateLabel}
            </p>
            <p className="text-[12px] text-secondary-text">{next.timeLabel}</p>
          </div>
        ) : (
          <span className="text-secondary-text">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 align-middle text-text">
        {customer.primaryStaffName ?? "—"}
      </td>
      <td className="px-3 py-2.5 align-middle">
        <span className="inline-flex items-center gap-1.5 font-medium text-text">
          <span
            className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])}
            aria-hidden
          />
          {RELATIONSHIP_STATUS_LABEL[status]}
        </span>
      </td>
    </tr>
  );
}

function CustomerMobileCard({
  customer,
  appointments,
  catalog,
  now,
  selected,
  onSelect,
  onPointerDown,
  onKeyDown,
}: RowProps) {
  const lastService = deriveLastService({ customer, appointments, catalog });
  const next = deriveNextAppointment({ customer, appointments, now });
  const status = deriveCustomerRelationshipStatus(customer, now);
  const membership = membershipBadge(customer);

  return (
    <div
      data-customer-row
      data-customer-id={customer.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className={cn(
        "cursor-pointer rounded-2xl border border-border bg-surface px-3.5 py-3 outline-none transition-colors",
        "hover:border-primary/30 focus-visible:bg-primary-light/30",
        selected && "border-primary/40 bg-primary-light/30",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(customer.id)}
      onKeyDown={(event) => onKeyDown(event, customer.id)}
    >
      <div className="flex items-start gap-3">
        <Avatar initials={customer.name.slice(0, 1)} size="sm" className="gap-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="whitespace-nowrap text-[15px] font-semibold text-text">
                {customer.name}
              </p>
              {membership ? (
                <Badge
                  tone={membership.id === "vip" ? "vip" : "new"}
                  className="px-1.5 py-px text-[10px]"
                >
                  {membership.label}
                </Badge>
              ) : null}
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-text">
              <span
                className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])}
                aria-hidden
              />
              {RELATIONSHIP_STATUS_LABEL[status]}
            </span>
          </div>
          <p className="mt-0.5 whitespace-nowrap text-[13px] text-secondary-text">
            {customer.phone}
          </p>
          <p className="mt-1.5 text-[12px] text-secondary-text">
            最近：{lastService?.serviceName ?? "—"}
          </p>
          <p className="text-[12px] text-secondary-text">
            下次：
            {next ? `${compactDate(next.dateLabel)} ${next.timeLabel}` : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

function compactDate(slashDate: string): string {
  const parts = slashDate.split("/");
  if (parts.length !== 3) return slashDate;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}
