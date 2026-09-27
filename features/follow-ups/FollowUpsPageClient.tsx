"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatHm, formatYmd, combineLocalDateTime } from "@/lib/appointments/domain";
import {
  FOLLOW_UP_STATUS_LABEL,
  FOLLOW_UP_TYPE_LABEL,
  type FollowUpTask,
} from "@/lib/follow-ups/domain";
import {
  listCompletedFollowUps,
  listDueTodayFollowUps,
  listOpenFollowUps,
  listOverdueFollowUps,
  listUpcomingFollowUps,
} from "@/lib/follow-ups/selectors";
import {
  buildRebookHref,
  completeFollowUpTask,
  getFollowUpRevision,
  listFollowUpTasks,
  snoozeFollowUpTask,
  subscribeFollowUps,
} from "@/lib/follow-ups/store";
import { getMembership } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { useClientNow } from "@/lib/use-client-now";
import { cn } from "@/lib/utils";

type FilterId =
  | "today"
  | "overdue"
  | "upcoming"
  | "mine"
  | "completed"
  | "all";

function formatDue(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${formatYmd(d)} ${formatHm(d)}`;
  } catch {
    return iso;
  }
}

function assigneeLabel(
  organizationId: string,
  task: FollowUpTask,
): string {
  if (!task.assignedStaffId) return "未指派";
  const m = getMembership(organizationId, task.assignedStaffId);
  return m?.displayName ?? task.context.staffName ?? "未指派";
}

export function FollowUpsPageClient() {
  const { organization, membership, locations } = useOrganization();
  const rev = useSyncExternalStore(
    subscribeFollowUps,
    getFollowUpRevision,
    () => "",
  );
  const clientNow = useClientNow();
  const [filter, setFilter] = useState<FilterId>("today");
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [completeNote, setCompleteNote] = useState("");
  const [snoozeId, setSnoozeId] = useState<string | null>(null);
  const [snoozeDate, setSnoozeDate] = useState("");
  const [error, setError] = useState("");

  const allTasks = useMemo(() => {
    void rev;
    return listFollowUpTasks(organization.id);
  }, [organization.id, rev]);

  const staffId = membership?.userId;

  const rows = useMemo(() => {
    const now = clientNow ?? new Date();
    switch (filter) {
      case "today":
        return listDueTodayFollowUps(allTasks, now);
      case "overdue":
        return listOverdueFollowUps(allTasks, now);
      case "upcoming":
        return listUpcomingFollowUps(allTasks, now);
      case "mine":
        return listOpenFollowUps(allTasks).filter(
          (t) => staffId && t.assignedStaffId === staffId,
        );
      case "completed":
        return listCompletedFollowUps(allTasks);
      case "all":
      default:
        return allTasks;
    }
  }, [allTasks, filter, clientNow, staffId]);

  const emptyMessage = (() => {
    if (filter === "today") return "今天沒有需要追蹤的客人";
    if (filter === "overdue") return "目前沒有逾期追蹤";
    if (filter === "upcoming") return "尚無即將到期的追蹤";
    if (filter === "mine") return "目前沒有指派給你的追蹤";
    if (filter === "completed") return "尚無已完成追蹤";
    return "尚無追蹤紀錄";
  })();

  function handleComplete(taskId: string) {
    if (!staffId) {
      setError("無法辨識目前員工身份");
      return;
    }
    try {
      completeFollowUpTask(organization.id, taskId, {
        actorStaffId: staffId,
        completionNote: completeNote,
      });
      setCompleteId(null);
      setCompleteNote("");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "完成失敗");
    }
  }

  function handleSnooze(taskId: string) {
    if (!staffId) {
      setError("無法辨識目前員工身份");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snoozeDate)) {
      setError("請選擇延後日期");
      return;
    }
    try {
      snoozeFollowUpTask(organization.id, taskId, {
        actorStaffId: staffId,
        dueAt: combineLocalDateTime(snoozeDate, "10:00").toISOString(),
      });
      setSnoozeId(null);
      setSnoozeDate("");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "延後失敗");
    }
  }

  const filters: Array<{ id: FilterId; label: string }> = [
    { id: "today", label: "今天" },
    { id: "overdue", label: "逾期" },
    { id: "upcoming", label: "即將到期" },
    ...(staffId ? [{ id: "mine" as const, label: "我的追蹤" }] : []),
    { id: "completed", label: "已完成" },
    { id: "all", label: "全部" },
  ];

  return (
    <div className="min-w-0 space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
          追蹤
        </h1>
        <p className="mt-1 text-sm text-secondary-text">
          療程回訪與再預約 · 瀏覽器本地時區
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={cn(
              "min-h-11 rounded-2xl px-4 text-sm font-medium transition-colors",
              filter === item.id
                ? "bg-primary text-white"
                : "border border-border bg-surface text-secondary-text hover:bg-primary-light/40",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <Card padding="lg" className="text-center">
          <p className="text-[15px] font-medium text-text">{emptyMessage}</p>
          <p className="mt-2 text-sm text-secondary-text">
            完成療程並設定下次追蹤後，任務會出現在這裡。
          </p>
        </Card>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-secondary-text">
                  <th className="px-3 py-3 font-medium">客戶</th>
                  <th className="px-3 py-3 font-medium">類型</th>
                  <th className="px-3 py-3 font-medium">到期</th>
                  <th className="px-3 py-3 font-medium">指派</th>
                  <th className="px-3 py-3 font-medium">服務／備註</th>
                  <th className="px-3 py-3 font-medium">狀態</th>
                  <th className="px-3 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => (
                  <tr key={task.id} className="border-b border-border/80 align-top">
                    <td className="px-3 py-3">
                      <p className="font-medium text-text">
                        {task.context.customerName ?? task.customerId}
                      </p>
                      {task.locationId ? (
                        <p className="mt-0.5 text-xs text-secondary-text">
                          {locations.find((l) => l.id === task.locationId)?.name}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-text">
                      {FOLLOW_UP_TYPE_LABEL[task.type]}
                    </td>
                    <td className="px-3 py-3 text-secondary-text">
                      {formatDue(task.dueAt)}
                    </td>
                    <td className="px-3 py-3 text-secondary-text">
                      {assigneeLabel(organization.id, task)}
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-text">
                        {task.context.serviceName ?? "—"}
                      </p>
                      <p className="mt-0.5 text-xs text-secondary-text line-clamp-2">
                        {task.completionNote ||
                          task.note ||
                          task.context.followUpTags.join("、") ||
                          "—"}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={task.status} />
                    </td>
                    <td className="px-3 py-3">
                      <TaskActions
                        task={task}
                        completeId={completeId}
                        snoozeId={snoozeId}
                        completeNote={completeNote}
                        snoozeDate={snoozeDate}
                        onCompleteOpen={() => {
                          setCompleteId(task.id);
                          setSnoozeId(null);
                          setCompleteNote("");
                        }}
                        onSnoozeOpen={() => {
                          setSnoozeId(task.id);
                          setCompleteId(null);
                          setSnoozeDate(formatYmd(new Date(task.dueAt)));
                        }}
                        onCompleteNote={setCompleteNote}
                        onSnoozeDate={setSnoozeDate}
                        onConfirmComplete={() => handleComplete(task.id)}
                        onConfirmSnooze={() => handleSnooze(task.id)}
                        onCancelDialog={() => {
                          setCompleteId(null);
                          setSnoozeId(null);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {rows.map((task) => (
              <Card key={task.id} padding="none" className="overflow-hidden">
                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-text">
                        {task.context.customerName ?? task.customerId}
                      </p>
                      <p className="mt-1 text-sm text-secondary-text">
                        {FOLLOW_UP_TYPE_LABEL[task.type]}
                        <span className="mx-1.5 text-border">·</span>
                        {formatDue(task.dueAt)}
                      </p>
                    </div>
                    <StatusPill status={task.status} />
                  </div>
                  <p className="text-sm text-secondary-text">
                    {assigneeLabel(organization.id, task)}
                    {task.context.serviceName
                      ? ` · ${task.context.serviceName}`
                      : ""}
                  </p>
                  <TaskActions
                    task={task}
                    stacked
                    completeId={completeId}
                    snoozeId={snoozeId}
                    completeNote={completeNote}
                    snoozeDate={snoozeDate}
                    onCompleteOpen={() => {
                      setCompleteId(task.id);
                      setSnoozeId(null);
                      setCompleteNote("");
                    }}
                    onSnoozeOpen={() => {
                      setSnoozeId(task.id);
                      setCompleteId(null);
                      setSnoozeDate(formatYmd(new Date(task.dueAt)));
                    }}
                    onCompleteNote={setCompleteNote}
                    onSnoozeDate={setSnoozeDate}
                    onConfirmComplete={() => handleComplete(task.id)}
                    onConfirmSnooze={() => handleSnooze(task.id)}
                    onCancelDialog={() => {
                      setCompleteId(null);
                      setSnoozeId(null);
                    }}
                  />
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: FollowUpTask["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        status === "OPEN"
          ? "bg-amber-50 text-amber-800"
          : "bg-emerald-50 text-emerald-800",
      )}
    >
      {FOLLOW_UP_STATUS_LABEL[status]}
    </span>
  );
}

function TaskActions({
  task,
  stacked,
  completeId,
  snoozeId,
  completeNote,
  snoozeDate,
  onCompleteOpen,
  onSnoozeOpen,
  onCompleteNote,
  onSnoozeDate,
  onConfirmComplete,
  onConfirmSnooze,
  onCancelDialog,
}: {
  task: FollowUpTask;
  stacked?: boolean;
  completeId: string | null;
  snoozeId: string | null;
  completeNote: string;
  snoozeDate: string;
  onCompleteOpen: () => void;
  onSnoozeOpen: () => void;
  onCompleteNote: (v: string) => void;
  onSnoozeDate: (v: string) => void;
  onConfirmComplete: () => void;
  onConfirmSnooze: () => void;
  onCancelDialog: () => void;
}) {
  const open = task.status === "OPEN";
  const showComplete = completeId === task.id;
  const showSnooze = snoozeId === task.id;

  return (
    <div className={cn("flex gap-2", stacked ? "flex-col" : "flex-wrap")}>
      {open && !showComplete && !showSnooze ? (
        <>
          <Button
            className="min-h-11"
            fullWidth={stacked}
            onClick={onCompleteOpen}
          >
            完成追蹤
          </Button>
          <Link href={buildRebookHref(task)} className={stacked ? "block w-full" : undefined}>
            <Button variant="secondary" className="min-h-11" fullWidth={stacked}>
              再次預約
            </Button>
          </Link>
          <Link
            href={`/staff/customers/${task.customerId}`}
            className={stacked ? "block w-full" : undefined}
          >
            <Button variant="outline" className="min-h-11" fullWidth={stacked}>
              查看客戶
            </Button>
          </Link>
          <Button
            variant="ghost"
            className="min-h-11"
            fullWidth={stacked}
            onClick={onSnoozeOpen}
          >
            延後
          </Button>
        </>
      ) : null}

      {!open ? (
        <Link
          href={`/staff/customers/${task.customerId}`}
          className={stacked ? "block w-full" : undefined}
        >
          <Button variant="outline" className="min-h-11" fullWidth={stacked}>
            查看客戶
          </Button>
        </Link>
      ) : null}

      {showComplete ? (
        <div className="w-full space-y-2 rounded-2xl border border-border p-3">
          <label className="block text-sm text-secondary-text" htmlFor={`note-${task.id}`}>
            完成備註（選填）
          </label>
          <textarea
            id={`note-${task.id}`}
            value={completeNote}
            onChange={(e) => onCompleteNote(e.target.value)}
            rows={2}
            className="w-full rounded-2xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" onClick={onConfirmComplete}>
              確認完成
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={onCancelDialog}>
              取消
            </Button>
          </div>
        </div>
      ) : null}

      {showSnooze ? (
        <div className="w-full space-y-2 rounded-2xl border border-border p-3">
          <label className="block text-sm text-secondary-text" htmlFor={`snooze-${task.id}`}>
            新的追蹤日期
          </label>
          <input
            id={`snooze-${task.id}`}
            type="date"
            value={snoozeDate}
            onChange={(e) => onSnoozeDate(e.target.value)}
            className="min-h-11 w-full rounded-2xl border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" onClick={onConfirmSnooze}>
              確認延後
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={onCancelDialog}>
              取消
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
