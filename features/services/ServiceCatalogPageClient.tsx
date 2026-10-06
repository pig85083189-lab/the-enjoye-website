"use client";

import {
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ServiceFormDialog } from "@/features/services/ServiceFormDialog";
import { ServiceQuickView } from "@/features/services/ServiceQuickView";
import {
  servicesFromRemoteListState,
  useServiceRemoteList,
} from "@/features/services/use-service-remote-read";
import { listAppointments } from "@/lib/appointments/store";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { formatTwd } from "@/lib/commerce/money";
import { listTransactions } from "@/lib/commerce/transaction-store";
import { listPackageDefinitions } from "@/lib/packages/store";
import { resolveServiceCatalogMutationSurface } from "@/lib/services/service-write-surface";
import {
  SERVICE_CATALOG_FILTER_OPTIONS,
  SERVICE_CATALOG_WORKSPACE_GAP_PX,
  buildServiceCatalogRows,
  countRelatedAppointments,
  countRelatedPackagePlans,
  countRelatedServiceSales,
  countServiceCatalogSummary,
  draftFromService,
  emptyServiceCatalogDraft,
  filterServiceCatalogRows,
  isServiceRowKeyboardActivation,
  listServiceCatalogCategories,
  resolveSelectedServiceRow,
  serviceCatalogEmptyCopy,
  shouldRenderServiceQuickView,
  shouldResetServiceCatalogSelection,
  canManageServices,
  type ServiceCatalogListFilter,
  type ServiceCatalogWorkspaceRow,
} from "@/lib/services/service-catalog-derived";
import {
  deactivateService,
  getServicesForOrganization,
  reactivateService,
} from "@/lib/services/store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import { useIsClient } from "@/lib/repositories/use-crm-store";
import { cn } from "@/lib/utils";

const SUMMARY_VALUE = {
  default: "text-text",
  primary: "text-primary",
  warning: "text-[#C4A06A]",
  success: "text-[#5C7F66]",
} as const;

function selectFromPointer(event: SyntheticEvent<HTMLElement>) {
  event.preventDefault();
}

export function ServiceCatalogPageClient({
  remoteReadPilot = false,
  remoteWritePilot = false,
}: {
  remoteReadPilot?: boolean;
  remoteWritePilot?: boolean;
}) {
  const { organization, membership } = useOrganization();
  const isClient = useIsClient();
  const commerceRev = useSyncExternalStore(
    subscribeCommerce,
    getCommerceRevision,
    () => "",
  );

  const staffId = membership?.userId ?? "";
  const canManage = canManageServices(membership?.role);
  const mutation = resolveServiceCatalogMutationSurface({
    canManage,
    remoteReadPilot,
    remoteWritePilot,
  });
  const remote = useServiceRemoteList(organization.id, remoteReadPilot);

  const [filters, setFilters] = useState<{
    status: ServiceCatalogListFilter;
    category: string;
    query: string;
  }>({
    status: "all",
    category: "",
    query: "",
  });
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [actionError, setActionError] = useState("");

  const services = useMemo(() => {
    void commerceRev;
    if (remoteReadPilot) return servicesFromRemoteListState(remote);
    if (!isClient) return [];
    return getServicesForOrganization(organization.id);
  }, [commerceRev, isClient, organization.id, remote, remoteReadPilot]);

  const rows = useMemo(() => buildServiceCatalogRows(services), [services]);
  const categories = useMemo(() => listServiceCatalogCategories(rows), [rows]);
  const visible = useMemo(
    () => filterServiceCatalogRows(rows, filters),
    [filters, rows],
  );
  const summary = useMemo(() => countServiceCatalogSummary(rows), [rows]);

  const selectedStillVisible = !shouldResetServiceCatalogSelection({
    selectedServiceId,
    visibleRows: visible,
  });
  const selectedRow = selectedStillVisible
    ? resolveSelectedServiceRow(rows, selectedServiceId)
    : null;
  const showQuickView = shouldRenderServiceQuickView(selectedRow);

  const appointmentServiceIds = useMemo(() => {
    void commerceRev;
    if (!isClient) return [] as string[];
    return listAppointments({ organizationId: organization.id }).map(
      (item) => item.serviceId,
    );
  }, [commerceRev, isClient, organization.id]);

  const packageServiceIdLists = useMemo(() => {
    void commerceRev;
    if (!isClient) return [] as string[][];
    return listPackageDefinitions(organization.id).map((definition) =>
      definition.includedServices.map((row) => row.serviceId),
    );
  }, [commerceRev, isClient, organization.id]);

  const saleReferenceIds = useMemo(() => {
    void commerceRev;
    if (!isClient) return [] as string[];
    return listTransactions(organization.id).flatMap((transaction) =>
      transaction.status === "COMPLETED"
        ? transaction.items
            .filter((item) => item.type === "SERVICE" && item.referenceId)
            .map((item) => item.referenceId as string)
        : [],
    );
  }, [commerceRev, isClient, organization.id]);

  const relatedServiceId = selectedStillVisible ? selectedServiceId : null;
  const related = relatedServiceId
    ? {
        appointmentCount: countRelatedAppointments(
          appointmentServiceIds,
          relatedServiceId,
        ),
        packagePlanCount: countRelatedPackagePlans(
          packageServiceIdLists,
          relatedServiceId,
        ),
        salesCount: countRelatedServiceSales(saleReferenceIds, relatedServiceId),
      }
    : { appointmentCount: 0, packagePlanCount: 0, salesCount: 0 };

  function selectService(id: string) {
    setSelectedServiceId(id);
    setActionError("");
  }

  function closeQuickView() {
    setSelectedServiceId(null);
    setActionError("");
  }

  function applyFilters(next: Partial<typeof filters>) {
    const merged = { ...filters, ...next };
    setFilters(merged);
    const nextVisible = filterServiceCatalogRows(rows, merged);
    if (
      shouldResetServiceCatalogSelection({
        selectedServiceId,
        visibleRows: nextVisible,
      })
    ) {
      setSelectedServiceId(null);
    }
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, id: string) {
    if (!isServiceRowKeyboardActivation(event.key)) return;
    event.preventDefault();
    selectService(id);
  }

  function openCreate() {
    if (!mutation.create) return;
    setFormMode("create");
    setFormOpen(true);
    setActionError("");
  }

  function openEdit() {
    if (!selectedRow || !mutation.edit) return;
    setFormMode("edit");
    setFormOpen(true);
    setActionError("");
  }

  function setActive(isActive: boolean) {
    if (!mutation.toggleActive || !selectedServiceId || !staffId) return;
    try {
      if (isActive) reactivateService(organization.id, selectedServiceId, staffId);
      else deactivateService(organization.id, selectedServiceId, staffId);
      setActionError("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "無法更新服務狀態");
    }
  }

  const remoteReady = !remoteReadPilot || remote.status === "data" || remote.status === "empty";
  const catalogReady = remoteReadPilot ? remoteReady : isClient;
  const emptyAll = catalogReady && rows.length === 0;
  const emptyFiltered = catalogReady && rows.length > 0 && visible.length === 0;
  const emptyCopy = serviceCatalogEmptyCopy({
    hasAny: rows.length > 0,
    filter: filters.status,
    category: filters.category,
    query: filters.query,
  });
  const editing = selectedRow
    ? services.find((service) => service.id === selectedRow.serviceId)
    : undefined;

  return (
    <div
      data-service-catalog-workspace
      data-has-quickview={showQuickView ? "true" : "false"}
      className="min-w-0"
    >
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">
            {PLATFORM_NAME}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            服務項目
          </h1>
          <p className="text-sm text-secondary-text">
            管理可預約、可銷售與套票適用的服務項目
          </p>
        </div>
        {mutation.create ? (
          <div className="hidden shrink-0 min-[720px]:block">
            <Button
              data-service-catalog-add
              className="h-9 min-h-9 rounded-full px-4 text-[13px]"
              onClick={openCreate}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新增服務
            </Button>
          </div>
        ) : null}
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 min-[1200px]:grid-cols-4 min-[1200px]:gap-3">
        <SummaryCard label="全部服務" value={catalogReady ? summary.total : "—"} accent="primary" />
        <SummaryCard
          label="販售中"
          value={catalogReady ? summary.active : "—"}
          accent="success"
        />
        <SummaryCard
          label="可加入套票"
          value={catalogReady ? summary.packageEligible : "—"}
        />
        <SummaryCard label="已停售" value={catalogReady ? summary.inactive : "—"} />
      </section>

      <div
        data-service-catalog-split
        data-service-catalog-gap={showQuickView ? SERVICE_CATALOG_WORKSPACE_GAP_PX : 0}
        className={cn("flex items-start", showQuickView && "min-[1200px]:gap-4")}
      >
        <div className="min-w-0 flex-1">
          <div className="mb-3 rounded-2xl border border-border bg-surface px-3 py-2.5">
            <div className="flex flex-col gap-2 min-[720px]:flex-row min-[720px]:items-center min-[720px]:justify-between">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {categories.length > 0 ? (
                  <label className="sr-only" htmlFor="service-catalog-category">
                    分類
                  </label>
                ) : null}
                {categories.length > 0 ? (
                  <select
                    id="service-catalog-category"
                    data-service-catalog-category
                    value={filters.category}
                    onChange={(event) => applyFilters({ category: event.target.value })}
                    className="h-8 min-h-8 rounded-full border border-transparent bg-[#F6F1EE] px-3 text-[12px] font-medium text-text"
                  >
                    <option value="">全部分類</option>
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                ) : null}
                {SERVICE_CATALOG_FILTER_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-service-catalog-filter={item.id}
                    onClick={() => applyFilters({ status: item.id })}
                    className={cn(
                      "h-8 min-h-8 shrink-0 rounded-full px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      filters.status === item.id
                        ? "bg-primary text-white"
                        : "bg-[#F6F1EE] text-text hover:bg-primary-light",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="relative min-w-0 flex-1 min-[720px]:max-w-md">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary-text"
                  aria-hidden
                />
                <label className="sr-only" htmlFor="service-catalog-search">
                  搜尋服務名稱
                </label>
                <input
                  id="service-catalog-search"
                  type="search"
                  value={filters.query}
                  onChange={(event) => applyFilters({ query: event.target.value })}
                  placeholder="搜尋服務名稱…"
                  className="h-9 min-h-9 w-full rounded-full border border-border bg-surface pl-9 pr-3 text-[13px] text-text outline-none ring-primary/30 focus-visible:ring-2"
                />
              </div>
            </div>
          </div>

          {actionError ? (
            <p role="alert" className="mb-3 text-[13px] text-[#C49A9A]">
              {actionError}
            </p>
          ) : null}

          {remote.status === "error" ? (
            <p role="alert" className="mb-3 text-[13px] text-[#C49A9A]">
              {remote.message}
            </p>
          ) : null}

          {!catalogReady ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="h-[80px] animate-pulse rounded-2xl bg-primary-light/40"
                />
              ))}
            </div>
          ) : emptyAll || emptyFiltered ? (
            <Card padding="lg" className="text-center">
              <p className="text-[15px] font-medium text-text">{emptyCopy.title}</p>
              <p className="mt-1 text-sm text-secondary-text">{emptyCopy.body}</p>
              {emptyAll && mutation.create ? (
                <div className="mt-4 flex justify-center">
                  <Button className="h-10 min-h-10 rounded-full px-4" onClick={openCreate}>
                    <Plus className="h-4 w-4" aria-hidden />
                    新增服務
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : (
            <>
              <div
                data-service-catalog-list
                className="hidden overflow-hidden rounded-2xl border border-border bg-surface min-[1200px]:block"
              >
                <div className="grid grid-cols-[minmax(160px,1.5fr)_88px_72px_88px_72px_minmax(180px,1.2fr)_24px] bg-[#FAF7F5]/80 px-4 py-2 text-[11px] text-secondary-text">
                  <span>服務名稱</span>
                  <span>分類</span>
                  <span>時長</span>
                  <span>售價</span>
                  <span>狀態</span>
                  <span>設定</span>
                  <span className="sr-only">開啟</span>
                </div>
                {visible.map((row) => (
                  <DesktopRow
                    key={row.serviceId}
                    row={row}
                    selected={selectedServiceId === row.serviceId}
                    onSelect={selectService}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>

              <div
                data-service-catalog-mobile-list
                className="space-y-2.5 pb-[calc(8.75rem+env(safe-area-inset-bottom))] min-[720px]:pb-0 min-[1200px]:hidden"
              >
                {visible.map((row) => (
                  <MobileCard
                    key={row.serviceId}
                    row={row}
                    selected={selectedServiceId === row.serviceId}
                    onSelect={selectService}
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
            <ServiceQuickView
              key={selectedRow.serviceId}
              row={selectedRow}
              related={related}
              canManage={mutation.edit}
              onClose={closeQuickView}
              onEdit={openEdit}
              onDeactivate={() => setActive(false)}
              onReactivate={() => setActive(true)}
            />
          </div>
        ) : null}
      </div>

      {showQuickView && selectedRow ? (
        <div className="min-[1200px]:hidden">
          <ServiceQuickView
            key={selectedRow.serviceId}
            row={selectedRow}
            related={related}
            canManage={mutation.edit}
            onClose={closeQuickView}
            onEdit={openEdit}
            onDeactivate={() => setActive(false)}
            onReactivate={() => setActive(true)}
          />
        </div>
      ) : null}

      {mutation.create && !showQuickView ? (
        <div
          data-service-catalog-add-mobile-wrap
          className="fixed inset-x-4 z-30 min-[720px]:hidden bottom-[calc(3.5rem+0.75rem+env(safe-area-inset-bottom))]"
        >
          <Button
            data-service-catalog-add-mobile
            className="h-12 min-h-12 w-full rounded-2xl text-[15px] shadow-[0_8px_24px_rgba(197,107,112,0.22)]"
            onClick={openCreate}
          >
            <Plus className="h-4 w-4" aria-hidden />
            新增服務
          </Button>
        </div>
      ) : null}

      {formOpen ? (
        <ServiceFormDialog
          key={`${formMode}-${selectedRow?.serviceId ?? "new"}`}
          open={formOpen}
          mode={formMode}
          remoteWritePilot={remoteWritePilot}
          organizationId={organization.id}
          staffId={staffId}
          serviceId={formMode === "edit" ? selectedRow?.serviceId : undefined}
          draft={
            formMode === "edit" && editing
              ? draftFromService(editing)
              : emptyServiceCatalogDraft()
          }
          onClose={() => setFormOpen(false)}
          onSaved={(id) => {
            setFormOpen(false);
            setSelectedServiceId(id);
            setFilters({ status: "all", category: "", query: "" });
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
      data-service-catalog-summary
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
  row: ServiceCatalogWorkspaceRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onPointerDown: (event: SyntheticEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void;
}

function DesktopRow({ row, selected, onSelect, onPointerDown, onKeyDown }: RowProps) {
  return (
    <div
      data-service-catalog-row
      data-service-id={row.serviceId}
      aria-pressed={selected}
      className={cn(
        "relative grid min-h-[78px] cursor-pointer grid-cols-[minmax(160px,1.5fr)_88px_72px_88px_72px_minmax(180px,1.2fr)_24px] items-center border-b border-[#EFE8E4]/80 px-4 last:border-b-0",
        "hover:bg-[#F7F2F0]",
        selected && "bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.serviceId)}
    >
      {selected ? (
        <span
          data-service-catalog-row-accent
          className="pointer-events-none absolute inset-y-0 left-0 z-20 w-[3px] bg-[#C56B70]"
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        data-service-catalog-row-focus
        aria-label={`${row.name}，${row.statusTitle}，開啟服務摘要`}
        aria-pressed={selected}
        className="absolute inset-0 z-10 cursor-pointer rounded-none bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
        onPointerDown={onPointerDown}
        onMouseDown={onPointerDown}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(row.serviceId);
        }}
        onKeyDown={(event) => onKeyDown(event, row.serviceId)}
      />
      <div className="pointer-events-none relative z-0 min-w-0 pr-2">
        <p className="truncate text-[14px] font-semibold text-text">{row.name}</p>
      </div>
      <div className="pointer-events-none relative z-0 truncate pr-2 text-[12px] text-secondary-text">
        {row.category || "—"}
      </div>
      <div className="pointer-events-none relative z-0 pr-2 text-[12px] tabular-nums text-secondary-text">
        {row.durationMinutes} 分鐘
      </div>
      <div className="pointer-events-none relative z-0 pr-2 text-[14px] font-semibold tabular-nums text-text">
        {formatTwd(row.priceMinor)}
      </div>
      <div className="pointer-events-none relative z-0 pr-1">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
            row.isActive ? "bg-[#E7F0EA] text-[#5C7F66]" : "bg-[#F1EEEC] text-[#7A7272]",
          )}
        >
          {row.statusTitle}
        </span>
      </div>
      <div className="pointer-events-none relative z-0 truncate pr-2 text-[11px] text-secondary-text">
        {row.bookable ? "✓ 可預約" : "不可預約"}
        {" · "}
        {row.sellable ? "✓ 可銷售" : "不可銷售"}
        {" · "}
        ✓ 可加入套票
      </div>
      <div className="pointer-events-none relative z-0 flex justify-end text-secondary-text">
        <ChevronRight className="h-4 w-4" aria-hidden />
      </div>
    </div>
  );
}

function MobileCard({ row, selected, onSelect, onPointerDown, onKeyDown }: RowProps) {
  return (
    <div
      data-service-catalog-row
      data-service-id={row.serviceId}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${row.name}，${row.statusTitle}，開啟服務摘要`}
      className={cn(
        "cursor-pointer rounded-2xl border border-border bg-surface px-3.5 py-3 outline-none transition-colors",
        "hover:border-primary/30 focus-visible:bg-primary-light/30",
        selected && "border-primary/40 bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.serviceId)}
      onKeyDown={(event) => onKeyDown(event, row.serviceId)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-text">{row.name}</p>
          <p className="mt-0.5 truncate text-[12px] text-[#6E6666]">
            {row.category || "未分類"} · {row.durationMinutes} 分鐘
          </p>
        </div>
        <p className="shrink-0 text-[14px] font-semibold tabular-nums text-text">
          {formatTwd(row.priceMinor)}
        </p>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] text-secondary-text">
          {row.bookable ? "✓ 可預約" : "不可預約"}
          {" · "}
          {row.sellable ? "✓ 可銷售" : "不可銷售"}
          {" · "}
          ✓ 可加入套票
        </p>
        <span
          className={cn(
            "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            row.isActive ? "bg-[#E7F0EA] text-[#5C7F66]" : "bg-[#F1EEEC] text-[#7A7272]",
          )}
        >
          {row.statusTitle}
        </span>
      </div>
    </div>
  );
}
