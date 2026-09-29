"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { formatYmd } from "@/lib/appointments/domain";
import { formatPhoneDisplay } from "@/lib/phone";
import {
  FOLLOW_UPS_HAS_CONTACT_HISTORY,
  FOLLOW_UPS_PANEL_WIDTH_PX,
  type FollowUpWorkspaceRow,
} from "@/lib/follow-ups/follow-ups-workspace-derived";
import { cn } from "@/lib/utils";

interface FollowUpQuickViewProps {
  row: FollowUpWorkspaceRow;
  rebookHref: string;
  canAct: boolean;
  actionError?: string;
  actionBusy?: boolean;
  onClose: () => void;
  onComplete: (completionNote: string) => void;
  onSnooze: (dueYmd: string) => void;
}

type ActionPanel = "view" | "complete" | "snooze";

const STATUS_PILL: Record<FollowUpWorkspaceRow["dueKind"], string> = {
  today: "bg-[#F8F1E8] text-[#C4A06A]",
  overdue: "bg-[#F6EEEE] text-[#C49A9A]",
  upcoming: "bg-[#F8F1E8] text-[#C4A06A]",
  completed: "bg-[#E7F0EA] text-[#5C7F66]",
};

export function FollowUpQuickView({
  row,
  rebookHref,
  canAct,
  actionError = "",
  actionBusy = false,
  onClose,
  onComplete,
  onSnooze,
}: FollowUpQuickViewProps) {
  const [panel, setPanel] = useState<ActionPanel>("view");
  const [completeNote, setCompleteNote] = useState("");
  const [snoozeDate, setSnoozeDate] = useState(() => formatYmd(new Date(row.dueAt)));

  const open = row.status === "OPEN";
  const phoneLabel = row.customerPhone
    ? formatPhoneDisplay(row.customerPhone)
    : "";
  const noteAlreadyInTask = Boolean(row.note && row.title === row.note.trim());

  function submitComplete() {
    onComplete(completeNote);
    setPanel("view");
    setCompleteNote("");
  }

  function submitSnooze() {
    onSnooze(snoozeDate);
    setPanel("view");
  }

  return (
    <>
      <button
        type="button"
        className="fixed inset-x-0 top-0 z-30 bg-text/25 min-[1200px]:hidden bottom-[calc(3.5rem+env(safe-area-inset-bottom))]"
        aria-label="關閉追蹤詳情"
        onClick={onClose}
      />
      <aside
        data-followups-quickview
        data-followups-panel-width={FOLLOW_UPS_PANEL_WIDTH_PX}
        data-follow-up-id={row.taskId}
        role="dialog"
        aria-modal="true"
        aria-label={`${row.customerName}的追蹤詳情`}
        className={cn(
          "z-30 flex flex-col overflow-hidden border border-border bg-surface",
          "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-h-[min(88vh,calc(100dvh-4.5rem-env(safe-area-inset-bottom)))] rounded-t-3xl shadow-[0_-4px_24px_rgba(48,43,43,0.08)]",
          "min-[1200px]:relative min-[1200px]:inset-auto min-[1200px]:z-0 min-[1200px]:h-auto min-[1200px]:max-h-[calc(100dvh-6.5rem)] min-[1200px]:w-[400px] min-[1200px]:min-w-[400px] min-[1200px]:shrink-0 min-[1200px]:rounded-2xl min-[1200px]:shadow-none",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-5 pt-3.5 pb-1">
            <p className="text-[13px] font-medium tracking-wide text-secondary-text">
              追蹤詳情
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
              <Avatar initials={row.customerInitials} size="md" className="gap-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 className="truncate text-[16px] font-semibold text-text">
                    {row.customerName}
                  </h2>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      STATUS_PILL[row.dueKind],
                    )}
                  >
                    {row.overdueLabel ?? row.statusLabel}
                  </span>
                </div>
                {row.customerTags.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {row.customerTags.map((tag) => (
                      <span
                        key={tag.id}
                        className="rounded-full bg-[#F3EEEA] px-2 py-0.5 text-[11px] text-[#7A7272]"
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {phoneLabel ? (
                  <p className="mt-1 text-[13px] text-secondary-text">{phoneLabel}</p>
                ) : null}
                <Link
                  href={`/staff/customers/${row.customerId}`}
                  className="mt-1.5 inline-flex min-h-11 items-center text-[13px] font-medium text-[#C56B70]"
                >
                  查看客戶資料
                  <span aria-hidden className="ml-0.5">
                    &gt;
                  </span>
                </Link>
              </div>
            </div>

            <section
              data-followups-task
              className="rounded-2xl border border-border bg-[#FAF7F5]/80 px-3.5 py-3.5"
            >
              <p className="text-[11px] font-medium tracking-wide text-secondary-text">
                這次要追蹤
              </p>
              <p className="mt-1.5 text-[16px] font-semibold leading-snug text-text">
                {row.title}
              </p>
              <p className="mt-1 text-[12px] text-secondary-text">{row.typeLabel}</p>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <div>
                  <p className="text-[11px] text-secondary-text">追蹤時間</p>
                  <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-text">
                    {row.dueLabel}
                  </p>
                  {row.overdueLabel ? (
                    <p className="mt-0.5 text-[11px] text-[#C49A9A]">{row.overdueLabel}</p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-secondary-text">負責人</p>
                  <p className="mt-0.5 text-[13px] font-medium text-text">{row.ownerLabel}</p>
                </div>
              </div>
              {row.reason && row.reason !== row.title ? (
                <p className="mt-2 text-[12px] text-secondary-text">{row.reason}</p>
              ) : null}
              {row.completionNote ? (
                <p className="mt-2 text-[13px] text-text">完成備註：{row.completionNote}</p>
              ) : null}
            </section>

            {row.relatedTreatment ? (
              <section className="mt-4">
                <p className="text-[11px] font-medium tracking-wide text-secondary-text">
                  上次療程
                </p>
                <div className="mt-1.5 rounded-2xl border border-border px-3.5 py-3">
                  <p className="text-[14px] font-medium text-text">
                    {row.relatedTreatment.serviceName || "療程紀錄"}
                  </p>
                  {row.relatedTreatment.dateLabel ? (
                    <p className="mt-0.5 text-[12px] text-secondary-text">
                      {row.relatedTreatment.dateLabel}
                    </p>
                  ) : null}
                  {row.relatedTreatment.professionalNote ? (
                    <p className="mt-2 text-[13px] text-text">
                      {row.relatedTreatment.professionalNote}
                    </p>
                  ) : null}
                  <Link
                    href={`/staff/treatments/${row.relatedTreatment.treatmentId}`}
                    className="mt-2 inline-flex min-h-11 items-center text-[13px] font-medium text-[#C56B70]"
                  >
                    查看療程紀錄
                    <span aria-hidden className="ml-0.5">
                      &gt;
                    </span>
                  </Link>
                </div>
              </section>
            ) : null}

            {row.relatedAppointment ? (
              <section className="mt-4">
                <p className="text-[11px] font-medium tracking-wide text-secondary-text">
                  相關預約
                </p>
                <div className="mt-1.5 rounded-2xl border border-border px-3.5 py-3">
                  <p className="text-[14px] font-medium text-text">
                    {row.relatedAppointment.serviceName || "預約"}
                  </p>
                  <p className="mt-0.5 text-[12px] text-secondary-text">
                    {[
                      row.relatedAppointment.dateLabel,
                      row.relatedAppointment.statusLabel,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </section>
            ) : null}

            {row.note && !noteAlreadyInTask ? (
              <p className="mt-4 text-[13px] text-text">{row.note}</p>
            ) : null}

            <p className="mt-4 text-[11px] leading-relaxed text-secondary-text/80">
              {[
                row.createdLabel ? `建立 ${row.createdLabel}` : "",
                row.updatedLabel && row.updatedAt !== row.createdAt
                  ? `更新 ${row.updatedLabel}`
                  : "",
                row.completedLabel ? `完成 ${row.completedLabel}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
              {FOLLOW_UPS_HAS_CONTACT_HISTORY
                ? null
                : " · 聯絡歷程尚未建模"}
            </p>

            {!open ? (
              <p
                data-followups-completed-state
                className="mt-4 rounded-2xl bg-[#F3F6F3] px-3.5 py-2.5 text-[13px] text-[#5C7F66]"
              >
                此追蹤已完成
                {row.completionNote ? ` · ${row.completionNote}` : ""}
              </p>
            ) : null}
          </div>

          {open ? (
            <div
              data-followups-actions
              className="shrink-0 border-t border-border bg-surface px-5 py-3"
            >
              {actionError ? (
                <p className="mb-2 text-[13px] text-danger" role="alert">
                  {actionError}
                </p>
              ) : null}
              {canAct && panel === "complete" ? (
                <form
                  data-followups-complete
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitComplete();
                  }}
                >
                  <label className="block text-[12px] text-secondary-text" htmlFor="followup-complete-note">
                    完成備註（選填）
                    <textarea
                      id="followup-complete-note"
                      value={completeNote}
                      onChange={(event) => setCompleteNote(event.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      data-followups-complete-submit
                      className="h-10 min-h-10 flex-1 rounded-full text-[13px]"
                      disabled={actionBusy}
                    >
                      {actionBusy ? "處理中…" : "確認完成"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 min-h-10 rounded-full px-4 text-[13px]"
                      onClick={() => setPanel("view")}
                    >
                      取消
                    </Button>
                  </div>
                </form>
              ) : canAct && panel === "snooze" ? (
                <form
                  data-followups-snooze
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitSnooze();
                  }}
                >
                  <label className="block text-[12px] text-secondary-text" htmlFor="followup-snooze-date">
                    新的追蹤日期
                    <input
                      id="followup-snooze-date"
                      type="date"
                      value={snoozeDate}
                      onChange={(event) => setSnoozeDate(event.target.value)}
                      className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      data-followups-snooze-submit
                      className="h-10 min-h-10 flex-1 rounded-full text-[13px]"
                      disabled={actionBusy}
                    >
                      {actionBusy ? "處理中…" : "確認延後"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 min-h-10 rounded-full px-4 text-[13px]"
                      onClick={() => setPanel("view")}
                    >
                      取消
                    </Button>
                  </div>
                </form>
              ) : canAct ? (
                <div className="flex flex-col gap-2">
                  <Button
                    data-followups-complete-open
                    className="h-10 min-h-10 rounded-full text-[13px]"
                    variant="primary"
                    onClick={() => {
                      setPanel("complete");
                      setCompleteNote("");
                    }}
                  >
                    完成追蹤
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      data-followups-snooze-open
                      variant="outline"
                      className="h-10 min-h-10 flex-1 rounded-full text-[13px]"
                      onClick={() => {
                        setPanel("snooze");
                        setSnoozeDate(formatYmd(new Date(row.dueAt)));
                      }}
                    >
                      延後追蹤
                    </Button>
                    <Link href={rebookHref} className="flex-1">
                      <Button
                        variant="outline"
                        className="h-10 min-h-10 w-full rounded-full text-[13px]"
                      >
                        再次預約
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <p className="text-[12px] text-secondary-text">
                  無法辨識目前員工身份，暫不能完成或延後。
                </p>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
