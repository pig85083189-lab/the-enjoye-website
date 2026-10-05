"use client";

import {
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronRight,
  Crown,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CheckoutPanel } from "@/features/checkout/CheckoutPanel";
import { CommerceIdentityPanel } from "@/features/checkout/CommerceIdentityPanel";
import {
  candidatesFromRemoteListState,
  useCommerceRemoteCheckoutCandidate,
  useCommerceRemoteCheckoutCandidates,
} from "@/features/checkout/use-commerce-remote-read";
import { getServicesForOrganization } from "@/data/mock-services";
import { formatHm } from "@/lib/appointments/domain";
import {
  getAppointmentStatusRaw,
  subscribeAppointments,
} from "@/lib/appointment-store";
import { listAppointments } from "@/lib/appointments/store";
import {
  createCheckoutFromAppointment,
  createEmptyCheckoutDraft,
  getCommerceRevision,
  getOpenDraftForAppointment,
  listCheckoutDrafts,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { formatTwd } from "@/lib/commerce/money";
import { listTransactions } from "@/lib/commerce/transaction-store";
import {
  CHECKOUT_WORKSPACE_GAP_PX,
  buildCheckoutWorkspaceItems,
  buildRemoteCommerceCheckoutItems,
  checkoutRowId,
  countCheckoutSummary,
  countRemoteCommerceCheckoutSummary,
  filterCheckoutItems,
  isCheckoutRowKeyboardActivation,
  remapCheckoutSelection,
  resolveSelectedCheckout,
  shouldRenderCheckoutPanel,
  shouldResetCheckoutSelection,
  type CheckoutDateFilter,
  type CheckoutListFilter,
  type CheckoutWorkspaceItem,
} from "@/lib/commerce/checkout-workspace-derived";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { useCrmJson, useIsClient } from "@/lib/repositories/use-crm-store";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types";

const FILTERS: Array<{ id: CheckoutListFilter; label: string }> = [
  { id: "pending", label: "待結帳" },
  { id: "paid", label: "已結帳" },
  { id: "all", label: "全部" },
];

const DATE_FILTERS: Array<{ id: CheckoutDateFilter; label: string }> = [
  { id: "today", label: "今天" },
  { id: "7d", label: "最近 7 天" },
  { id: "all", label: "全部" },
];

const STATUS_PILL: Record<CheckoutWorkspaceItem["status"]["kind"], string> = {
  pending: "bg-[#F3E6E5] text-[#C56B70]",
  paid: "bg-[#E7F0EA] text-[#5C7F66]",
  in_service: "bg-[#F6EDE0] text-[#C08A3E]",
  other: "bg-[#F1EEEC] text-[#7A7272]",
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
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-[80px] animate-pulse rounded-2xl bg-primary-light/40" />
      ))}
    </div>
  );
}

function selectFromPointer(event: SyntheticEvent<HTMLElement>) {
  event.preventDefault();
}

export function CheckoutPageClient({
  commerceRemoteReadPilot = false,
}: {
  commerceRemoteReadPilot?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization, currentLocation, locations, membership } = useOrganization();
  const isClient = useIsClient();
  const appointmentRev = useSyncExternalStore(
    subscribeAppointments,
    getAppointmentStatusRaw,
    () => "",
  );
  const commerceRev = useSyncExternalStore(
    subscribeCommerce,
    getCommerceRevision,
    () => "",
  );

  const locationId = currentLocation?.id ?? locations[0]?.id ?? "";
  const staffId = membership?.userId ?? "";
  const checkoutAllowed = canCheckout(membership);
  const remoteReadEnabled = commerceRemoteReadPilot && checkoutAllowed;
  const appointmentIdParam = searchParams.get("appointment");
  const draftIdParam = searchParams.get("draft");
  const treatmentIdParam = searchParams.get("treatment");
  const packageIdParam = searchParams.get("package");

  const [filter, setFilter] = useState<CheckoutListFilter>("pending");
  const [dateFilter, setDateFilter] = useState<CheckoutDateFilter>(() =>
    appointmentIdParam || commerceRemoteReadPilot ? "all" : "today",
  );
  const [query, setQuery] = useState("");
  const [selectedCheckoutId, setSelectedCheckoutId] = useState<string | null>(() => {
    if (appointmentIdParam) return checkoutRowId("appointment", appointmentIdParam);
    if (draftIdParam) return checkoutRowId("draft", draftIdParam);
    return null;
  });
  const [now] = useState(() => new Date());
  const [error, setError] = useState("");
  const [generalSaleOpen, setGeneralSaleOpen] = useState(false);
  const [saleQuery, setSaleQuery] = useState("");

  const remoteListState = useCommerceRemoteCheckoutCandidates({
    organizationId: organization.id,
    locationId: currentLocation?.id,
    actor: membership,
    enabled: remoteReadEnabled,
  });
  const remoteDetailState = useCommerceRemoteCheckoutCandidate({
    organizationId: organization.id,
    appointmentId: appointmentIdParam,
    treatmentId: treatmentIdParam,
    actor: membership,
    enabled: remoteReadEnabled,
  });
  const remoteCandidates = useMemo(() => {
    const listed = candidatesFromRemoteListState(remoteListState);
    if (remoteDetailState.status !== "data") return listed;
    if (listed.some((row) => row.identity.appointmentId === remoteDetailState.value.identity.appointmentId)) {
      return listed;
    }
    return [...listed, remoteDetailState.value];
  }, [remoteDetailState, remoteListState]);

  const customers = useCrmJson(
    () =>
      commerceRemoteReadPilot
        ? ([] as Customer[])
        : localCustomerRepository.list({ organizationId: organization.id }),
    [] as Customer[],
  );
  const catalog = useMemo(() => {
    void commerceRev;
    if (commerceRemoteReadPilot) return [];
    return getServicesForOrganization(organization.id);
  }, [commerceRev, commerceRemoteReadPilot, organization.id]);

  const appointments = useMemo(() => {
    void appointmentRev;
    if (!isClient || commerceRemoteReadPilot) return [];
    return listAppointments({
      organizationId: organization.id,
      locationId: currentLocation?.id,
    });
  }, [appointmentRev, commerceRemoteReadPilot, currentLocation?.id, isClient, organization.id]);

  const items = useMemo(() => {
    void commerceRev;
    if (!isClient) return [];
    if (commerceRemoteReadPilot) {
      return buildRemoteCommerceCheckoutItems(remoteCandidates, currentLocation?.id);
    }
    const openDrafts = [
      ...listCheckoutDrafts(organization.id, { status: "OPEN" }),
      ...listCheckoutDrafts(organization.id, { status: "READY" }),
    ];
    return buildCheckoutWorkspaceItems({
      appointments,
      transactions: listTransactions(organization.id, {
        locationId: currentLocation?.id,
        status: "COMPLETED",
      }),
      openDrafts,
      customers,
      catalog,
      locationId: currentLocation?.id,
    });
  }, [
    appointments,
    catalog,
    commerceRemoteReadPilot,
    currentLocation?.id,
    customers,
    isClient,
    organization.id,
    commerceRev,
    remoteCandidates,
  ]);

  const visible = useMemo(
    () => filterCheckoutItems(items, filter, query, dateFilter, now),
    [dateFilter, filter, items, now, query],
  );
  const summary = useMemo(
    () =>
      commerceRemoteReadPilot
        ? countRemoteCommerceCheckoutSummary(items)
        : countCheckoutSummary(items, appointments, now),
    [appointments, commerceRemoteReadPilot, items, now],
  );

  const remappedSelectedId = remapCheckoutSelection(items, selectedCheckoutId);
  const selectedStillVisible = !shouldResetCheckoutSelection({
    selectedId: remappedSelectedId,
    visibleItems: visible,
  });
  const selectedItem = selectedStillVisible
    ? resolveSelectedCheckout(items, remappedSelectedId)
    : null;
  const showPanel = shouldRenderCheckoutPanel(selectedItem);
  const selectedCustomer = selectedItem
    ? customers.find((row) => row.id === selectedItem.customerId) ?? null
    : null;
  const selectedRemoteCandidate = selectedItem
    ? remoteCandidates.find(
        (row) => row.identity.appointmentId === selectedItem.appointmentId,
      ) ?? (remoteDetailState.status === "data" ? remoteDetailState.value : null)
    : null;

  function ensureAppointmentDraft(appointmentId: string) {
    if (!appointmentId || commerceRemoteReadPilot) return;
    if (!checkoutAllowed) {
      setError("沒有權限結帳");
      return;
    }
    try {
      const existing = getOpenDraftForAppointment(organization.id, appointmentId);
      if (existing) return;
      createCheckoutFromAppointment(organization.id, {
        appointmentId,
        createdByStaffId: staffId,
        treatmentId: treatmentIdParam ?? undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法建立結帳草稿");
    }
  }

  function selectCheckout(id: string) {
    setSelectedCheckoutId(id);
    const item = items.find((row) => row.id === id);
    if (item?.kind === "appointment" && !item.paid && !item.draftId) {
      ensureAppointmentDraft(item.appointmentId);
    }
  }

  function closePanel() {
    setSelectedCheckoutId(null);
  }

  function applyFilters(
    nextFilter: CheckoutListFilter,
    nextDate: CheckoutDateFilter,
    nextQuery: string,
  ) {
    setFilter(nextFilter);
    setDateFilter(nextDate);
    setQuery(nextQuery);
    const nextVisible = filterCheckoutItems(
      items,
      nextFilter,
      nextQuery,
      nextDate,
      now,
    );
    if (
      shouldResetCheckoutSelection({
        selectedId: remappedSelectedId,
        visibleItems: nextVisible,
      })
    ) {
      setSelectedCheckoutId(null);
    }
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, id: string) {
    if (!isCheckoutRowKeyboardActivation(event.key)) return;
    event.preventDefault();
    selectCheckout(id);
  }

  function startGeneralSale(customerId: string) {
    setError("");
    if (commerceRemoteReadPilot) return;
    if (!checkoutAllowed) {
      setError("沒有權限結帳");
      return;
    }
    if (!locationId) {
      setError("請先選擇可存取的分店");
      return;
    }
    try {
      const draft = createEmptyCheckoutDraft(organization.id, {
        locationId,
        customerId,
        createdByStaffId: staffId,
      });
      setGeneralSaleOpen(false);
      setSaleQuery("");
      setFilter("pending");
      setSelectedCheckoutId(checkoutRowId("draft", draft.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法建立一般銷售");
    }
  }

  const saleCustomers = customers.filter((row) => {
    const q = saleQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      row.name.toLowerCase().includes(q) ||
      row.phone.toLowerCase().includes(q)
    );
  });

  return (
    <div
      data-checkout-workspace
      data-has-panel={showPanel ? "true" : "false"}
      className="min-w-0"
    >
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">
            {PLATFORM_NAME}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            結帳
          </h1>
          <p className="text-sm text-secondary-text">
            {commerceRemoteReadPilot
              ? "顯示已完成療程的待結帳身分，此階段不收款"
              : "處理今日待結帳的預約、一般銷售與收款"}
          </p>
          {!checkoutAllowed ? (
            <p className="text-[13px] text-[#B07A4A]" role="alert">
              沒有權限結帳
            </p>
          ) : null}
        </div>
        {commerceRemoteReadPilot ? null : (
        <Button
          className="h-9 min-h-9 shrink-0 rounded-full px-4 text-[13px]"
          disabled={!checkoutAllowed}
          onClick={() => {
            closePanel();
            setGeneralSaleOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          一般銷售
        </Button>
        )}
      </header>

      {error ? (
        <p className="mb-3 text-sm text-[#B07A4A]" role="alert">
          {error}
        </p>
      ) : null}

      <section className="mb-4 grid grid-cols-2 gap-2 min-[1200px]:grid-cols-4 min-[1200px]:gap-3">
        <CheckoutSummaryCard
          label="待結帳"
          value={isClient ? summary.pending : "—"}
          accent="primary"
        />
        <CheckoutSummaryCard
          label="服務完成"
          value={isClient ? summary.completedService : "—"}
        />
        <CheckoutSummaryCard
          label="服務中"
          value={isClient ? summary.inService : "—"}
          accent="warning"
        />
        <CheckoutSummaryCard
          label="今日實收"
          value={isClient ? formatTwd(summary.todayRevenueMinor) : "—"}
          accent="success"
        />
      </section>

      <div
        data-checkout-workspace-split
        data-checkout-gap={showPanel ? CHECKOUT_WORKSPACE_GAP_PX : 0}
        className={cn("flex items-start", showPanel && "min-[1200px]:gap-4")}
      >
        <div className="min-w-0 flex-1">
          <div
            data-checkout-toolbar
            className="mb-3 rounded-2xl border border-border bg-surface px-3 py-2.5"
          >
            <div className="flex flex-col gap-2 min-[720px]:flex-row min-[720px]:items-center min-[720px]:justify-between">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {FILTERS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    data-checkout-filter={entry.id}
                    onClick={() => applyFilters(entry.id, dateFilter, query)}
                    className={cn(
                      "h-8 min-h-8 shrink-0 rounded-full px-3 text-[12px] font-medium transition-colors",
                      filter === entry.id
                        ? "bg-primary text-white"
                        : "bg-[#F6F1EE] text-text hover:bg-primary-light",
                    )}
                  >
                    {entry.label}
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
                    onChange={(event) =>
                      applyFilters(filter, dateFilter, event.target.value)
                    }
                    placeholder="搜尋客戶 / 服務 / 美容師"
                    className="h-10 min-h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[14px] text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
                    aria-label="搜尋客戶、服務或美容師"
                  />
                </div>
                <div className="flex shrink-0 gap-1">
                  {DATE_FILTERS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      data-checkout-date={entry.id}
                      onClick={() => applyFilters(filter, entry.id, query)}
                      className={cn(
                        "h-8 min-h-8 rounded-full px-2.5 text-[12px] font-medium transition-colors",
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
          </div>

          {!isClient || (remoteReadEnabled && remoteListState.status === "loading") ? (
            <ListSkeleton />
          ) : remoteReadEnabled && remoteListState.status === "error" ? (
            <Card padding="lg" className="text-center">
              <p className="text-[15px] font-medium text-text">無法讀取待結帳資料</p>
              <p className="mt-1 text-sm text-secondary-text">{remoteListState.message}</p>
            </Card>
          ) : visible.length === 0 ? (
            <Card padding="lg" className="text-center">
              <Sparkles className="mx-auto h-10 w-10 text-primary/50" aria-hidden />
              <p className="mt-3 text-[15px] font-medium text-text">
                {query
                  ? "找不到符合條件的結帳項目"
                  : filter === "paid"
                    ? "目前沒有已結帳紀錄"
                    : "目前沒有待結帳項目"}
              </p>
              <p className="mt-1 text-sm text-secondary-text">
                {query
                  ? "試試調整搜尋、狀態或日期篩選"
                  : filter === "paid"
                    ? "完成收款後，今日交易會出現在這裡"
                    : commerceRemoteReadPilot
                      ? "完成療程後，待結帳項目會出現在這裡"
                      : "可從右上角開始一般銷售，或查看已結帳紀錄"}
              </p>
            </Card>
          ) : (
            <>
              <div
                data-checkout-table
                className="hidden overflow-hidden rounded-2xl border border-border bg-surface min-[1200px]:block"
              >
                <div className="grid grid-cols-[80px_minmax(180px,1.3fr)_minmax(140px,1fr)_130px_110px_110px_32px] bg-[#FAF7F5] px-4 py-2.5 text-[12px] text-[#7A7272]">
                  <span>時間</span>
                  <span>客戶</span>
                  <span>服務項目</span>
                  <span>美容師</span>
                  <span>金額</span>
                  <span>狀態</span>
                  <span className="sr-only">開啟</span>
                </div>
                {visible.map((item) => (
                  <CheckoutDesktopRow
                    key={item.id}
                    item={item}
                    selected={remappedSelectedId === item.id}
                    onSelect={selectCheckout}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>

              <div className="space-y-2.5 min-[1200px]:hidden">
                {visible.map((item) => (
                  <CheckoutMobileCard
                    key={item.id}
                    item={item}
                    selected={remappedSelectedId === item.id}
                    onSelect={selectCheckout}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {showPanel && selectedItem ? (
          <div className="hidden min-[1200px]:block">
            {commerceRemoteReadPilot && selectedRemoteCandidate ? (
              <CommerceIdentityPanel
                key={selectedItem.id}
                candidate={selectedRemoteCandidate}
                locationName={
                  locations.find((row) => row.id === selectedRemoteCandidate.locationId)?.name ??
                  currentLocation?.name
                }
                onClose={closePanel}
              />
            ) : commerceRemoteReadPilot ? null : (
            <CheckoutPanel
              key={selectedItem.id}
              item={selectedItem}
              customer={selectedCustomer}
              organizationId={organization.id}
              staffId={staffId}
              treatmentId={treatmentIdParam}
              preselectedPackageId={packageIdParam}
              onClose={closePanel}
              onCompleted={(txId) => router.push(`/staff/transactions?id=${txId}`)}
            />
            )}
          </div>
        ) : null}
      </div>

      {showPanel && selectedItem ? (
        <div className="min-[1200px]:hidden">
          {commerceRemoteReadPilot && selectedRemoteCandidate ? (
            <CommerceIdentityPanel
              key={selectedItem.id}
              candidate={selectedRemoteCandidate}
              locationName={
                locations.find((row) => row.id === selectedRemoteCandidate.locationId)?.name ??
                currentLocation?.name
              }
              onClose={closePanel}
            />
          ) : commerceRemoteReadPilot ? null : (
          <CheckoutPanel
            key={selectedItem.id}
            item={selectedItem}
            customer={selectedCustomer}
            organizationId={organization.id}
            staffId={staffId}
            treatmentId={treatmentIdParam}
            preselectedPackageId={packageIdParam}
            onClose={closePanel}
            onCompleted={(txId) => router.push(`/staff/transactions?id=${txId}`)}
          />
          )}
        </div>
      ) : null}

      {commerceRemoteReadPilot ? null : generalSaleOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-text/30 p-0 min-[720px]:items-center min-[720px]:p-6">
          <div
            data-checkout-general-sale
            role="dialog"
            aria-modal="true"
            aria-label="一般銷售"
            className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-surface min-[720px]:rounded-2xl"
          >
            <div className="flex items-center justify-between px-5 py-3">
              <div>
                <h2 className="text-[16px] font-semibold text-text">一般銷售</h2>
                <p className="text-[12px] text-secondary-text">
                  選擇客戶後加入商品 / 服務
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-secondary-text hover:bg-primary-light/50"
                aria-label="關閉一般銷售"
                onClick={() => setGeneralSaleOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 pb-3">
              <label className="block text-[12px] text-secondary-text">
                搜尋客戶
                <input
                  className="mt-1 h-10 w-full rounded-xl border border-border px-3 text-[14px]"
                  value={saleQuery}
                  onChange={(event) => setSaleQuery(event.target.value)}
                  placeholder="姓名或電話"
                  aria-label="搜尋一般銷售客戶"
                />
              </label>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              {saleCustomers.length === 0 ? (
                <li className="px-2 py-3 text-sm text-secondary-text">尚無符合的客戶</li>
              ) : (
                saleCustomers.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="flex min-h-12 w-full items-center justify-between rounded-xl px-2 py-2 text-left hover:bg-primary-light/40"
                      onClick={() => startGeneralSale(row.id)}
                    >
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium text-text">
                          {row.name}
                        </span>
                        {row.phone ? (
                          <span className="block text-[12px] text-secondary-text">
                            {row.phone}
                          </span>
                        ) : null}
                      </span>
                      <ChevronRight className="h-4 w-4 text-secondary-text" aria-hidden />
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CheckoutSummaryCard({
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
      data-checkout-summary
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
  item: CheckoutWorkspaceItem;
  selected: boolean;
  onSelect: (id: string) => void;
  onPointerDown: (event: SyntheticEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void;
}

function CheckoutDesktopRow({
  item,
  selected,
  onSelect,
  onPointerDown,
  onKeyDown,
}: RowProps) {
  const time = item.startAt ? formatHm(new Date(item.startAt)) : "—";

  return (
    <div
      data-checkout-row
      data-checkout-id={item.id}
      aria-pressed={selected}
      className={cn(
        "relative grid min-h-[80px] cursor-pointer grid-cols-[80px_minmax(180px,1.3fr)_minmax(140px,1fr)_130px_110px_110px_32px] items-center border-b border-[#EFE8E4] px-4 last:border-b-0",
        "hover:bg-[#F7F2F0]",
        selected && "bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(item.id)}
    >
      {selected ? (
        <span
          data-checkout-row-accent
          className="pointer-events-none absolute inset-y-0 left-0 z-20 w-[3px] bg-[#C56B70]"
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        data-checkout-row-focus
        aria-label={`${item.customerName}，開啟結帳`}
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
            <p className="truncate text-[12px] text-[#6E6666]">{item.customerPhone}</p>
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
        {item.staffName ? (
          <>
            <Avatar initials={item.staffInitials} size="sm" className="gap-0" />
            <span className="truncate text-[13px] font-medium text-text">
              {item.staffName}
            </span>
          </>
        ) : (
          <span className="text-[13px] text-secondary-text">—</span>
        )}
      </div>
      <div className="pointer-events-none relative z-0 pr-2">
        <p className="text-[14px] font-semibold tabular-nums text-text">
          {item.amountMinor == null ? "—" : formatTwd(item.amountMinor)}
        </p>
      </div>
      <div className="pointer-events-none relative z-0 pr-1">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
            STATUS_PILL[item.status.kind],
          )}
        >
          {item.status.title}
        </span>
      </div>
      <div className="pointer-events-none relative z-0 flex justify-end text-secondary-text">
        <ChevronRight className="h-4 w-4" aria-hidden />
      </div>
    </div>
  );
}

function CheckoutMobileCard({
  item,
  selected,
  onSelect,
  onPointerDown,
  onKeyDown,
}: RowProps) {
  const time = item.startAt ? formatHm(new Date(item.startAt)) : "—";

  return (
    <div
      data-checkout-row
      data-checkout-id={item.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${item.customerName}，開啟結帳`}
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
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar initials={item.customerInitials} size="sm" className="gap-0" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-text">
              {item.customerName}
            </p>
            <p className="truncate text-[12px] text-[#6E6666]">
              {time} · {item.serviceName}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            STATUS_PILL[item.status.kind],
          )}
        >
          {item.status.title}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[12px] text-[#6E6666]">
        <span>{item.staffName || "一般銷售"}</span>
        <span className="font-semibold tabular-nums text-text">
          {item.amountMinor == null ? "—" : formatTwd(item.amountMinor)}
        </span>
      </div>
    </div>
  );
}
