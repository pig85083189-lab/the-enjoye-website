"use client";

import {
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { ChevronRight, Search } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FollowUpQuickView } from "@/features/follow-ups/FollowUpQuickView";
import { getServiceById } from "@/data/mock-services";
import {
  combineLocalDateTime,
  STATUS_LABEL,
} from "@/lib/appointments/domain";
import { listAppointments } from "@/lib/appointments/store";
import {
  getAppointmentStatusRaw,
  subscribeAppointments,
} from "@/lib/appointment-store";
import {
  FOLLOW_UPS_WORKSPACE_GAP_PX,
  FOLLOW_UP_TIME_FILTER_OPTIONS,
  FOLLOW_UP_TYPE_FILTER_OPTIONS,
  buildFollowUpWorkspaceRows,
  countFollowUpWorkspaceSummary,
  filterFollowUpRows,
  followUpEmptyCopy,
  isFollowUpRowKeyboardActivation,
  listFollowUpsForTimeFilter,
  resolveSelectedFollowUpRow,
  shouldRenderFollowUpQuickView,
  shouldResetFollowUpSelection,
  sortFollowUpWorkspaceRows,
  type FollowUpTimeFilter,
  type FollowUpTypeFilter,
  type FollowUpWorkspaceRow,
} from "@/lib/follow-ups/follow-ups-workspace-derived";
import {
  buildRebookHref,
  completeFollowUpTask,
  getFollowUpRevision,
  listFollowUpTasks,
  snoozeFollowUpTask,
  subscribeFollowUps,
} from "@/lib/follow-ups/store";
import { formatPhoneDisplay } from "@/lib/phone";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { subscribeCrmStore } from "@/lib/repositories/storage";
import { useIsClient } from "@/lib/repositories/use-crm-store";
import { getMembership } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import {
  getTreatmentDraftRevision,
  subscribeTreatmentDrafts,
} from "@/lib/treatment-draft";
import { listCompletedTreatmentsForOrganization } from "@/lib/repositories/local-treatment-repository";
import { useClientNow } from "@/lib/use-client-now";
import { cn } from "@/lib/utils";

const STATUS_PILL: Record<FollowUpWorkspaceRow["dueKind"], string> = {
  today: "bg-[#F8F1E8] text-[#C4A06A]",
  overdue: "bg-[#F6EEEE] text-[#C49A9A]",
  upcoming: "bg-[#F8F1E8] text-[#C4A06A]",
  completed: "bg-[#E7F0EA] text-[#5C7F66]",
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

export function FollowUpsPageClient() {
  const { organization, membership, locations, currentLocation } = useOrganization();
  const isClient = useIsClient();
  const clientNow = useClientNow();
  const nowMs = clientNow?.getTime() ?? 0;
  const now = useMemo(
    () => (nowMs > 0 ? new Date(nowMs) : new Date()),
    [nowMs],
  );

  const followRev = useSyncExternalStore(
    subscribeFollowUps,
    getFollowUpRevision,
    () => "",
  );
  const crmRev = useSyncExternalStore(
    subscribeCrmStore,
    () =>
      localCustomerRepository
        .list({ organizationId: organization.id })
        .map((item) => `${item.id}:${item.updatedAt}`)
        .join("|"),
    () => "",
  );
  const treatmentRev = useSyncExternalStore(
    subscribeTreatmentDrafts,
    () => getTreatmentDraftRevision(organization.id),
    () => "",
  );
  const appointmentRev = useSyncExternalStore(
    subscribeAppointments,
    getAppointmentStatusRaw,
    () => "",
  );

  const staffId = membership?.userId;
  const [timeFilter, setTimeFilter] = useState<FollowUpTimeFilter>("today");
  const [typeFilter, setTypeFilter] = useState<FollowUpTypeFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedFollowUpId, setSelectedFollowUpId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const allTasks = useMemo(() => {
    void followRev;
    if (!isClient) return [];
    return listFollowUpTasks(organization.id).filter(
      (task) => task.organizationId === organization.id,
    );
  }, [followRev, isClient, organization.id]);

  const customers = useMemo(() => {
    void crmRev;
    if (!isClient) return [];
    return localCustomerRepository
      .list({ organizationId: organization.id })
      .filter((item) => item.organizationId === organization.id)
      .map((item) => ({
        id: item.id,
        organizationId: item.organizationId,
        name: item.name,
        phone: item.phone,
        tags: item.tags.map((tag) => ({ id: tag.id, label: tag.label })),
      }));
  }, [crmRev, isClient, organization.id]);

  const treatments = useMemo(() => {
    void treatmentRev;
    if (!isClient) return [];
    return listCompletedTreatmentsForOrganization(organization.id)
      .filter((item) => item.organizationId === organization.id)
      .map((item) => ({
        id: item.id,
        organizationId: item.organizationId,
        serviceName: getServiceById(item.serviceId, organization.id)?.name,
        dateIso: item.updatedAt,
        professionalNote: item.professionalNote,
      }));
  }, [isClient, organization.id, treatmentRev]);

  const appointments = useMemo(() => {
    void appointmentRev;
    if (!isClient) return [];
    return listAppointments({ organizationId: organization.id }).map((item) => ({
      id: item.id,
      organizationId: item.organizationId,
      serviceName: item.serviceName,
      startAt: item.startAt,
      statusLabel: STATUS_LABEL[item.status],
    }));
  }, [appointmentRev, isClient, organization.id]);

  const staffHints = useMemo(() => {
    const ids = new Set<string>();
    for (const task of allTasks) {
      if (task.assignedStaffId) ids.add(task.assignedStaffId);
    }
    if (staffId) ids.add(staffId);
    return [...ids]
      .map((id) => {
        const member = getMembership(organization.id, id);
        return member
          ? { userId: member.userId, displayName: member.displayName }
          : null;
      })
      .filter((item): item is { userId: string; displayName: string } => item !== null);
  }, [allTasks, organization.id, staffId]);

  const locationHints = useMemo(
    () => locations.map((item) => ({ id: item.id, name: item.name })),
    [locations],
  );

  const rows = useMemo(
    () =>
      buildFollowUpWorkspaceRows({
        tasks: allTasks,
        organizationId: organization.id,
        customers,
        locations: locationHints,
        staff: staffHints,
        treatments,
        appointments,
        now,
      }),
    [
      allTasks,
      appointments,
      customers,
      locationHints,
      now,
      organization.id,
      staffHints,
      treatments,
    ],
  );

  const timeScoped = useMemo(() => {
    const scoped = listFollowUpsForTimeFilter(allTasks, timeFilter, {
      now,
      staffId,
    });
    const scopedIds = new Set(scoped.map((task) => task.id));
    return sortFollowUpWorkspaceRows(
      rows.filter((row) => scopedIds.has(row.taskId)),
      timeFilter,
    );
  }, [allTasks, now, rows, staffId, timeFilter]);

  const visible = useMemo(
    () => filterFollowUpRows(timeScoped, { type: typeFilter, query }),
    [query, timeScoped, typeFilter],
  );

  const summary = useMemo(
    () => countFollowUpWorkspaceSummary(allTasks, now),
    [allTasks, now],
  );

  const selectedStillVisible = !shouldResetFollowUpSelection({
    selectedFollowUpId,
    visibleRows: visible,
  });
  const selectedRow = selectedStillVisible
    ? resolveSelectedFollowUpRow(rows, selectedFollowUpId)
    : null;
  const showQuickView = shouldRenderFollowUpQuickView(selectedRow);

  function selectFollowUp(id: string) {
    setSelectedFollowUpId(id);
    setActionError("");
  }

  function closeQuickView() {
    setSelectedFollowUpId(null);
    setActionError("");
  }

  function applyTimeFilter(next: FollowUpTimeFilter) {
    setTimeFilter(next);
    const scoped = listFollowUpsForTimeFilter(allTasks, next, { now, staffId });
    const scopedIds = new Set(scoped.map((task) => task.id));
    const nextVisible = filterFollowUpRows(
      rows.filter((row) => scopedIds.has(row.taskId)),
      { type: typeFilter, query },
    );
    if (
      shouldResetFollowUpSelection({
        selectedFollowUpId,
        visibleRows: nextVisible,
      })
    ) {
      setSelectedFollowUpId(null);
    }
  }

  function applyTypeFilter(next: FollowUpTypeFilter) {
    setTypeFilter(next);
    const nextVisible = filterFollowUpRows(timeScoped, {
      type: next,
      query,
    });
    if (
      shouldResetFollowUpSelection({
        selectedFollowUpId,
        visibleRows: nextVisible,
      })
    ) {
      setSelectedFollowUpId(null);
    }
  }

  function applyQuery(next: string) {
    setQuery(next);
    const nextVisible = filterFollowUpRows(timeScoped, {
      type: typeFilter,
      query: next,
    });
    if (
      shouldResetFollowUpSelection({
        selectedFollowUpId,
        visibleRows: nextVisible,
      })
    ) {
      setSelectedFollowUpId(null);
    }
  }

  function clearFilters() {
    setTimeFilter("today");
    setTypeFilter("all");
    setQuery("");
    setSelectedFollowUpId(null);
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, id: string) {
    if (!isFollowUpRowKeyboardActivation(event.key)) return;
    event.preventDefault();
    selectFollowUp(id);
  }

  function handleComplete(completionNote: string) {
    if (!selectedFollowUpId || !staffId) {
      setActionError("無法辨識目前員工身份");
      return;
    }
    setActionBusy(true);
    setActionError("");
    try {
      completeFollowUpTask(organization.id, selectedFollowUpId, {
        actorStaffId: staffId,
        completionNote,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "完成失敗");
    } finally {
      setActionBusy(false);
    }
  }

  function handleSnooze(dueYmd: string) {
    if (!selectedFollowUpId || !staffId) {
      setActionError("無法辨識目前員工身份");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueYmd)) {
      setActionError("請選擇延後日期");
      return;
    }
    setActionBusy(true);
    setActionError("");
    try {
      snoozeFollowUpTask(organization.id, selectedFollowUpId, {
        actorStaffId: staffId,
        dueAt: combineLocalDateTime(dueYmd, "10:00").toISOString(),
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "延後失敗");
    } finally {
      setActionBusy(false);
    }
  }

  const emptyCopy = followUpEmptyCopy({ timeFilter, typeFilter, query });
  const isEmpty = isClient && visible.length === 0;
  const contextLabel = [organization.name, currentLocation?.name]
    .filter(Boolean)
    .join(" · ");

  const selectedTask = selectedRow
    ? allTasks.find((task) => task.id === selectedRow.taskId)
    : undefined;

  return (
    <div
      data-followups-workspace
      data-has-quickview={showQuickView ? "true" : "false"}
      className="min-w-0"
    >
      <header className="mb-3 space-y-0.5">
        <p className="text-[11px] tracking-[0.18em] text-secondary-text">
          {PLATFORM_NAME}
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
          追蹤
        </h1>
        <p className="text-sm text-secondary-text">療程回訪與再預約</p>
        {contextLabel ? (
          <p className="text-[12px] text-secondary-text/80">{contextLabel}</p>
        ) : null}
      </header>

      <section className="mb-2.5 grid grid-cols-2 gap-2 min-[1200px]:grid-cols-4 min-[1200px]:gap-2.5">
        <SummaryCard
          label="今日待追蹤"
          value={isClient ? summary.todayCount : "—"}
          emphasis="hero"
          accent="primary"
        />
        <SummaryCard
          label="已逾期"
          value={isClient ? summary.overdueCount : "—"}
          emphasis="count"
          accent="danger"
        />
        <SummaryCard
          label="即將到期"
          value={isClient ? summary.upcomingCount : "—"}
          emphasis="count"
          accent="warning"
        />
        <SummaryCard
          label="本週已完成"
          value={isClient ? summary.completedThisWeekCount : "—"}
          emphasis="count"
          accent="success"
        />
      </section>

      <div
        data-followups-workspace-split
        data-followups-gap={showQuickView ? FOLLOW_UPS_WORKSPACE_GAP_PX : 0}
        className={cn("flex items-start", showQuickView && "min-[1200px]:gap-4")}
      >
        <div className="min-w-0 flex-1">
          <div
            data-followups-toolbar
            className="mb-2.5 rounded-2xl border border-border bg-surface px-3 py-2"
          >
            <div className="flex flex-col gap-2">
              <div className="flex min-w-0 flex-wrap gap-1">
                {FOLLOW_UP_TIME_FILTER_OPTIONS.filter(
                  (entry) => entry.id !== "mine" || Boolean(staffId),
                ).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    data-followups-filter={entry.id}
                    onClick={() => applyTimeFilter(entry.id)}
                      className={cn(
                        "h-7 min-h-7 shrink-0 rounded-full px-2.5 text-[12px] font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        timeFilter === entry.id
                          ? "bg-primary text-white"
                          : "bg-[#F7F4F2] text-secondary-text hover:bg-primary-light/70 hover:text-text",
                      )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2 min-[720px]:flex-row min-[720px]:items-center min-[720px]:justify-between">
                <div
                  data-followups-type-row
                  className="flex min-w-0 flex-wrap gap-0.5"
                  role="group"
                  aria-label="追蹤類型"
                >
                  {FOLLOW_UP_TYPE_FILTER_OPTIONS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      data-followups-type={entry.id}
                      onClick={() => applyTypeFilter(entry.id)}
                      className={cn(
                        "h-6 min-h-6 shrink-0 rounded-full px-2 text-[11px] font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                        typeFilter === entry.id
                          ? "bg-[#F6EEEE] text-[#C56B70]"
                          : "bg-[#F8F6F5] text-[#8A8280] hover:bg-[#F3EEEA] hover:text-text",
                      )}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                <div className="relative min-w-0 w-full min-[720px]:max-w-xs">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary-text"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => applyQuery(event.target.value)}
                    placeholder="搜尋客戶姓名、電話"
                    className="h-9 min-h-9 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[13px] text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
                    aria-label="搜尋客戶姓名、電話或追蹤內容"
                  />
                </div>
              </div>
            </div>
          </div>

          {!isClient ? (
            <ListSkeleton />
          ) : isEmpty ? (
            <Card data-followups-empty={emptyCopy.kind} padding="lg" className="text-center">
              <p className="text-[15px] font-medium text-text">{emptyCopy.title}</p>
              {emptyCopy.subtext ? (
                <p className="mt-2 text-sm text-secondary-text">{emptyCopy.subtext}</p>
              ) : null}
              {emptyCopy.showClear ? (
                <div className="mt-4 inline-flex">
                  <Button
                    variant="outline"
                    className="h-10 min-h-10 rounded-full px-4 text-[13px]"
                    onClick={clearFilters}
                  >
                    清除篩選
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : (
            <>
              <div
                data-followups-list
                className="hidden overflow-hidden rounded-2xl border border-border bg-surface min-[1200px]:block"
              >
                <div className="grid grid-cols-[minmax(240px,1.8fr)_128px_88px_76px_24px] bg-[#FAF7F5]/80 px-4 py-2 text-[11px] text-secondary-text">
                  <span>客戶 / 追蹤內容</span>
                  <span>追蹤時間</span>
                  <span>負責人</span>
                  <span>狀態</span>
                  <span className="sr-only">開啟</span>
                </div>
                {visible.map((row) => (
                  <DesktopRow
                    key={row.taskId}
                    row={row}
                    selected={selectedFollowUpId === row.taskId}
                    onSelect={selectFollowUp}
                    onPointerDown={selectFromPointer}
                    onKeyDown={handleRowKeyDown}
                  />
                ))}
              </div>

              <div
                data-followups-mobile-list
                className="space-y-2.5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] min-[1200px]:hidden"
              >
                {visible.map((row) => (
                  <MobileCard
                    key={row.taskId}
                    row={row}
                    selected={selectedFollowUpId === row.taskId}
                    onSelect={selectFollowUp}
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
            <FollowUpQuickView
              key={selectedRow.taskId}
              row={selectedRow}
              rebookHref={selectedTask ? buildRebookHref(selectedTask) : "/staff/calendar"}
              canAct={Boolean(staffId)}
              actionBusy={actionBusy}
              actionError={actionError}
              onClose={closeQuickView}
              onComplete={handleComplete}
              onSnooze={handleSnooze}
            />
          </div>
        ) : null}
      </div>

      {showQuickView && selectedRow ? (
        <div className="min-[1200px]:hidden">
          <FollowUpQuickView
            key={selectedRow.taskId}
            row={selectedRow}
            rebookHref={selectedTask ? buildRebookHref(selectedTask) : "/staff/calendar"}
            canAct={Boolean(staffId)}
            actionBusy={actionBusy}
            actionError={actionError}
            onClose={closeQuickView}
            onComplete={handleComplete}
            onSnooze={handleSnooze}
          />
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent = "default",
  emphasis = "count",
}: {
  label: string;
  value: number | string;
  accent?: "default" | "primary" | "warning" | "danger" | "success";
  emphasis?: "hero" | "count";
}) {
  return (
    <div
      data-followups-summary
      data-emphasis={emphasis}
      className={cn(
        "relative flex h-[70px] min-h-[68px] max-h-[76px] min-w-0 flex-col justify-center overflow-hidden rounded-2xl border border-border bg-surface px-3.5 py-2",
        emphasis === "hero" && "pl-4",
      )}
    >
      {emphasis === "hero" ? (
        <span
          className="pointer-events-none absolute inset-y-3 left-0 w-[2px] rounded-full bg-[#C56B70]/70"
          aria-hidden
        />
      ) : null}
      <p
        className={cn(
          "leading-none tracking-tight tabular-nums",
          emphasis === "hero"
            ? "text-[24px] font-semibold text-[#C56B70] sm:text-[26px]"
            : "text-[17px] font-medium sm:text-[18px]",
          emphasis === "count" && accent === "warning" && "text-[#C4A06A]",
          emphasis === "count" && accent === "danger" && "text-[#C49A9A]",
          emphasis === "count" && accent === "success" && "text-[#6A8A72]",
          emphasis === "count" && accent === "default" && "text-secondary-text",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[10px] leading-tight text-secondary-text">{label}</p>
    </div>
  );
}

interface RowProps {
  row: FollowUpWorkspaceRow;
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
  return (
    <div
      data-followups-row
      data-follow-up-id={row.taskId}
      aria-pressed={selected}
      className={cn(
        "relative grid min-h-[82px] cursor-pointer grid-cols-[minmax(240px,1.8fr)_128px_88px_76px_24px] items-center border-b border-[#EFE8E4]/80 px-4 last:border-b-0",
        "hover:bg-[#F7F2F0]",
        selected && "bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.taskId)}
    >
      {selected ? (
        <span
          data-followups-row-accent
          className="pointer-events-none absolute inset-y-0 left-0 z-20 w-[3px] bg-[#C56B70]"
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        data-followups-row-focus
        aria-label={`${row.customerName}，開啟追蹤詳情`}
        aria-pressed={selected}
        className="absolute inset-0 z-10 cursor-pointer rounded-none bg-transparent focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_rgba(197,107,112,0.55)]"
        onPointerDown={onPointerDown}
        onMouseDown={onPointerDown}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(row.taskId);
        }}
        onKeyDown={(event) => onKeyDown(event, row.taskId)}
      />
      <div className="pointer-events-none relative z-0 flex min-w-0 items-center gap-2.5 pr-3">
        <Avatar initials={row.customerInitials} size="sm" className="gap-0" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-text">
            {row.customerName}
          </p>
          <p className="mt-0.5 truncate text-[13px] font-medium text-text">
            {row.title}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-secondary-text">
            {[
              row.customerPhone ? formatPhoneDisplay(row.customerPhone) : "",
              row.serviceName,
            ]
              .filter(Boolean)
              .join(" · ") || row.typeLabel}
          </p>
        </div>
      </div>
      <div className="pointer-events-none relative z-0 pr-2">
        <p className="text-[13px] font-semibold tabular-nums text-text">{row.dueLabel}</p>
        {row.overdueLabel ? (
          <p className="mt-0.5 text-[11px] text-[#C49A9A]">{row.overdueLabel}</p>
        ) : (
          <p className="mt-0.5 text-[11px] text-secondary-text">{row.typeLabel}</p>
        )}
      </div>
      <div className="pointer-events-none relative z-0 truncate pr-2 text-[12px] text-secondary-text">
        {row.ownerLabel}
      </div>
      <div className="pointer-events-none relative z-0 pr-1">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
            STATUS_PILL[row.dueKind],
          )}
        >
          {row.statusLabel}
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
  return (
    <div
      data-followups-row
      data-follow-up-id={row.taskId}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${row.customerName}，開啟追蹤詳情`}
      className={cn(
        "cursor-pointer rounded-2xl border border-border bg-surface px-3.5 py-3 outline-none transition-colors",
        "hover:border-primary/30 focus-visible:bg-primary-light/30 focus-visible:ring-2 focus-visible:ring-primary/40",
        selected && "border-primary/40 bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.taskId)}
      onKeyDown={(event) => onKeyDown(event, row.taskId)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[14px] font-semibold text-text">
          {row.customerName}
        </p>
        <span
          className={cn(
            "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            STATUS_PILL[row.dueKind],
          )}
        >
          {row.overdueLabel ?? row.statusLabel}
        </span>
      </div>
      <p className="mt-1 text-[12px] tabular-nums text-secondary-text">{row.dueLabel}</p>
      <p className="mt-1.5 truncate text-[13px] font-medium text-text">{row.title}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[12px] text-secondary-text">
          {[row.serviceName, row.ownerLabel].filter(Boolean).join(" · ")}
        </p>
        <ChevronRight className="h-4 w-4 shrink-0 text-secondary-text" aria-hidden />
      </div>
    </div>
  );
}
