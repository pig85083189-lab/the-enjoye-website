"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { formatYmd } from "@/lib/appointments/domain";
import {
  DAY_OF_WEEK_LABEL,
  type DayOfWeek,
} from "@/lib/staff-schedule/domain";
import {
  STAFF_ONBOARDING_ROLES,
  STAFF_ROLE_PRESENTATION,
  toggleOnboardingLocation,
} from "@/lib/staff/staff-onboarding-derived";
import {
  STAFF_WORKSPACE_PANEL_WIDTH_PX,
  formatStaffHoursValue,
  listStaffBreakViews,
  listUpcomingTimeOff,
  type StaffWeekGridRow,
  type StaffWorkspaceRow,
} from "@/lib/staff/staff-workspace-derived";
import type { StaffBreak, StaffTimeOff, StaffWorkingHours } from "@/lib/staff-schedule/domain";
import type { Location, StaffRole } from "@/types/saas";
import { StaffInvitePanel } from "@/features/staff/StaffInvitePanel";
import type { StaffInviteRecord } from "@/lib/staff-auth/staff-invite-command";
import { staffInviteLifecycleLabel } from "@/lib/staff-auth/staff-invite-visibility";
import { cn } from "@/lib/utils";

const DAYS: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];

export type StaffQuickViewTab =
  | "today"
  | "hours"
  | "breaks"
  | "timeoff";

const TABS: Array<{ id: StaffQuickViewTab; label: string }> = [
  { id: "today", label: "今日概況" },
  { id: "hours", label: "固定班表" },
  { id: "breaks", label: "休息時間" },
  { id: "timeoff", label: "休假 / 請假" },
];

interface StaffQuickViewProps {
  row: StaffWorkspaceRow;
  weekRow: StaffWeekGridRow | undefined;
  hours: StaffWorkingHours[];
  breaks: StaffBreak[];
  timeOff: StaffTimeOff[];
  organizationId: string;
  locationId: string;
  now: Date;
  canEdit: boolean;
  error?: string;
  breakDate: string;
  breakStart: string;
  breakEnd: string;
  breakLabel: string;
  offDate: string;
  offStart: string;
  offEnd: string;
  offReason: string;
  tab: StaffQuickViewTab;
  onTabChange: (tab: StaffQuickViewTab) => void;
  onClose: () => void;
  onToggleWorking: (dayOfWeek: DayOfWeek, isWorking: boolean) => void;
  onChangeHours: (dayOfWeek: DayOfWeek, field: "startTime" | "endTime", value: string) => void;
  onApplyPattern: (pattern: "mon-fri" | "mon-sat") => void;
  onCreateBreak: () => void;
  onDeleteBreak: (breakId: string) => void;
  onCreateTimeOff: () => void;
  onDeleteTimeOff: (timeOffId: string) => void;
  onBreakDate: (value: string) => void;
  onBreakStart: (value: string) => void;
  onBreakEnd: (value: string) => void;
  onBreakLabel: (value: string) => void;
  onOffDate: (value: string) => void;
  onOffStart: (value: string) => void;
  onOffEnd: (value: string) => void;
  onOffReason: (value: string) => void;
  canManage?: boolean;
  locations?: Location[];
  isCurrentUser?: boolean;
  onSaveProfile?: (patch: {
    displayName: string;
    role: StaffRole;
    locationIds: string[];
  }) => void;
  onSetActive?: (isActive: boolean) => void;
  invitePilotEnabled?: boolean;
  inviteSendOpen?: boolean;
  actorRole?: StaffRole | null;
  actorActive?: boolean;
  pendingInvite?: StaffInviteRecord | null;
  onInviteChanged?: () => void;
}

export function StaffQuickView({
  row,
  weekRow,
  hours,
  breaks,
  timeOff,
  organizationId,
  locationId,
  now,
  canEdit,
  error = "",
  breakDate,
  breakStart,
  breakEnd,
  breakLabel,
  offDate,
  offStart,
  offEnd,
  offReason,
  tab,
  onTabChange,
  onClose,
  onToggleWorking,
  onChangeHours,
  onApplyPattern,
  onCreateBreak,
  onDeleteBreak,
  onCreateTimeOff,
  onDeleteTimeOff,
  onBreakDate,
  onBreakStart,
  onBreakEnd,
  onBreakLabel,
  onOffDate,
  onOffStart,
  onOffEnd,
  onOffReason,
  canManage = false,
  locations = [],
  isCurrentUser = false,
  onSaveProfile,
  onSetActive,
  invitePilotEnabled = false,
  inviteSendOpen = false,
  actorRole = null,
  actorActive = false,
  pendingInvite = null,
  onInviteChanged,
}: StaffQuickViewProps) {
  const upcoming = listUpcomingTimeOff({
    timeOff,
    organizationId,
    locationId,
    staffId: row.staffId,
    now,
  });
  const breakViews = listStaffBreakViews({
    breaks,
    organizationId,
    locationId,
    staffId: row.staffId,
  });
  const stats = weekRow?.stats;
  const [applyOpen, setApplyOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(row.displayName);
  const [editRole, setEditRole] = useState<StaffRole>(row.role);
  const [editLocationIds, setEditLocationIds] = useState(row.locationIds);

  return (
    <>
      <button
        type="button"
        className="fixed inset-x-0 top-0 z-30 bg-text/25 min-[1200px]:hidden bottom-[calc(3.5rem+env(safe-area-inset-bottom))]"
        aria-label="關閉員工詳情"
        onClick={onClose}
      />
      <aside
        data-staff-quickview
        data-staff-panel-width={STAFF_WORKSPACE_PANEL_WIDTH_PX}
        data-staff-id={row.staffId}
        role="dialog"
        aria-modal="true"
        aria-label={`${row.displayName}的員工詳情`}
        className={cn(
          "z-30 flex flex-col overflow-hidden border border-border bg-surface",
          "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-h-[min(88vh,calc(100dvh-4.5rem-env(safe-area-inset-bottom)))] rounded-t-3xl shadow-[0_-4px_24px_rgba(48,43,43,0.08)]",
          "min-[1200px]:relative min-[1200px]:inset-auto min-[1200px]:z-0 min-[1200px]:h-auto min-[1200px]:max-h-[calc(100dvh-6.5rem)] min-[1200px]:w-[400px] min-[1200px]:min-w-[400px] min-[1200px]:shrink-0 min-[1200px]:rounded-2xl min-[1200px]:shadow-none",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-5 pt-3.5 pb-1">
            <p className="text-[13px] font-medium tracking-wide text-secondary-text">
              員工詳情
            </p>
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary-text hover:bg-primary-light/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label="關閉"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <div className="flex items-start gap-3 pb-3">
              <Avatar initials={row.initials} size="md" className="gap-0" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[16px] font-semibold text-text">
                  {row.displayName}
                </h2>
                <p className="mt-0.5 truncate text-[12px] text-secondary-text">
                  {[row.title, row.roleLabel, row.locationLabel].filter(Boolean).join(" · ")}
                </p>
                <span
                  className={cn(
                    "mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                    row.isActive
                      ? "bg-[#E7F0EA] text-[#5C7F66]"
                      : "bg-[#F1EEEC] text-[#7A7272]",
                  )}
                >
                  {row.employmentLabel}
                </span>
                <p
                  className="mt-1.5 text-[12px] text-secondary-text"
                  data-staff-login-binding
                  data-staff-invite-lifecycle={row.inviteLifecycle}
                >
                  登入權限 · {staffInviteLifecycleLabel(row.inviteLifecycle)}
                </p>
              </div>
            </div>

            <div
              data-staff-qv-tabs
              className="mb-3 flex gap-1 rounded-xl bg-[#F7F4F2] p-1"
              role="tablist"
              aria-label="員工詳情分頁"
            >
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id}
                  data-staff-tab={entry.id}
                  className={cn(
                    "min-h-8 flex-1 rounded-lg px-1.5 text-[11px] font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    tab === entry.id
                      ? "bg-surface text-text shadow-[0_1px_2px_rgba(48,43,43,0.06)]"
                      : "text-secondary-text hover:text-text",
                  )}
                  onClick={() => onTabChange(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {tab === "today" ? (
              <div className="space-y-3">
                <section className="rounded-2xl border border-border bg-[#FAF7F5]/80 px-3.5 py-3.5">
                  <p className="text-[11px] font-medium tracking-wide text-secondary-text">
                    今日班表
                  </p>
                  {row.todayWorkStartHm && row.todayWorkEndHm ? (
                    <p className="mt-2 text-[22px] font-semibold tabular-nums text-text">
                      {row.todayWorkStartHm} → {row.todayWorkEndHm}
                    </p>
                  ) : (
                    <p className="mt-2 text-[14px] text-secondary-text">
                      {row.todayStatus === "time_off" ? "今日休假" : "今日未排班"}
                    </p>
                  )}
                  <p className="mt-3 text-[11px] text-secondary-text">休息時間</p>
                  {row.todayBreaks.length === 0 ? (
                    <p className="mt-1 text-[13px] text-secondary-text">今日無休息時段</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {row.todayBreaks.map((item) => (
                        <li key={item.id} className="text-[13px] text-text">
                          {item.rangeLabel}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-2xl border border-border bg-surface px-3.5 py-3.5">
                  <p className="text-[11px] font-medium tracking-wide text-secondary-text">
                    本週統計
                  </p>
                  <dl className="mt-2 space-y-2 text-[13px]">
                    <div className="flex justify-between">
                      <dt className="text-secondary-text">排班天數</dt>
                      <dd className="font-medium tabular-nums text-text">
                        {stats ? `${stats.scheduledDays} 天` : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-secondary-text">休假天數</dt>
                      <dd className="font-medium tabular-nums text-text">
                        {stats ? `${stats.timeOffDays} 天` : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-secondary-text">排班時數</dt>
                      <dd className="font-medium tabular-nums text-text">
                        {stats
                          ? `${formatStaffHoursValue(stats.scheduledMinutes).replace("h", "")} 小時`
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </section>

                {canManage && onSaveProfile ? (
                  <section
                    data-staff-profile-edit
                    className="space-y-2 rounded-2xl border border-border px-3.5 py-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-text">員工資料</p>
                      <button
                        type="button"
                        className="h-8 rounded-full border border-border px-2.5 text-[11px] text-secondary-text hover:bg-primary-light/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        onClick={() => {
                          setEditing((open) => !open);
                          setEditName(row.displayName);
                          setEditRole(row.role);
                          setEditLocationIds(row.locationIds);
                        }}
                      >
                        {editing ? "取消編輯" : "編輯員工資料"}
                      </button>
                    </div>
                    {editing ? (
                      <div className="space-y-2">
                        <label className="block text-[11px] text-secondary-text">
                          員工姓名
                          <input
                            className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[13px]"
                            value={editName}
                            onChange={(event) => setEditName(event.target.value)}
                          />
                        </label>
                        <label className="block text-[11px] text-secondary-text">
                          角色
                          <select
                            className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[13px]"
                            value={editRole}
                            onChange={(event) =>
                              setEditRole(event.target.value as StaffRole)
                            }
                          >
                            {STAFF_ONBOARDING_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {STAFF_ROLE_PRESENTATION[role]}（{role}）
                              </option>
                            ))}
                          </select>
                        </label>
                        <fieldset>
                          <legend className="text-[11px] text-secondary-text">分店</legend>
                          <div className="mt-1 space-y-1">
                            {locations.map((location) => (
                              <label
                                key={location.id}
                                className="flex min-h-9 items-center gap-2 text-[13px]"
                              >
                                <input
                                  type="checkbox"
                                  checked={editLocationIds.includes(location.id)}
                                  onChange={() =>
                                    setEditLocationIds(
                                      toggleOnboardingLocation(editLocationIds, location.id),
                                    )
                                  }
                                />
                                {location.name}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <Button
                          className="h-10 min-h-10 w-full rounded-full"
                          onClick={() => {
                            onSaveProfile({
                              displayName: editName,
                              role: editRole,
                              locationIds: editLocationIds,
                            });
                            setEditing(false);
                          }}
                        >
                          儲存員工資料
                        </Button>
                      </div>
                    ) : (
                      <p className="text-[12px] text-secondary-text">
                        可改姓名、角色與分店。班表請使用上方分頁。
                      </p>
                    )}
                    {onSetActive ? (
                      <Button
                        variant="outline"
                        className="h-10 min-h-10 w-full rounded-full"
                        disabled={isCurrentUser && row.isActive}
                        onClick={() => onSetActive(!row.isActive)}
                      >
                        {row.isActive ? "停用員工" : "重新啟用"}
                      </Button>
                    ) : null}
                    {isCurrentUser && row.isActive ? (
                      <p className="text-[11px] text-secondary-text">
                        無法停用目前登入使用中的員工資料
                      </p>
                    ) : null}
                  </section>
                ) : null}

                <StaffInvitePanel
                  invitePilotEnabled={invitePilotEnabled}
                  inviteSendOpen={inviteSendOpen}
                  actorRole={actorRole}
                  actorActive={actorActive}
                  actorOrganizationId={organizationId}
                  target={{
                    membershipId: row.membershipId,
                    organizationId: row.organizationId,
                    userId: row.staffId,
                    email: row.email,
                    isActive: row.isActive,
                    authUserId: row.authUserId,
                  }}
                  invite={pendingInvite}
                  binding={row.loginBinding}
                  onChanged={onInviteChanged}
                />
              </div>
            ) : null}

            {tab === "hours" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-text">固定班表</p>
                  {canEdit ? (
                    <div className="relative">
                      <button
                        type="button"
                        className="h-8 rounded-full border border-border px-2.5 text-[11px] text-secondary-text hover:bg-primary-light/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        onClick={() => setApplyOpen((open) => !open)}
                      >
                        套用
                      </button>
                      {applyOpen ? (
                        <div className="absolute right-0 z-10 mt-1 w-40 rounded-xl border border-border bg-surface p-1 shadow-[0_8px_20px_rgba(48,43,43,0.08)]">
                          <button
                            type="button"
                            className="flex h-9 w-full items-center rounded-lg px-2 text-left text-[12px] hover:bg-primary-light/40"
                            onClick={() => {
                              onApplyPattern("mon-fri");
                              setApplyOpen(false);
                            }}
                          >
                            套用週一到週五
                          </button>
                          <button
                            type="button"
                            className="flex h-9 w-full items-center rounded-lg px-2 text-left text-[12px] hover:bg-primary-light/40"
                            onClick={() => {
                              onApplyPattern("mon-sat");
                              setApplyOpen(false);
                            }}
                          >
                            套用週一到週六
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <ul className="space-y-1.5">
                  {DAYS.map((dow) => {
                    const rowHours = hours.find((item) => item.dayOfWeek === dow);
                    const isWorking = rowHours?.isWorking ?? false;
                    const start = rowHours?.startTime ?? "09:00";
                    const end = rowHours?.endTime ?? "21:00";
                    return (
                      <li
                        key={dow}
                        className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-border/70 px-2.5 py-1.5"
                      >
                        <span className="w-10 text-[13px] font-medium text-text">
                          {`星期${DAY_OF_WEEK_LABEL[dow]}`}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-medium",
                            isWorking
                              ? "bg-[#E7F0EA] text-[#5C7F66]"
                              : "bg-[#F1EEEC] text-[#7A7272]",
                          )}
                        >
                          {isWorking ? "上班" : "休假"}
                        </span>
                        {canEdit ? (
                          <>
                            <label className="sr-only" htmlFor={`hours-on-${dow}`}>
                              {DAY_OF_WEEK_LABEL[dow]}上班
                            </label>
                            <input
                              id={`hours-on-${dow}`}
                              type="checkbox"
                              className="h-4 w-4 accent-primary"
                              checked={isWorking}
                              onChange={(event) =>
                                onToggleWorking(dow, event.target.checked)
                              }
                            />
                            <input
                              type="time"
                              className="min-h-9 rounded-lg border border-border px-1.5 text-[12px] disabled:text-secondary-text"
                              value={start}
                              disabled={!isWorking}
                              onChange={(event) =>
                                onChangeHours(dow, "startTime", event.target.value)
                              }
                            />
                            <span className="text-secondary-text">→</span>
                            <input
                              type="time"
                              className="min-h-9 rounded-lg border border-border px-1.5 text-[12px] disabled:text-secondary-text"
                              value={end}
                              disabled={!isWorking}
                              onChange={(event) =>
                                onChangeHours(dow, "endTime", event.target.value)
                              }
                            />
                          </>
                        ) : (
                          <span className="text-[13px] tabular-nums text-text">
                            {isWorking ? `${start} → ${end}` : "—"}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {tab === "breaks" ? (
              <div className="space-y-3">
                <p className="text-[13px] font-medium text-text">休息時間</p>
                {breakViews.length === 0 ? (
                  <p className="text-[13px] text-secondary-text">目前沒有休息時段</p>
                ) : (
                  <ul className="space-y-2">
                    {breakViews.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
                      >
                        <div>
                          <p className="text-[13px] font-medium text-text">
                            {item.rangeLabel}
                          </p>
                          <p className="text-[11px] text-secondary-text">
                            {item.dateLabel}
                            {item.label ? ` · ${item.label}` : ""}
                          </p>
                        </div>
                        {canEdit ? (
                          <Button
                            variant="ghost"
                            className="h-9 min-h-9 px-2 text-[12px]"
                            onClick={() => onDeleteBreak(item.id)}
                          >
                            移除
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit ? (
                  <div className="space-y-2 rounded-2xl border border-border p-3">
                    <p className="text-[12px] text-secondary-text">新增休息</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-secondary-text">
                        日期
                        <input
                          type="date"
                          className="mt-1 min-h-10 w-full rounded-xl border border-border px-2 text-[13px]"
                          value={breakDate}
                          onChange={(event) => onBreakDate(event.target.value)}
                        />
                      </label>
                      <label className="text-[11px] text-secondary-text">
                        標籤
                        <input
                          className="mt-1 min-h-10 w-full rounded-xl border border-border px-2 text-[13px]"
                          value={breakLabel}
                          onChange={(event) => onBreakLabel(event.target.value)}
                        />
                      </label>
                      <label className="text-[11px] text-secondary-text">
                        開始
                        <input
                          type="time"
                          className="mt-1 min-h-10 w-full rounded-xl border border-border px-2 text-[13px]"
                          value={breakStart}
                          onChange={(event) => onBreakStart(event.target.value)}
                        />
                      </label>
                      <label className="text-[11px] text-secondary-text">
                        結束
                        <input
                          type="time"
                          className="mt-1 min-h-10 w-full rounded-xl border border-border px-2 text-[13px]"
                          value={breakEnd}
                          onChange={(event) => onBreakEnd(event.target.value)}
                        />
                      </label>
                    </div>
                    <Button className="h-10 min-h-10 w-full rounded-full" onClick={onCreateBreak}>
                      新增休息
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === "timeoff" ? (
              <div className="space-y-3">
                <p className="text-[13px] font-medium text-text">即將到來的休假</p>
                {upcoming.length === 0 ? (
                  <p className="text-[13px] text-secondary-text">
                    目前沒有即將到來的休假
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {upcoming.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
                      >
                        <div>
                          <p className="text-[13px] font-medium text-text">{item.dateLabel}</p>
                          <p className="text-[12px] text-secondary-text">{item.timeLabel}</p>
                          {item.reason ? (
                            <p className="text-[12px] text-secondary-text">{item.reason}</p>
                          ) : null}
                        </div>
                        {canEdit ? (
                          <Button
                            variant="ghost"
                            className="h-9 min-h-9 px-2 text-[12px]"
                            onClick={() => onDeleteTimeOff(item.id)}
                          >
                            移除
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit ? (
                  <div className="space-y-2 rounded-2xl border border-border p-3">
                    <p className="text-[12px] text-secondary-text">新增休假 / 請假</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-secondary-text">
                        日期
                        <input
                          type="date"
                          className="mt-1 min-h-10 w-full rounded-xl border border-border px-2 text-[13px]"
                          value={offDate}
                          onChange={(event) => onOffDate(event.target.value)}
                        />
                      </label>
                      <label className="text-[11px] text-secondary-text">
                        原因
                        <input
                          className="mt-1 min-h-10 w-full rounded-xl border border-border px-2 text-[13px]"
                          value={offReason}
                          placeholder="選填"
                          onChange={(event) => onOffReason(event.target.value)}
                        />
                      </label>
                      <label className="text-[11px] text-secondary-text">
                        開始
                        <input
                          type="time"
                          className="mt-1 min-h-10 w-full rounded-xl border border-border px-2 text-[13px]"
                          value={offStart}
                          onChange={(event) => onOffStart(event.target.value)}
                        />
                      </label>
                      <label className="text-[11px] text-secondary-text">
                        結束
                        <input
                          type="time"
                          className="mt-1 min-h-10 w-full rounded-xl border border-border px-2 text-[13px]"
                          value={offEnd}
                          onChange={(event) => onOffEnd(event.target.value)}
                        />
                      </label>
                    </div>
                    <Button className="h-10 min-h-10 w-full rounded-full" onClick={onCreateTimeOff}>
                      新增休假 / 請假
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p className="mt-3 text-[12px] text-[#B07A4A]" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          {tab === "today" && canEdit ? (
            <div className="shrink-0 space-y-2 border-t border-border px-5 py-3">
              <Button
                className="h-10 min-h-10 w-full rounded-full"
                onClick={() => onTabChange("hours")}
              >
                編輯排班
              </Button>
              <Button
                variant="outline"
                className="h-10 min-h-10 w-full rounded-full"
                onClick={() => onTabChange("timeoff")}
              >
                休假 / 請假
              </Button>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

export function defaultScheduleFormDate(now: Date): string {
  return formatYmd(now);
}
