"use client";

import {
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import Link from "next/link";
import { ChevronRight, Plus, Search, Ticket } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PackagePlanEditorDialog } from "@/features/packages/PackagePlanEditorDialog";
import { PackagePlanQuickView } from "@/features/packages/PackagePlanQuickView";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { formatTwd } from "@/lib/commerce/money";
import { getServicesForOrganization } from "@/data/mock-services";
import {
  PACKAGE_PLAN_FILTER_OPTIONS,
  PACKAGE_PLANS_WORKSPACE_GAP_PX,
  buildPackagePlanRows,
  canManagePackagePlans,
  countPackagePlanSummary,
  draftFromPackageDefinition,
  emptyPackagePlanDraft,
  filterPackagePlanRows,
  isPackagePlanRowKeyboardActivation,
  packagePlanEmptyCopy,
  resolveSelectedPackagePlanRow,
  shouldRenderPackagePlanQuickView,
  shouldResetPackagePlanSelection,
  type PackagePlanListFilter,
  type PackagePlanWorkspaceRow,
} from "@/lib/packages/package-plans-derived";
import {
  getPackageDefinition,
  listCustomerPackages,
  listPackageDefinitions,
  listPackageLedger,
  updatePackageDefinition,
} from "@/lib/packages/store";
import { useIsClient } from "@/lib/repositories/use-crm-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import { cn } from "@/lib/utils";

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

export function PackagePlansPageClient() {
  const { organization, currentLocation, locations, membership } = useOrganization();
  const isClient = useIsClient();
  const commerceRev = useSyncExternalStore(
    subscribeCommerce,
    getCommerceRevision,
    () => "",
  );

  const staffId = membership?.userId ?? "";
  const canManage = canManagePackagePlans(membership?.role);
  const services = getServicesForOrganization(organization.id);
  const serviceOptions = useMemo(
    () => services.map((service) => ({ id: service.id, name: service.name })),
    [services],
  );
  const serviceNames = useMemo(
    () => Object.fromEntries(services.map((service) => [service.id, service.name])),
    [services],
  );

  const [filter, setFilter] = useState<PackagePlanListFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [now] = useState(() => new Date());
  const [actionError, setActionError] = useState("");

  const definitions = useMemo(() => {
    void commerceRev;
    if (!isClient) return [];
    return listPackageDefinitions(organization.id);
  }, [commerceRev, isClient, organization.id]);

  const customerPackages = useMemo(() => {
    void commerceRev;
    if (!isClient) return [];
    return listCustomerPackages(organization.id);
  }, [commerceRev, isClient, organization.id]);

  const ledger = useMemo(() => {
    void commerceRev;
    if (!isClient) return [];
    return listPackageLedger(organization.id);
  }, [commerceRev, isClient, organization.id]);

  const rows = useMemo(
    () =>
      buildPackagePlanRows({
        organizationId: organization.id,
        definitions,
        packages: customerPackages,
        ledger,
        serviceNames,
        now,
      }),
    [customerPackages, definitions, ledger, now, organization.id, serviceNames],
  );

  const visible = useMemo(
    () => filterPackagePlanRows(rows, filter, query),
    [filter, query, rows],
  );
  const summary = useMemo(() => countPackagePlanSummary(rows), [rows]);

  const selectedStillVisible = !shouldResetPackagePlanSelection({
    selectedPlanId,
    visibleRows: visible,
  });
  const selectedRow = selectedStillVisible
    ? resolveSelectedPackagePlanRow(rows, selectedPlanId)
    : null;
  const showQuickView = shouldRenderPackagePlanQuickView(selectedRow);
  const editingDefinition =
    editorMode === "edit" && selectedPlanId
      ? getPackageDefinition(organization.id, selectedPlanId)
      : undefined;

  function selectPlan(id: string) {
    setSelectedPlanId(id);
    setActionError("");
  }

  function closeQuickView() {
    setSelectedPlanId(null);
  }

  function applyFilter(next: PackagePlanListFilter) {
    setFilter(next);
    const nextVisible = filterPackagePlanRows(rows, next, query);
    if (
      shouldResetPackagePlanSelection({
        selectedPlanId,
        visibleRows: nextVisible,
      })
    ) {
      setSelectedPlanId(null);
    }
  }

  function applyQuery(nextQuery: string) {
    setQuery(nextQuery);
    const nextVisible = filterPackagePlanRows(rows, filter, nextQuery);
    if (
      shouldResetPackagePlanSelection({
        selectedPlanId,
        visibleRows: nextVisible,
      })
    ) {
      setSelectedPlanId(null);
    }
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, planId: string) {
    if (!isPackagePlanRowKeyboardActivation(event.key)) return;
    event.preventDefault();
    selectPlan(planId);
  }

  function openCreate() {
    if (!canManage) return;
    setEditorMode("create");
    setEditorOpen(true);
    setActionError("");
  }

  function openEdit() {
    if (!canManage || !selectedPlanId) return;
    setEditorMode("edit");
    setEditorOpen(true);
    setActionError("");
  }

  function setActive(isActive: boolean) {
    if (!canManage || !selectedPlanId || !staffId) return;
    try {
      updatePackageDefinition(
        organization.id,
        selectedPlanId,
        { isActive },
        staffId,
      );
      setActionError("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "無法更新方案狀態");
    }
  }

  const emptyAll = isClient && rows.length === 0;
  const emptyFiltered = isClient && rows.length > 0 && visible.length === 0;
  const emptyCopy = packagePlanEmptyCopy({
    hasAny: rows.length > 0,
    filter,
    query,
  });

  return (
    <div
      data-package-plans-workspace
      data-has-quickview={showQuickView ? "true" : "false"}
      className="min-w-0"
    >
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">
            {PLATFORM_NAME}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            套票方案
          </h1>
          <p className="text-sm text-secondary-text">
            管理可販售的療程套票與組合方案
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/staff/packages"
            className="inline-flex h-9 min-h-9 items-center justify-center rounded-full border border-border bg-surface px-3.5 text-[13px] font-medium text-text hover:bg-primary-light/40"
          >
            客戶套票
          </Link>
          {canManage ? (
            <div className="hidden min-[720px]:block">
              <Button
                data-package-plan-add
                className="h-9 min-h-9 rounded-full px-4 text-[13px]"
                onClick={openCreate}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                新增套票方案
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 min-[1200px]:grid-cols-4 min-[1200px]:gap-3">
        <SummaryCard label="全部方案" value={isClient ? summary.total : "—"} accent="primary" />
        <SummaryCard
          label="販售中"
          value={isClient ? summary.active : "—"}
          accent="success"
        />
        <SummaryCard label="已停售" value={isClient ? summary.inactive : "—"} />
        <SummaryCard
          label="組合套票"
          value={isClient ? summary.combination : "—"}
          accent="warning"
        />
      </section>

      <div
        data-package-plans-split
        data-package-plans-gap={showQuickView ? PACKAGE_PLANS_WORKSPACE_GAP_PX : 0}
        className={cn("flex items-start", showQuickView && "min-[1200px]:gap-4")}
      >
        <div className="min-w-0 flex-1">
          <div className="mb-3 rounded-2xl border border-border bg-surface px-3 py-2.5">
            <div className="flex flex-col gap-2 min-[720px]:flex-row min-[720px]:items-center min-[720px]:justify-between">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {PACKAGE_PLAN_FILTER_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-package-plan-filter={item.id}
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
              <div className="relative min-w-0 flex-1 min-[720px]:max-w-md">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary-text"
                  aria-hidden
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => applyQuery(event.target.value)}
                  placeholder="搜尋套票名稱"
                  className="h-10 min-h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[14px] text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
                  aria-label="搜尋套票名稱"
                />
              </div>
            </div>
          </div>

          {actionError ? (
            <p className="mb-3 text-sm text-[#B07A4A]" role="alert">
              {actionError}
            </p>
          ) : null}

          {!isClient ? (
            <ListSkeleton />
          ) : emptyAll || emptyFiltered ? (
            <Card padding="lg" className="text-center">
              {emptyAll ? (
                <Ticket className="mx-auto h-10 w-10 text-primary/50" aria-hidden />
              ) : null}
              <p className="mt-3 text-[15px] font-medium text-text">{emptyCopy.title}</p>
              <p className="mt-1 text-sm text-secondary-text">{emptyCopy.body}</p>
              {emptyAll && canManage ? (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    data-package-plan-add
                    className="h-10 min-h-10 rounded-full px-4 text-[13px]"
                    onClick={openCreate}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    新增套票方案
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : (
            <>
              <div
                data-package-plan-list
                className="hidden overflow-hidden rounded-2xl border border-border bg-surface min-[1200px]:block"
              >
                {visible.map((row) => (
                  <DesktopRow
                    key={row.definitionId}
                    row={row}
                    selected={selectedPlanId === row.definitionId}
                    onSelect={selectPlan}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>

              <div className="space-y-2.5 min-[1200px]:hidden">
                {visible.map((row) => (
                  <MobileRow
                    key={row.definitionId}
                    row={row}
                    selected={selectedPlanId === row.definitionId}
                    onSelect={selectPlan}
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
            <PackagePlanQuickView
              key={selectedRow.definitionId}
              row={selectedRow}
              canManage={canManage}
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
          <PackagePlanQuickView
            key={selectedRow.definitionId}
            row={selectedRow}
            canManage={canManage}
            onClose={closeQuickView}
            onEdit={openEdit}
            onDeactivate={() => setActive(false)}
            onReactivate={() => setActive(true)}
          />
        </div>
      ) : null}

      {canManage ? (
        <div className="sticky bottom-20 z-20 mt-4 min-[720px]:hidden">
          <Button
            data-package-plan-add-mobile
            className="h-12 min-h-12 w-full rounded-2xl text-[15px] shadow-[0_8px_24px_rgba(197,107,112,0.22)]"
            onClick={openCreate}
          >
            <Plus className="h-4 w-4" aria-hidden />
            新增套票方案
          </Button>
        </div>
      ) : null}

      {editorOpen ? (
        <PackagePlanEditorDialog
          key={editorMode === "edit" ? (selectedPlanId ?? "edit") : "new"}
          open={editorOpen}
          mode={editorMode}
          organizationId={organization.id}
          staffId={staffId}
          currentLocationName={currentLocation?.name ?? locations[0]?.name ?? ""}
          services={serviceOptions}
          draft={
            editorMode === "edit" && editingDefinition
              ? draftFromPackageDefinition(editingDefinition)
              : emptyPackagePlanDraft()
          }
          definitionId={editorMode === "edit" ? selectedPlanId ?? undefined : undefined}
          canManage={canManage}
          onClose={() => setEditorOpen(false)}
          onSaved={(id) => {
            setEditorOpen(false);
            setSelectedPlanId(id);
            setFilter("all");
            setQuery("");
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
      data-package-plans-summary
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
  row: PackagePlanWorkspaceRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onPointerDown: (event: SyntheticEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void;
}

function DesktopRow({ row, selected, onSelect, onPointerDown, onKeyDown }: RowProps) {
  return (
    <div
      data-package-plan-row
      data-package-plan-id={row.definitionId}
      aria-pressed={selected}
      className={cn(
        "relative min-h-[78px] cursor-pointer border-b border-[#EFE8E4] px-4 py-3 last:border-b-0",
        "hover:bg-[#F7F2F0]",
        selected && "bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.definitionId)}
    >
      {selected ? (
        <span
          data-package-plan-row-accent
          className="pointer-events-none absolute inset-y-0 left-0 z-20 w-[3px] bg-[#C56B70]"
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        aria-label={`${row.name}，${row.statusTitle}，開啟套票方案摘要`}
        aria-pressed={selected}
        className="absolute inset-0 z-10 cursor-pointer rounded-none bg-transparent"
        onPointerDown={onPointerDown}
        onMouseDown={onPointerDown}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(row.definitionId);
        }}
        onKeyDown={(event) => onKeyDown(event, row.definitionId)}
      />
      <div className="pointer-events-none relative z-0 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-text">{row.name}</p>
          <p className="mt-0.5 truncate text-[12px] text-[#6E6666]">{row.contentsLabel}</p>
          <p className="mt-0.5 truncate text-[12px] tabular-nums text-secondary-text">
            {formatTwd(row.priceMinor)} · {row.validityLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
              row.isActive ? "bg-[#E7F0EA] text-[#5C7F66]" : "bg-[#F1EEEC] text-[#7A7272]",
            )}
          >
            {row.statusTitle}
          </span>
          <ChevronRight className="h-4 w-4 text-secondary-text" aria-hidden />
        </div>
      </div>
    </div>
  );
}

function MobileRow({ row, selected, onSelect, onPointerDown, onKeyDown }: RowProps) {
  return (
    <div
      data-package-plan-row
      data-package-plan-id={row.definitionId}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${row.name}，${row.statusTitle}，開啟套票方案摘要`}
      className={cn(
        "cursor-pointer rounded-2xl border border-border bg-surface px-3.5 py-3 outline-none transition-colors",
        "hover:border-primary/30 focus-visible:bg-primary-light/30",
        selected && "border-primary/40 bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.definitionId)}
      onKeyDown={(event) => onKeyDown(event, row.definitionId)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[14px] font-semibold text-text">{row.name}</p>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            row.isActive ? "bg-[#E7F0EA] text-[#5C7F66]" : "bg-[#F1EEEC] text-[#7A7272]",
          )}
        >
          {row.statusTitle}
        </span>
      </div>
      <p className="mt-0.5 truncate text-[12px] text-[#6E6666]">{row.contentsLabel}</p>
      <div className="mt-1 flex items-center justify-between gap-2 text-[12px] text-secondary-text">
        <span className="min-w-0 truncate tabular-nums">
          {formatTwd(row.priceMinor)} · {row.validityLabel}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
      </div>
    </div>
  );
}
