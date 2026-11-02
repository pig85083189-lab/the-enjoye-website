"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { OrgLocationSwitcher } from "@/components/navigation/OrgLocationSwitcher";
import { StaffOnboardingDialog } from "@/features/staff/StaffOnboardingDialog";
import { StaffQuickView } from "@/features/staff/StaffQuickView";
import { listStaffLoginInvitesAction } from "@/lib/staff-auth/actions";
import type { StaffInviteRecord } from "@/lib/staff-auth/staff-invite-command";
import { pendingInviteMembershipIds } from "@/lib/staff-auth/staff-invite-state";
import { pickLatestStaffInviteForMembership } from "@/lib/staff-auth/staff-invite-visibility";
import { canManageStaff } from "@/lib/staff/staff-onboarding-derived";
import { combineLocalDateTime, formatYmd, startOfDay } from "@/lib/appointments/domain";
import type { DayOfWeek } from "@/lib/staff-schedule/domain";
import {
  createBreak,
  createTimeOff,
  deleteBreak,
  deleteTimeOff,
  getStaffScheduleRevision,
  listBreaks,
  listTimeOff,
  listWorkingHours,
  replaceLocationWorkingHoursFromCloud,
  subscribeStaffSchedule,
  upsertWorkingHours,
} from "@/lib/staff-schedule/store";
import {
  STAFF_EMPLOYMENT_FILTER_OPTIONS,
  STAFF_VIEW_OPTIONS,
  STAFF_WORKSPACE_GAP_PX,
  addStaffWeekDays,
  buildStaffWorkspace,
  filterStaffRows,
  formatStaffAverageHours,
  formatStaffHoursValue,
  formatStaffPercent,
  isStaffRowKeyboardActivation,
  planApplyWorkingHoursPattern,
  resolveSelectedStaffRow,
  shouldRenderStaffQuickView,
  shouldResetStaffSelection,
  staffEmptyCopy,
  startOfStaffWeek,
  type StaffEmploymentFilter,
  type StaffWorkspaceRow,
  type StaffWorkspaceView,
} from "@/lib/staff/staff-workspace-derived";
import { useIsClient } from "@/lib/repositories/use-crm-store";
import {
  applyRemoteMembershipsToClient,
  organizationHasRemoteMemberships,
} from "@/lib/staff-auth/membership-query";
import {
  emitOrgChange,
  getOrganizationSnapshot,
  listMemberships,
  subscribeOrganization,
  updateMembership,
} from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import type { StaffRole } from "@/types/saas";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import { useClientNow } from "@/lib/use-client-now";
import { cn } from "@/lib/utils";

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

function todayIndexInWeek(now: Date): number {
  const start = startOfStaffWeek(now);
  const diff = Math.round((startOfDay(now).getTime() - start.getTime()) / 86_400_000);
  return diff >= 0 && diff <= 6 ? diff : 0;
}

export function StaffWorkspacePage({
  staffRemoteCreatePilot = false,
  staffRemoteWritePilot = false,
  staffInvitePilot = false,
  staffInviteSendOpen = false,
}: {
  staffRemoteCreatePilot?: boolean;
  staffRemoteWritePilot?: boolean;
  staffInvitePilot?: boolean;
  staffInviteSendOpen?: boolean;
}) {
  const { organization, currentLocation, locations, membership } = useOrganization();
  const isClient = useIsClient();
  const clientNow = useClientNow();
  const membershipRevision = useSyncExternalStore(
    subscribeOrganization,
    getOrganizationSnapshot,
    () => "",
  );
  const now = useMemo(
    () => (clientNow ? new Date(clientNow.getTime()) : new Date()),
    [clientNow],
  );

  const revision = useSyncExternalStore(
    subscribeStaffSchedule,
    getStaffScheduleRevision,
    () => "",
  );

  const locationId = currentLocation?.id ?? locations[0]?.id ?? "";
  const locationName = currentLocation?.name ?? locations[0]?.name ?? "分店";

  const [view, setView] = useState<StaffWorkspaceView>("staff");
  const [filter, setFilter] = useState<StaffEmploymentFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [mobileDayIndex, setMobileDayIndex] = useState(() => todayIndexInWeek(new Date()));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scheduleSyncBusy, setScheduleSyncBusy] = useState(false);
  const [cloudScheduleBusy, setCloudScheduleBusy] = useState(false);
  const [scheduleSyncMessage, setScheduleSyncMessage] = useState("");
  const [qvTab, setQvTab] = useState<"today" | "hours" | "breaks" | "timeoff">("today");
  const [quickOpen, setQuickOpen] = useState(false);
  const [breakDate, setBreakDate] = useState(() => formatYmd(new Date()));
  const [breakStart, setBreakStart] = useState("13:00");
  const [breakEnd, setBreakEnd] = useState("14:00");
  const [breakLabel, setBreakLabel] = useState("午休");
  const [offDate, setOffDate] = useState(() => formatYmd(new Date()));
  const [offStart, setOffStart] = useState("09:00");
  const [offEnd, setOffEnd] = useState("21:00");
  const [offReason, setOffReason] = useState("");
  const [cloudTimeOff, setCloudTimeOff] = useState<Array<{
    id: string; staffId: string; locationId: string; startAt: string;
    endAt: string; reason?: string; status: "REQUESTED" | "APPROVED" | "REJECTED";
    createdAt: string;
  }>>([]);
  const [cloudLeaveMessage, setCloudLeaveMessage] = useState("");
  const [cloudLeaveLoading, setCloudLeaveLoading] = useState(false);
  const [cloudLeaveLoaded, setCloudLeaveLoaded] = useState(false);
  const [cloudLeaveRevision, setCloudLeaveRevision] = useState(0);

  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [staffInvites, setStaffInvites] = useState<StaffInviteRecord[]>([]);
  const canAddStaff = canManageStaff(membership?.role);
  const remoteRosterLocked =
    isClient && organizationHasRemoteMemberships(organization.id);

  const memberships = useMemo(() => {
    void membershipRevision;
    if (!isClient) return [];
    return listMemberships(organization.id);
  }, [isClient, membershipRevision, organization.id]);

  useEffect(() => {
    if (!isClient) return;
    let cancelled = false;
    void listStaffLoginInvitesAction(organization.id).then((rows) => {
      if (!cancelled) setStaffInvites(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [isClient, organization.id, membershipRevision]);

  useEffect(() => {
    if (!isClient || !locationId) return;
    for (const membership of memberships) {
      if (!membership.isActive) continue;
      try {
        listWorkingHours(organization.id, {
          locationId,
          staffId: membership.userId,
        });
      } catch {
        /* inactive / location-denied stays unseeded */
      }
    }
  }, [isClient, locationId, memberships, organization.id, revision]);

  useEffect(() => {
    if (!isClient || !locationId || memberships.length === 0 || !remoteRosterLocked) return;
    let cancelled = false;
    const controller = new AbortController();
    const startingRevision = getStaffScheduleRevision();
    void (async () => {
      try {
        const response = await fetch("/api/staff/working-hours?locationId=" + encodeURIComponent(locationId), { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json();
        if (cancelled || !Array.isArray(result.rows) || result.rows.length === 0 || result.rows.length > 500) return;
        const rows = result.rows.map((row: {staff_id:string;day_of_week:number;start_time:string;end_time:string;is_working:boolean}) => ({
          staffId: row.staff_id, dayOfWeek: row.day_of_week as DayOfWeek,
          startTime: row.start_time.slice(0,5), endTime: row.end_time.slice(0,5), isWorking: row.is_working,
        }));
        const current = listWorkingHours(organization.id, { locationId });
        const same = current.length === rows.length && rows.every((row: {staffId:string;dayOfWeek:DayOfWeek;startTime:string;endTime:string;isWorking:boolean}) =>
          current.some(item => item.staffId === row.staffId && item.dayOfWeek === row.dayOfWeek &&
            item.startTime === row.startTime && item.endTime === row.endTime && item.isWorking === row.isWorking));
        if (same || cancelled || getStaffScheduleRevision() !== startingRevision) return;
        // Keep a recoverable browser snapshot before replacing stale local schedule.
        const backupKey = "beauty-os:cloud-schedule-backup:" + organization.id + ":" + locationId;
        if (current.length > 0) localStorage.setItem(backupKey, JSON.stringify(current));
        replaceLocationWorkingHoursFromCloud(organization.id, locationId, rows);
        setScheduleSyncMessage("已自動載入雲端最新班表（" + rows.length + " 筆）。");
      } catch {
        // Offline or unavailable cloud: leave existing browser schedule intact.
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [isClient, locationId, organization.id, memberships, remoteRosterLocked]);

  const workingHours = useMemo(() => {
    void revision;
    if (!isClient || !locationId) return [];
    return listWorkingHours(organization.id, { locationId });
  }, [isClient, locationId, organization.id, revision]);

  async function importBrowserSchedule() {
    if (!locationId || scheduleSyncBusy || !canAddStaff) return;
    const rows = listWorkingHours(organization.id, { locationId });
    if (rows.length === 0) { setScheduleSyncMessage("目前沒有可匯入的本機班表，未修改雲端資料。"); return; }
    if (!window.confirm("要將目前這個瀏覽器的 " + rows.length + " 筆排班首次匯入正式雲端嗎？如果雲端已有資料，系統會拒絕覆蓋。")) return;
    setScheduleSyncBusy(true);
    setScheduleSyncMessage("");
    try {
      const response = await fetch("/api/staff/working-hours", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, rows: rows.map(({ staffId, dayOfWeek, startTime, endTime, isWorking }) => ({ staffId, dayOfWeek, startTime, endTime, isWorking })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "IMPORT_FAILED");
      setScheduleSyncMessage("成功匯入 " + result.imported + " 筆班表。瀏覽器原始資料已保留。");
    } catch (error) {
      setScheduleSyncMessage("未完成匯入：" + (error instanceof Error ? error.message : "UNKNOWN_ERROR"));
    } finally { setScheduleSyncBusy(false); }
  }

  async function restoreCloudSchedule() {
    if (!locationId || cloudScheduleBusy || !canAddStaff) return;
    setCloudScheduleBusy(true);
    setScheduleSyncMessage("");
    try {
      const response = await fetch("/api/staff/working-hours?locationId=" + encodeURIComponent(locationId), { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "CLOUD_READ_FAILED");
      const rows: Array<{staff_id:string;day_of_week:number;start_time:string;end_time:string;is_working:boolean}> = result.rows ?? [];
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("雲端尚無班表，沒有修改本機資料");
      const localRows = listWorkingHours(organization.id, { locationId });
      if (localRows.length > 0) {
        setScheduleSyncMessage("雲端已讀取 " + rows.length + " 筆。本機已有 " + localRows.length + " 筆班表，為避免覆蓋，沒有自動還原。");
        return;
      }
      if (!window.confirm("本機沒有班表。要從雲端還原 " + rows.length + " 筆排班到這個瀏覽器嗎？")) return;
      const validStaff = new Set(memberships.filter(m => m.isActive).map(m => m.userId));
      for (const row of rows) {
        const start = row.start_time.slice(0, 5), end = row.end_time.slice(0, 5);
        if (!validStaff.has(row.staff_id) || !Number.isInteger(row.day_of_week) || row.day_of_week < 0 || row.day_of_week > 6 || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start >= end || typeof row.is_working !== "boolean") throw new Error("雲端班表驗證失敗，沒有還原");
      }
      for (const row of rows) {
        upsertWorkingHours(organization.id, { locationId, staffId: row.staff_id, dayOfWeek: row.day_of_week as DayOfWeek, startTime: row.start_time.slice(0, 5), endTime: row.end_time.slice(0, 5), isWorking: row.is_working });
      }
      setScheduleSyncMessage("已從雲端還原 " + rows.length + " 筆班表到這個瀏覽器；尚未啟用自動雙向同步。");
    } catch (error) {
      setScheduleSyncMessage("雲端讀取未完成：" + (error instanceof Error ? error.message : "UNKNOWN_ERROR"));
    } finally { setCloudScheduleBusy(false); }
  }

  const breaks = useMemo(() => {
    void revision;
    if (!isClient || !locationId) return [];
    return listBreaks(organization.id, { locationId });
  }, [isClient, locationId, organization.id, revision]);

  useEffect(() => {
    if (!isClient || !locationId || !remoteRosterLocked) {
      setCloudTimeOff([]);
      setCloudLeaveLoaded(false);
      setCloudLeaveLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setCloudTimeOff([]);
    setCloudLeaveLoaded(false);
    setCloudLeaveLoading(true);
    void (async () => {
      try {
        const response = await fetch("/api/staff/time-off?locationId=" + encodeURIComponent(locationId),
          { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("CLOUD_LEAVE_READ_FAILED");
        const payload: { rows?: Array<{
          id: string; staff_id: string; location_id: string;
          start_at: string; end_at: string; reason: string | null;
          status: "REQUESTED" | "APPROVED" | "REJECTED"; created_at: string;
        }> } = await response.json();
        if (!Array.isArray(payload.rows) || payload.rows.length > 200) throw new Error("INVALID_CLOUD_LEAVE");
        if (cancelled) return;
        setCloudTimeOff(payload.rows.map(row => ({
          id: row.id, staffId: row.staff_id, locationId: row.location_id,
          startAt: row.start_at, endAt: row.end_at,
          reason: row.reason || undefined, status: row.status, createdAt: row.created_at,
        })));
        setCloudLeaveLoaded(true);
        setCloudLeaveMessage("");
      } catch {
        if (!cancelled) setCloudLeaveMessage("雲端休假紀錄尚未載入，請確認資料表與權限設定。");
      } finally {
        if (!cancelled) setCloudLeaveLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [isClient, locationId, remoteRosterLocked, cloudLeaveRevision]);

  const timeOff = useMemo(() => {
    void revision;
    if (!isClient || !locationId) return [];
    const local = listTimeOff(organization.id, { locationId });
    if (remoteRosterLocked) return cloudTimeOff.map(row => ({ ...row, organizationId: organization.id }));
    return local;
  }, [isClient, locationId, organization.id, revision, cloudTimeOff, remoteRosterLocked]);

  const weekStart = useMemo(() => {
    const base = startOfStaffWeek(now);
    return addStaffWeekDays(base, weekOffset * 7);
  }, [now, weekOffset]);

  const pendingMembershipIds = useMemo(
    () => pendingInviteMembershipIds(staffInvites, now),
    [now, staffInvites],
  );

  const workspace = useMemo(
    () =>
      buildStaffWorkspace({
        organizationId: organization.id,
        locationId,
        locationName,
        memberships,
        workingHours,
        breaks,
        timeOff,
        now,
        weekStart,
        pendingInviteMembershipIds: pendingMembershipIds,
        staffInvites,
      }),
    [
      breaks,
      locationId,
      locationName,
      memberships,
      now,
      organization.id,
      pendingMembershipIds,
      staffInvites,
      timeOff,
      weekStart,
      workingHours,
    ],
  );

  const visible = useMemo(
    () => filterStaffRows(workspace.rows, filter, query),
    [filter, query, workspace.rows],
  );

  const selectedStillVisible = !shouldResetStaffSelection({
    selectedStaffId,
    visibleRows: visible,
  });
  const selectedRow = selectedStillVisible
    ? resolveSelectedStaffRow(workspace.rows, selectedStaffId)
    : null;
  const showQuickView = shouldRenderStaffQuickView(selectedRow);
  const selectedWeek = workspace.weekGrid.find((row) => row.staffId === selectedStaffId);
  const selectedInvite = selectedRow
    ? pickLatestStaffInviteForMembership(staffInvites, selectedRow.membershipId, now)
    : null;

  function refreshStaffInvites() {
    void listStaffLoginInvitesAction(organization.id).then(setStaffInvites);
  }
  const emptyCopy = staffEmptyCopy({
    hasStaff: workspace.rows.length > 0,
    filter,
    query,
  });
  const contextLabel = [organization.name, locationName].filter(Boolean).join(" · ");
  const summary = workspace.summary;
  const mobileColumn = workspace.weekColumns[mobileDayIndex] ?? workspace.weekColumns[0];

  function selectStaff(staffId: string) {
    setSelectedStaffId(staffId);
    setQvTab("today");
    setError("");
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, staffId: string) {
    if (!isStaffRowKeyboardActivation(event.key)) return;
    event.preventDefault();
    selectStaff(staffId);
  }

  function withError(action: () => void) {
    try {
      action();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法更新");
    }
  }

  async function submitTimeOffRequest() {
    if (!selectedStaffId || !locationId) return;
    setError("");
    try {
      const startAt = combineLocalDateTime(offDate, offStart).toISOString();
      const endAt = combineLocalDateTime(offDate, offEnd).toISOString();
      if (Date.parse(startAt) >= Date.parse(endAt)) throw new Error("休假結束時間必須晚於開始時間");
      const response = await fetch("/api/staff/time-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          locationId, staffId: selectedStaffId, startAt, endAt,
          reason: offReason || undefined,
          mode: canAddStaff ? "DIRECT" : "REQUEST",
        }),
      });
      const payload: { error?: string; row?: { id: string } } = await response.json();
      if (!response.ok || !payload.row?.id) {
        throw new Error(payload.error === "LEAVE_CREATE_FAILED"
          ? "休假雲端儲存失敗，請確認資料表已建立"
          : payload.error || "休假申請未成功儲存");
      }
      setOffReason("");
      setCloudLeaveRevision(value => value + 1);
      setNotice("休假已送出至雲端，等待審核；目前不會阻擋客人預約。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "休假申請失敗");
    }
  }

  async function rejectCloudLeave(id: string) {
    if (!canAddStaff || !locationId) return;
    if (!window.confirm("確定拒絕這筆休假申請？")) return;
    setError("");
    try {
      const response = await fetch("/api/staff/time-off", {
        method: "PATCH", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, locationId, decision: "REJECT" }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error || "休假審核失敗");
      setCloudLeaveRevision(value => value + 1);
      setNotice("休假申請已拒絕，雲端紀錄正在更新。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "休假審核失敗");
    }
  }

  function hoursForSelected() {
    if (!selectedStaffId) return [];
    return workingHours.filter((item) => item.staffId === selectedStaffId);
  }

  async function saveCloudDay(input: {staffId:string;dayOfWeek:DayOfWeek;startTime:string;endTime:string;isWorking:boolean}) {
    const response = await fetch("/api/staff/working-hours", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({locationId,...input}) });
    const result = await response.json();
    if (!response.ok || !result.saved) throw new Error(result.error || "SCHEDULE_SAVE_FAILED");
    upsertWorkingHours(organization.id, {locationId,...input});
  }

  async function mutateHours(
    dayOfWeek: DayOfWeek,
    patch: { isWorking?: boolean; startTime?: string; endTime?: string },
  ) {
    if (!selectedStaffId || scheduleSyncBusy) return;
    const current = hoursForSelected().find((item) => item.dayOfWeek === dayOfWeek);
    setScheduleSyncBusy(true);
    try {
      await saveCloudDay({staffId:selectedStaffId,dayOfWeek,
        startTime:patch.startTime ?? current?.startTime ?? "09:00",
        endTime:patch.endTime ?? current?.endTime ?? "21:00",
        isWorking:patch.isWorking ?? current?.isWorking ?? true});
      setError("");
      setScheduleSyncMessage("班表已儲存至雲端。");
    } catch (err) {
      setError("雲端儲存失敗，本機未修改：" + (err instanceof Error ? err.message : "UNKNOWN_ERROR"));
    } finally { setScheduleSyncBusy(false); }
  }

  function handleStaffCreated(result: {
    membership: { userId: string };
    roster?: unknown;
    scheduleError: string | null;
    remote?: boolean;
    notice?: string;
  }) {
    setOnboardingOpen(false);
    setFilter("all");
    setQuery("");
    setView("staff");
    selectStaff(result.membership.userId);
    if (result.remote) {
      setNotice(result.notice || "員工已建立");
      setError("");
      refreshStaffInvites();
    }
    if (result.scheduleError) {
      setError(`員工已建立，但初始班表儲存失敗：${result.scheduleError}`);
    }
  }

  function saveSelectedProfile(patch: {
    displayName: string;
    role: StaffRole;
    locationIds: string[];
  }) {
    if (!selectedRow) return;
    withError(() => {
      updateMembership(organization.id, selectedRow.membershipId, patch);
    });
  }

  function setSelectedActive(isActive: boolean) {
    if (!selectedRow) return;
    withError(() => {
      updateMembership(organization.id, selectedRow.membershipId, { isActive });
    });
  }

  async function applyPattern(pattern: "mon-fri" | "mon-sat") {
    if (!selectedStaffId || scheduleSyncBusy) return;
    const drafts = planApplyWorkingHoursPattern({ locationId, staffId: selectedStaffId, hours: hoursForSelected(), pattern });
    setScheduleSyncBusy(true);
    try {
      for (const draft of drafts) await saveCloudDay(draft);
      setError("");
      setScheduleSyncMessage("排班範本已逐日儲存至雲端。");
      setQuickOpen(false);
    } catch (err) {
      setError("範本儲存中斷，部分日期可能已更新，請檢查班表：" + (err instanceof Error ? err.message : "UNKNOWN_ERROR"));
    } finally { setScheduleSyncBusy(false); }
  }

  const emptyAll = isClient && workspace.rows.length === 0;
  const emptyFiltered = isClient && workspace.rows.length > 0 && visible.length === 0;

  return (
    <div
      data-staff-workspace
      data-has-quickview={showQuickView ? "true" : "false"}
      className="min-w-0"
    >
      <header className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">
            {PLATFORM_NAME}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            員工
          </h1>
          <p className="text-sm text-secondary-text">管理團隊成員、排班與休假</p>
          {contextLabel ? (
            <p className="text-[12px] text-secondary-text/80">{contextLabel}</p>
          ) : null}
          {notice ? (
            <p className="text-[13px] text-primary" data-staff-create-success role="status">
              {notice}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-start gap-2">
          {canAddStaff ? (
            <Button
              data-staff-add
              className="h-9 min-h-9 rounded-full px-3 text-[13px] sm:px-4"
              onClick={() => {
                setOnboardingOpen(true);
                setError("");
                setNotice("");
              }}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新增員工
            </Button>
          ) : null}
          {canAddStaff && <button type="button" disabled={cloudScheduleBusy} onClick={() => void restoreCloudSchedule()} className="inline-flex h-9 items-center rounded-full border border-border bg-surface px-4 text-[13px] font-medium text-text disabled:opacity-50">{cloudScheduleBusy ? "讀取中…" : "從雲端還原班表"}</button>}
          {canAddStaff && <button type="button" disabled={scheduleSyncBusy} onClick={() => void importBrowserSchedule()} className="inline-flex h-9 items-center rounded-full border border-border bg-surface px-4 text-[13px] font-medium text-text disabled:opacity-50">{scheduleSyncBusy ? "匯入中…" : "首次匯入雲端班表"}</button>}
          <a href="/staff/staff/scheduling" className="inline-flex h-9 items-center rounded-full border border-border bg-surface px-4 text-[13px] font-medium text-text hover:bg-primary-light/30">人員排班與休假</a>
          <div className="hidden w-[220px] shrink-0 min-[720px]:block">
            <OrgLocationSwitcher compact />
          </div>
        </div>
      </header>

      {scheduleSyncMessage && <p role="status" className="mb-3 rounded-xl border border-border bg-surface p-3 text-sm text-text">{scheduleSyncMessage}</p>}
      <div className="mb-3 min-[720px]:hidden">
        <OrgLocationSwitcher compact />
      </div>

      {remoteRosterLocked && !canAddStaff && (cloudLeaveLoading || cloudLeaveMessage) && (
        <p role="status" className="mb-3 rounded-xl border border-border bg-surface p-3 text-sm text-text">
          {cloudLeaveLoading ? "正在載入雲端休假紀錄…" : cloudLeaveMessage}
        </p>
      )}
      {remoteRosterLocked && canAddStaff && (
        <section className="mb-4 rounded-2xl border border-border bg-white p-4">
          <h2 className="text-base font-semibold text-text">休假待審核</h2>
          <p className="mt-1 text-xs text-secondary-text">核准功能須等預約衝突檢查完成後開放。</p>
          {cloudLeaveMessage && <p role="status" className="mt-2 text-sm text-secondary-text">{cloudLeaveMessage}</p>}
          {cloudLeaveLoading && <p role="status" className="mt-2 text-sm text-secondary-text">正在載入雲端休假紀錄…</p>}
          <div className="mt-3 space-y-2">
            {cloudLeaveLoaded && cloudTimeOff.filter(row => row.status === "REQUESTED").length === 0 && (
              <p className="text-sm text-secondary-text">目前沒有待審核的雲端休假申請。</p>
            )}
            {cloudTimeOff.filter(row => row.status === "REQUESTED").map(row => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
                <div className="text-sm text-text">
                  <strong>{memberships.find(item => item.userId === row.staffId)?.userId ?? row.staffId}</strong>
                  <div>{new Date(row.startAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} 至 {new Date(row.endAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</div>
                  {row.reason && <div className="text-secondary-text">{row.reason}</div>}
                </div>
                <button type="button" onClick={() => void rejectCloudLeave(row.id)}
                  className="rounded-lg border border-border px-3 py-2 text-sm text-text hover:bg-gray-50">拒絕申請</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-2.5 grid grid-cols-2 gap-2 min-[1200px]:grid-cols-4 min-[1200px]:gap-3">
        <SummaryCard
          label="在職員工"
          value={isClient ? summary.activeCount : "—"}
          hint={isClient ? `${summary.inactiveCount} 位停用` : undefined}
          accent="rose"
        />
        <SummaryCard
          label="今日上班"
          value={isClient ? summary.todayWorkingCount : "—"}
          hint={
            isClient
              ? `${formatStaffPercent(summary.todayWorkingRate)} 在職人員`
              : undefined
          }
          accent="green"
        />
        <SummaryCard
          label="今日休假"
          value={isClient ? summary.todayTimeOffCount : "—"}
          hint={
            isClient
              ? `${formatStaffPercent(summary.todayTimeOffRate)} 在職人員`
              : undefined
          }
          accent="muted-rose"
        />
        <SummaryCard
          label="本週排班時數"
          value={isClient ? formatStaffHoursValue(summary.weeklyScheduledMinutes) : "—"}
          hint={
            isClient
              ? `平均 ${formatStaffAverageHours(summary.weeklyAverageMinutes)} / 人`
              : undefined
          }
          accent="neutral"
        />
      </section>

      <div
        data-staff-view-switch
        className="mb-2.5 inline-flex rounded-xl border border-border bg-surface p-1"
        role="tablist"
        aria-label="員工檢視"
      >
        {STAFF_VIEW_OPTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={view === entry.id}
            data-staff-view={entry.id}
            className={cn(
              "h-9 min-h-9 rounded-lg px-4 text-[13px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              view === entry.id
                ? "bg-primary text-white"
                : "bg-transparent text-secondary-text hover:text-text",
            )}
            onClick={() => setView(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div
        data-staff-workspace-split
        data-staff-gap={showQuickView && view === "staff" ? STAFF_WORKSPACE_GAP_PX : 0}
        className={cn(
          "flex items-start",
          showQuickView && view === "staff" && "min-[1200px]:gap-4",
        )}
      >
        <div className="min-w-0 flex-1">
          {view === "staff" ? (
            <>
              <div
                data-staff-toolbar
                className="mb-2.5 rounded-2xl border border-border bg-surface px-3 py-2"
              >
                <div className="flex flex-col gap-2 min-[720px]:flex-row min-[720px]:items-center min-[720px]:justify-between">
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {STAFF_EMPLOYMENT_FILTER_OPTIONS.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        data-staff-filter={entry.id}
                        onClick={() => setFilter(entry.id)}
                        className={cn(
                          "h-7 min-h-7 shrink-0 rounded-full px-2.5 text-[12px] font-medium transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                          filter === entry.id
                            ? "bg-primary text-white"
                            : "bg-[#F6F1EE] text-text hover:bg-primary-light",
                        )}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                  <div className="relative min-w-0 w-full min-[720px]:max-w-md">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary-text"
                      aria-hidden
                    />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜尋員工姓名、職稱"
                      className="h-9 min-h-9 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[13px] text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
                      aria-label="搜尋員工姓名、職稱"
                    />
                  </div>
                </div>
              </div>

              {!isClient ? (
                <ListSkeleton />
              ) : emptyAll || emptyFiltered ? (
                <Card data-staff-empty={emptyCopy.kind} padding="lg" className="text-center">
                  <p className="text-[15px] font-medium text-text">{emptyCopy.title}</p>
                  {emptyCopy.showClear ? (
                    <div className="mt-4 inline-flex">
                      <Button
                        variant="outline"
                        className="h-10 min-h-10 rounded-full px-4 text-[13px]"
                        onClick={() => {
                          setFilter("all");
                          setQuery("");
                        }}
                      >
                        清除篩選
                      </Button>
                    </div>
                  ) : null}
                </Card>
              ) : (
                <>
                  <div
                    data-staff-list
                    className="hidden overflow-hidden rounded-2xl border border-border bg-surface min-[1200px]:block"
                  >
                    {visible.map((row) => (
                      <DesktopRow
                        key={row.staffId}
                        row={row}
                        selected={selectedStaffId === row.staffId}
                        onSelect={selectStaff}
                        onPointerDown={selectFromPointer}
                        onKeyDown={handleRowKeyDown}
                      />
                    ))}
                  </div>
                  <div
                    data-staff-mobile-list
                    className="space-y-2.5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] min-[1200px]:hidden"
                  >
                    {visible.map((row) => (
                      <MobileCard
                        key={row.staffId}
                        row={row}
                        selected={selectedStaffId === row.staffId}
                        onSelect={selectStaff}
                        onPointerDown={selectFromPointer}
                        onKeyDown={handleRowKeyDown}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <WeeklySchedule
              workspace={workspace}
              visibleStaffIds={new Set(visible.map((row) => row.staffId))}
              mobileColumn={mobileColumn}
              mobileDayIndex={mobileDayIndex}
              canQuickSet={Boolean(selectedRow?.isActive)}
              quickOpen={quickOpen}
              weekOffset={weekOffset}
              onWeekOffset={(next) => {
                setWeekOffset(next);
                setMobileDayIndex(next === 0 ? todayIndexInWeek(now) : 0);
              }}
              onMobileDayIndex={setMobileDayIndex}
              onQuickOpen={setQuickOpen}
              onApplyPattern={applyPattern}
              onSelectStaff={selectStaff}
            />
          )}
        </div>

        {showQuickView && selectedRow && view === "staff" ? (
          <div className="hidden min-[1200px]:block">
            <StaffQuickView
              key={selectedRow.staffId}
              row={selectedRow}
              weekRow={selectedWeek}
              hours={hoursForSelected()}
              breaks={breaks}
              timeOff={timeOff}
              organizationId={organization.id}
              locationId={locationId}
              now={now}
              canEdit={selectedRow.isActive}
              error={error}
              breakDate={breakDate}
              breakStart={breakStart}
              breakEnd={breakEnd}
              breakLabel={breakLabel}
              offDate={offDate}
              offStart={offStart}
              offEnd={offEnd}
              offReason={offReason}
              tab={qvTab}
              onTabChange={setQvTab}
              onClose={() => setSelectedStaffId(null)}
              onToggleWorking={(day, isWorking) => mutateHours(day, { isWorking })}
              onChangeHours={(day, field, value) => mutateHours(day, { [field]: value })}
              onApplyPattern={applyPattern}
              onCreateBreak={() =>
                selectedStaffId &&
                withError(() => {
                  createBreak(organization.id, {
                    locationId,
                    staffId: selectedStaffId,
                    startAt: combineLocalDateTime(breakDate, breakStart).toISOString(),
                    endAt: combineLocalDateTime(breakDate, breakEnd).toISOString(),
                    label: breakLabel || "休息",
                  });
                })
              }
              onDeleteBreak={(id) => withError(() => deleteBreak(organization.id, id))}
              onCreateTimeOff={() => { void submitTimeOffRequest(); }}
              onDeleteTimeOff={(id) => {
                if (cloudTimeOff.some(row => row.id === id)) {
                  setError("雲端休假紀錄不能只從本機刪除，請透過店長審核流程處理。");
                  return;
                }
                withError(() => deleteTimeOff(organization.id, id));
              }}
              onBreakDate={setBreakDate}
              onBreakStart={setBreakStart}
              onBreakEnd={setBreakEnd}
              onBreakLabel={setBreakLabel}
              onOffDate={setOffDate}
              onOffStart={setOffStart}
              onOffEnd={setOffEnd}
              onOffReason={setOffReason}
              canManage={canAddStaff}
              locations={locations}
              isCurrentUser={selectedRow.staffId === membership?.userId}
              onSaveProfile={saveSelectedProfile}
              onSetActive={setSelectedActive}
              invitePilotEnabled={staffInvitePilot}
              inviteSendOpen={staffInviteSendOpen}
              actorRole={membership?.role ?? null}
              actorActive={membership?.isActive ?? false}
              pendingInvite={selectedInvite}
              onInviteChanged={refreshStaffInvites}
            />
          </div>
        ) : null}
      </div>

      {showQuickView && selectedRow ? (
        <div className="min-[1200px]:hidden">
          <StaffQuickView
            key={selectedRow.staffId}
            row={selectedRow}
            weekRow={selectedWeek}
            hours={hoursForSelected()}
            breaks={breaks}
            timeOff={timeOff}
            organizationId={organization.id}
            locationId={locationId}
            now={now}
            canEdit={selectedRow.isActive}
            error={error}
            breakDate={breakDate}
            breakStart={breakStart}
            breakEnd={breakEnd}
            breakLabel={breakLabel}
            offDate={offDate}
            offStart={offStart}
            offEnd={offEnd}
            offReason={offReason}
            tab={qvTab}
            onTabChange={setQvTab}
            onClose={() => setSelectedStaffId(null)}
            onToggleWorking={(day, isWorking) => mutateHours(day, { isWorking })}
            onChangeHours={(day, field, value) => mutateHours(day, { [field]: value })}
            onApplyPattern={applyPattern}
            onCreateBreak={() =>
              selectedStaffId &&
              withError(() => {
                createBreak(organization.id, {
                  locationId,
                  staffId: selectedStaffId,
                  startAt: combineLocalDateTime(breakDate, breakStart).toISOString(),
                  endAt: combineLocalDateTime(breakDate, breakEnd).toISOString(),
                  label: breakLabel || "休息",
                });
              })
            }
            onDeleteBreak={(id) => withError(() => deleteBreak(organization.id, id))}
            onCreateTimeOff={() => { void submitTimeOffRequest(); }}
            onDeleteTimeOff={(id) => {
                if (cloudTimeOff.some(row => row.id === id)) {
                  setError("雲端休假紀錄不能只從本機刪除，請透過店長審核流程處理。");
                  return;
                }
                withError(() => deleteTimeOff(organization.id, id));
              }}
            onBreakDate={setBreakDate}
            onBreakStart={setBreakStart}
            onBreakEnd={setBreakEnd}
            onBreakLabel={setBreakLabel}
            onOffDate={setOffDate}
            onOffStart={setOffStart}
            onOffEnd={setOffEnd}
            onOffReason={setOffReason}
            canManage={canAddStaff}
            locations={locations}
            isCurrentUser={selectedRow.staffId === membership?.userId}
            onSaveProfile={saveSelectedProfile}
            onSetActive={setSelectedActive}
            invitePilotEnabled={staffInvitePilot}
            inviteSendOpen={staffInviteSendOpen}
            actorRole={membership?.role ?? null}
            actorActive={membership?.isActive ?? false}
            pendingInvite={selectedInvite}
            onInviteChanged={refreshStaffInvites}
          />
        </div>
      ) : null}

      {onboardingOpen ? (
        <StaffOnboardingDialog
          open
          organizationId={organization.id}
          locations={locations}
          actorRole={membership?.role}
          defaultLocationId={locationId}
          remoteCreateEnabled={staffRemoteCreatePilot}
          remoteWriteEnabled={staffRemoteWritePilot}
          remoteRosterLocked={remoteRosterLocked && !staffRemoteCreatePilot && !staffRemoteWritePilot}
          canonicalLocationIds={[
            ...new Set(memberships.flatMap((row) => row.locationIds)),
          ]}
          onClose={() => {
            setOnboardingOpen(false);
            queueMicrotask(() => {
              document.querySelector<HTMLElement>("[data-staff-add]")?.focus();
            });
          }}
          onCreated={(result) => {
            if (result.remote && result.roster?.length) {
              applyRemoteMembershipsToClient(result.roster);
              emitOrgChange();
            } else if (result.remote && result.membershipFull) {
              applyRemoteMembershipsToClient([result.membershipFull]);
              emitOrgChange();
            }
            handleStaffCreated(result);
          }}
        />
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number | string;
  hint?: string;
  accent: "rose" | "green" | "muted-rose" | "neutral";
}) {
  return (
    <div
      data-staff-summary
      data-accent={accent}
      className="flex h-[100px] min-h-[96px] max-h-[110px] min-w-0 flex-col justify-center rounded-2xl border border-border bg-surface px-3.5 py-3"
    >
      <p className="text-[11px] text-secondary-text">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-[24px] font-semibold leading-none tracking-tight tabular-nums sm:text-[26px]",
          accent === "rose" && "text-primary",
          accent === "green" && "text-[#5C7F66]",
          accent === "muted-rose" && "text-[#C49A9A]",
          accent === "neutral" && "text-text",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 truncate text-[11px] text-secondary-text">{hint}</p>
      ) : null}
    </div>
  );
}

interface RowProps {
  row: StaffWorkspaceRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onPointerDown: (event: SyntheticEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void;
}

const STATUS_PILL: Record<StaffWorkspaceRow["todayStatus"], string> = {
  working: "bg-[#E7F0EA] text-[#5C7F66]",
  time_off: "bg-[#F6EEEE] text-[#C49A9A]",
  off: "bg-[#F1EEEC] text-[#7A7272]",
  inactive: "bg-[#F1EEEC] text-[#7A7272]",
};

function DesktopRow({ row, selected, onSelect, onPointerDown, onKeyDown }: RowProps) {
  return (
    <div
      data-staff-row
      data-staff-id={row.staffId}
      aria-pressed={selected}
      className={cn(
        "relative flex min-h-[74px] cursor-pointer items-center justify-between gap-3 border-b border-[#EFE8E4]/80 px-4 last:border-b-0",
        "hover:bg-[#F7F2F0]",
        selected && "bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.staffId)}
    >
      {selected ? (
        <span
          data-staff-row-accent
          className="pointer-events-none absolute inset-y-0 left-0 z-20 w-[3px] bg-[#C56B70]"
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        data-staff-row-focus
        aria-label={`${row.displayName}，開啟員工詳情`}
        aria-pressed={selected}
        className="absolute inset-0 z-10 cursor-pointer rounded-none bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
        onPointerDown={onPointerDown}
        onMouseDown={onPointerDown}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(row.staffId);
        }}
        onKeyDown={(event) => onKeyDown(event, row.staffId)}
      />
      <div className="pointer-events-none relative z-0 flex min-w-0 items-center gap-2.5">
        <Avatar initials={row.initials} size="sm" className="gap-0" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-text">{row.displayName}</p>
          <p className="truncate text-[12px] text-secondary-text">
            {[row.title, row.roleLabel, row.locationLabel].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <div className="pointer-events-none relative z-0 flex shrink-0 items-center gap-3">
        <p className="text-[13px] tabular-nums text-secondary-text">{row.todayHoursLabel}</p>
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
            STATUS_PILL[row.todayStatus],
          )}
        >
          {row.todayStatusLabel}
        </span>
        <ChevronRight className="h-4 w-4 text-secondary-text" aria-hidden />
      </div>
    </div>
  );
}

function MobileCard({ row, selected, onSelect, onPointerDown, onKeyDown }: RowProps) {
  return (
    <div
      data-staff-row
      data-staff-id={row.staffId}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${row.displayName}，開啟員工詳情`}
      className={cn(
        "cursor-pointer rounded-2xl border border-border bg-surface px-3.5 py-3 outline-none transition-colors",
        "hover:border-primary/30 focus-visible:bg-primary-light/30",
        selected && "border-primary/40 bg-[#FBF4F3]",
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      onClick={() => onSelect(row.staffId)}
      onKeyDown={(event) => onKeyDown(event, row.staffId)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-text">{row.displayName}</p>
          <p className="truncate text-[12px] text-[#6E6666]">
            {[row.title, row.roleLabel, row.locationLabel].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 text-[12px] text-secondary-text">{row.todayHoursLabel}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
              STATUS_PILL[row.todayStatus],
            )}
          >
            {row.todayStatusLabel}
          </span>
          <ChevronRight className="h-4 w-4 text-secondary-text" aria-hidden />
        </div>
      </div>
    </div>
  );
}

function WeeklySchedule({
  workspace,
  visibleStaffIds,
  mobileColumn,
  mobileDayIndex,
  canQuickSet,
  quickOpen,
  weekOffset,
  onWeekOffset,
  onMobileDayIndex,
  onQuickOpen,
  onApplyPattern,
  onSelectStaff,
}: {
  workspace: ReturnType<typeof buildStaffWorkspace>;
  visibleStaffIds: Set<string>;
  mobileColumn: ReturnType<typeof buildStaffWorkspace>["weekColumns"][number] | undefined;
  mobileDayIndex: number;
  canQuickSet: boolean;
  quickOpen: boolean;
  weekOffset: number;
  onWeekOffset: (value: number) => void;
  onMobileDayIndex: (value: number) => void;
  onQuickOpen: (value: boolean) => void;
  onApplyPattern: (pattern: "mon-fri" | "mon-sat") => void;
  onSelectStaff: (staffId: string) => void;
}) {
  const grid = workspace.weekGrid.filter((row) => visibleStaffIds.has(row.staffId));

  return (
    <section data-staff-week className="min-w-0">
      <div className="mb-3 flex flex-col gap-2 min-[720px]:flex-row min-[720px]:items-center min-[720px]:justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-text">本週排班</h2>
          <p className="text-[12px] text-secondary-text">{workspace.weekLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-border bg-surface p-0.5">
            <button
              type="button"
              className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label="上一週"
              onClick={() => onWeekOffset(weekOffset - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={cn(
                "h-9 rounded-lg px-3 text-[12px] font-medium",
                weekOffset === 0 ? "bg-primary text-white" : "text-secondary-text",
              )}
              onClick={() => onWeekOffset(0)}
            >
              本週
            </button>
            <button
              type="button"
              className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label="下一週"
              onClick={() => onWeekOffset(weekOffset + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {canQuickSet ? (
            <div className="relative">
              <Button
                variant="outline"
                className="h-9 min-h-9 rounded-full px-3 text-[12px]"
                onClick={() => onQuickOpen(!quickOpen)}
              >
                快速設定
              </Button>
              {quickOpen ? (
                <div className="absolute right-0 z-10 mt-1 w-40 rounded-xl border border-border bg-surface p-1 shadow-[0_8px_20px_rgba(48,43,43,0.08)]">
                  <button
                    type="button"
                    className="flex h-9 w-full items-center rounded-lg px-2 text-left text-[12px] hover:bg-primary-light/40"
                    onClick={() => onApplyPattern("mon-fri")}
                  >
                    套用週一到週五
                  </button>
                  <button
                    type="button"
                    className="flex h-9 w-full items-center rounded-lg px-2 text-left text-[12px] hover:bg-primary-light/40"
                    onClick={() => onApplyPattern("mon-sat")}
                  >
                    套用週一到週六
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {grid.length === 0 ? (
        <Card padding="lg" className="text-center">
          <p className="text-[15px] font-medium text-text">尚無員工資料</p>
        </Card>
      ) : (
        <>
          <div
            data-staff-week-grid
            className="hidden overflow-x-auto rounded-2xl border border-border bg-surface min-[1200px]:block"
          >
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="bg-[#FAF7F5]/80 text-[11px] text-secondary-text">
                  <th className="px-3 py-2 font-medium">員工</th>
                  {workspace.weekColumns.map((column) => (
                    <th key={column.ymd} className="px-2 py-2 text-center font-medium">
                      {column.headerLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((row) => (
                  <tr key={row.staffId} className="border-t border-[#EFE8E4]/80">
                    <th className="px-3 py-2 text-left text-[13px] font-semibold text-text">
                      <button
                        type="button"
                        className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        onClick={() => onSelectStaff(row.staffId)}
                      >
                        {row.displayName}
                      </button>
                    </th>
                    {row.cells.map((cell) => (
                      <td key={cell.ymd} className="px-1.5 py-1.5">
                        <div
                          data-staff-week-cell={cell.kind}
                          className={cn(
                            "rounded-lg px-1.5 py-2 text-center text-[11px] tabular-nums",
                            cell.kind === "working" && "bg-[#E7F0EA]/70 text-[#5C7F66]",
                            (cell.kind === "time_off" || cell.kind === "off") &&
                              "bg-[#F6EEEE]/80 text-[#C49A9A]",
                            cell.kind === "mixed" && "bg-[#F8F1E8] text-[#8A7E76]",
                            cell.kind === "unset" && "bg-[#F7F4F2] text-secondary-text",
                          )}
                        >
                          {cell.compactLabel}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div data-staff-mobile-week className="min-[1200px]:hidden">
            <div className="mb-3 flex items-center justify-between rounded-2xl border border-border bg-surface px-2 py-1.5">
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label="前一天"
                onClick={() =>
                  onMobileDayIndex(
                    mobileDayIndex <= 0
                      ? workspace.weekColumns.length - 1
                      : mobileDayIndex - 1,
                  )
                }
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <p className="text-[13px] font-medium text-text">
                {mobileColumn
                  ? `${mobileColumn.date.getMonth() + 1}/${mobileColumn.date.getDate()}（${mobileColumn.headerLabel.slice(0, 1)}）`
                  : ""}
              </p>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label="後一天"
                onClick={() =>
                  onMobileDayIndex(
                    mobileDayIndex >= workspace.weekColumns.length - 1
                      ? 0
                      : mobileDayIndex + 1,
                  )
                }
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-2 text-[12px] text-secondary-text">今天排班</p>
            <div className="space-y-2">
              {grid.map((row) => {
                const cell = mobileColumn
                  ? row.cells.find((item) => item.ymd === mobileColumn.ymd)
                  : row.cells[0];
                return (
                  <button
                    key={row.staffId}
                    type="button"
                    className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    onClick={() => onSelectStaff(row.staffId)}
                  >
                    <span className="text-[14px] font-semibold text-text">{row.displayName}</span>
                    <span
                      className={cn(
                        "rounded-lg px-2 py-1 text-[12px] tabular-nums",
                        cell?.kind === "working" && "bg-[#E7F0EA]/70 text-[#5C7F66]",
                        (cell?.kind === "time_off" || cell?.kind === "off") &&
                          "bg-[#F6EEEE]/80 text-[#C49A9A]",
                        cell?.kind === "mixed" && "bg-[#F8F1E8] text-[#8A7E76]",
                        cell?.kind === "unset" && "text-secondary-text",
                      )}
                    >
                      {cell?.kind === "working"
                        ? `${cell.segments[0]?.startHm}–${cell.segments[0]?.endHm}`
                        : cell?.kind === "mixed"
                          ? cell.compactLabel
                          : "休假"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
