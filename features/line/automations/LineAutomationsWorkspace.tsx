"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { LineAutomationCard } from "@/features/line/automations/LineAutomationCard";
import { LineAutomationPhonePreview } from "@/features/line/automations/LineAutomationPhonePreview";
import { LineAutomationRuleEditor } from "@/features/line/automations/LineAutomationRuleEditor";
import { LineAutomationMonthlyStats } from "@/features/line/automations/LineAutomationStats";
import { canShowLineAutomations } from "@/lib/line/automations/access";
import {
  LINE_AUTOMATION_CATALOG,
  LINE_AUTOMATION_TABS,
  lineAutomationById,
} from "@/lib/line/automations/catalog";
import {
  loadAppointmentReminderWorkspaceAction,
  runAppointmentReminderDryRunAction,
  saveAppointmentReminderRuleAction,
  startCustomerLineBindAction,
} from "@/lib/line/automations/appointment-reminder-actions";
import type {
  AppointmentReminderDelivery,
  AppointmentReminderDryRunRecord,
} from "@/lib/line/automations/appointment-reminder-types";
import {
  LINE_AUTOMATION_BIND_COUNT_LABEL,
  LINE_AUTOMATION_BIND_HINT,
  LINE_AUTOMATION_DB_NOT_READY,
  LINE_AUTOMATION_DRY_RUN_ACTION_LABEL,
  LINE_AUTOMATION_DRY_RUN_EMPTY,
  LINE_AUTOMATION_HISTORY_EMPTY,
  LINE_AUTOMATION_LOCAL_DRAFT_HINT,
  LINE_AUTOMATION_NOT_LIVE_HINT,
  LINE_AUTOMATION_PAGE_SUBTITLE,
  LINE_AUTOMATION_PAGE_TITLE,
  LINE_AUTOMATION_PERSIST_CLOSED_MESSAGE,
  LINE_AUTOMATION_PLANNED_COUNT_LABEL,
  LINE_AUTOMATION_REMINDER_BACKEND_HINT,
  LINE_AUTOMATION_START_BIND_LABEL,
} from "@/lib/line/automations/copy";
import {
  applyLineAutomationEditor,
  createDefaultLineAutomationDrafts,
  createEmptyLineAutomationStats,
  resetLineAutomationDraftsOnOrganizationChange,
  setLineAutomationEnabled,
} from "@/lib/line/automations/draft";
import type { LineAutomationId, LineAutomationTab } from "@/lib/line/automations/types";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { cn } from "@/lib/utils";

export function LineAutomationsWorkspace() {
  const { organization, membership } = useOrganization();
  const allowed = canShowLineAutomations(membership);
  const [tab, setTab] = useState<LineAutomationTab>("overview");
  const [selectedId, setSelectedId] = useState<LineAutomationId>("appointment_reminder");
  const [drafts, setDrafts] = useState(createDefaultLineAutomationDrafts);
  const [editingId, setEditingId] = useState<LineAutomationId | null>(null);
  const [persistMessage, setPersistMessage] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<AppointmentReminderDelivery[]>([]);
  const [dryRuns, setDryRuns] = useState<AppointmentReminderDryRunRecord[]>([]);
  const [saved, setSaved] = useState(false);
  const [persistOpen, setPersistOpen] = useState(false);
  const [bindCount, setBindCount] = useState<number | null>(null);
  const [plannedCount, setPlannedCount] = useState<number | null>(null);
  const [bindCustomerId, setBindCustomerId] = useState("");
  const [bindCode, setBindCode] = useState<string | null>(null);
  const previousOrganizationId = useRef<string | null>(null);
  const stats = {
    ...createEmptyLineAutomationStats(),
    plannedThisMonth: plannedCount,
    pendingTasks: plannedCount,
  };

  useEffect(() => {
    const reset = resetLineAutomationDraftsOnOrganizationChange({
      previousOrganizationId: previousOrganizationId.current,
      nextOrganizationId: organization.id,
      drafts,
    });
    previousOrganizationId.current = organization.id;
    if (reset.reset) {
      setDrafts(reset.drafts);
      setEditingId(null);
      setTab("overview");
      setSelectedId("appointment_reminder");
      setPersistMessage(null);
      setDeliveries([]);
      setDryRuns([]);
      setSaved(false);
      setPersistOpen(false);
      setBindCount(null);
      setPlannedCount(null);
      setBindCode(null);
    }
    void loadAppointmentReminderWorkspaceAction(organization.id).then((result) => {
      if (!result.ok || !result.data) {
        setPersistMessage(result.ok ? result.message : LINE_AUTOMATION_DB_NOT_READY);
        setSaved(false);
        return;
      }
      setPersistMessage(result.message);
      setSaved(result.data.saved);
      setPersistOpen(result.data.persistOpen);
      setBindCount(result.data.bindCount);
      setPlannedCount(result.data.plannedCount);
      setDeliveries(result.data.deliveries);
      setDryRuns(result.data.dryRuns);
      if (result.data.saved) {
        const rule = result.data.rule;
        setDrafts((current) => ({
          ...current,
          appointment_reminder: {
            ...current.appointment_reminder,
            enabled: rule.enabled,
            selectedTimingIds: [...rule.selectedTimingIds],
            template: rule.template || current.appointment_reminder.template,
          },
        }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization.id]);

  if (!allowed) {
    return (
      <Card data-line-automations-denied padding="lg">
        <p className="text-[16px] font-semibold text-text">只有店長可以使用 LINE 自動推播</p>
      </Card>
    );
  }

  const selected = lineAutomationById(selectedId);
  const selectedDraft = drafts[selectedId];
  const officialName = organization.name.trim() || "THE ENJOYE";
  const visibleCards =
    tab === "overview" || tab === "history"
      ? LINE_AUTOMATION_CATALOG
      : LINE_AUTOMATION_CATALOG.filter((item) => item.id === tab);

  return (
    <div data-line-automations-page className="space-y-5 overflow-x-hidden">
      <header className="flex flex-col gap-4 min-[1100px]:flex-row min-[1100px]:items-start min-[1100px]:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#06C755] text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
              <path
                fill="currentColor"
                d="M12 3C6.48 3 2 6.82 2 11.5c0 2.62 1.5 4.96 3.84 6.5-.13.96-.5 2.48-1.55 3.55 0 0 2.1.08 3.72-1.3.64.12 1.31.2 2 .2 5.52 0 10-3.82 10-8.45C20 6.82 17.52 3 12 3z"
              />
            </svg>
          </span>
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight text-text sm:text-[26px]">
              {LINE_AUTOMATION_PAGE_TITLE}
            </h1>
            <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-secondary-text">
              {LINE_AUTOMATION_PAGE_SUBTITLE}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-[20px] border border-border bg-[#FFFCFB] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[12px] text-secondary-text">官方帳號</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <p className="text-[14px] font-medium text-text" data-line-oa-name>
                {officialName}
              </p>
              <Badge tone="neutral">尚未連線發送</Badge>
            </div>
            <p className="mt-1 text-[12px] text-secondary-text">
              目前店家：{organization.name} · 此頁不讀取 Channel 憑證
            </p>
          </div>
          <Link
            href="/staff/settings"
            className="inline-flex min-h-10 items-center rounded-full bg-primary px-4 text-[13px] font-medium text-white hover:bg-[#b9686c]"
          >
            前往設定
          </Link>
        </div>
      </header>

      <div
        data-line-automation-safety
        className="rounded-2xl bg-primary-light/70 px-4 py-3 text-[13px] leading-relaxed text-text"
      >
        <p>{LINE_AUTOMATION_NOT_LIVE_HINT}</p>
        <p className="mt-1 text-secondary-text">{LINE_AUTOMATION_REMINDER_BACKEND_HINT}</p>
        <p className="mt-1 text-secondary-text">{LINE_AUTOMATION_LOCAL_DRAFT_HINT}</p>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:-mx-0 sm:px-0">
        <div
          className="flex min-w-max gap-1 border-b border-border"
          role="tablist"
          aria-label="自動推播分類"
        >
          {LINE_AUTOMATION_TABS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-line-automation-tab={item.id}
                onClick={() => {
                  setTab(item.id);
                  if (item.id !== "overview" && item.id !== "history") {
                    setSelectedId(item.id);
                  }
                }}
                className={cn(
                  "min-h-11 px-3 text-[13px] font-medium sm:px-4",
                  active
                    ? "border-b-2 border-primary text-primary"
                    : "text-secondary-text hover:text-text",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "history" ? (
        <Card padding="lg" data-line-automation-history>
          <h2 className="text-[16px] font-semibold text-text">發送紀錄</h2>
          {deliveries.length === 0 ? (
            <p className="mt-2 text-[14px] leading-relaxed text-secondary-text">
              {LINE_AUTOMATION_HISTORY_EMPTY}
            </p>
          ) : (
            <ul className="mt-3 space-y-2" data-line-automation-delivery-list>
              {deliveries.map((row) => (
                <li key={row.requestId} className="rounded-2xl border border-border bg-white px-3 py-2 text-[13px]">
                  <p className="font-medium text-text">{row.status}</p>
                  <p className="text-secondary-text">{row.message ?? row.requestId}</p>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-5 text-[15px] font-semibold text-text">Dry-run 測試結果</h3>
          {dryRuns.length === 0 ? (
            <p className="mt-2 text-[14px] leading-relaxed text-secondary-text">
              {LINE_AUTOMATION_DRY_RUN_EMPTY}
            </p>
          ) : (
            <ul className="mt-3 space-y-2" data-line-automation-dry-run-list>
              {dryRuns.map((row) => (
                <li key={row.id} className="rounded-2xl border border-border bg-white px-3 py-2 text-[13px]">
                  <p className="font-medium text-text">
                    {row.eligible ? "檢查通過" : row.skipReason ?? "未通過"}
                  </p>
                  <p className="text-secondary-text">{row.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            {visibleCards.map((definition) => (
              <LineAutomationCard
                key={definition.id}
                definition={definition}
                draft={drafts[definition.id]}
                selected={selectedId === definition.id}
                saved={definition.id === "appointment_reminder" ? saved : false}
                plannedCount={definition.id === "appointment_reminder" ? plannedCount : null}
                bindCount={definition.id === "appointment_reminder" ? bindCount : null}
                onSelect={() => setSelectedId(definition.id)}
                onToggle={(enabled) =>
                  setDrafts((current) =>
                    setLineAutomationEnabled(current, definition.id, enabled),
                  )
                }
                onOpenSettings={() => {
                  setSelectedId(definition.id);
                  setEditingId(definition.id);
                }}
              />
            ))}
          </div>
          <div className="xl:sticky xl:top-6">
            <LineAutomationPhonePreview
              officialName={officialName}
              templateTitle={selected.previewTitle}
              textBody={selectedDraft.template}
              quickReplies={selected.quickReplies}
              selectedId={selectedId}
              onSelectTemplate={(id) => {
                setSelectedId(id);
                if (tab !== "overview") setTab(id);
              }}
            />
          </div>
        </div>
      )}

      {selectedId === "appointment_reminder" && tab !== "history" ? (
        <Card padding="lg" data-line-automation-reminder-status>
          <h2 className="text-[16px] font-semibold text-text">預約提醒資料狀態</h2>
          <p className="mt-2 text-[13px] text-secondary-text" data-line-automation-saved-state>
            {saved ? "設定已儲存。正式發送仍關閉。" : LINE_AUTOMATION_DB_NOT_READY}
          </p>
          <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-secondary-text">{LINE_AUTOMATION_BIND_COUNT_LABEL}</dt>
              <dd className="font-medium text-text">{bindCount ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-secondary-text">{LINE_AUTOMATION_PLANNED_COUNT_LABEL}</dt>
              <dd className="font-medium text-text">{plannedCount ?? "—"}</dd>
            </div>
          </dl>
          {persistOpen ? (
            <div className="mt-4 space-y-3">
              <label className="block space-y-1">
                <span className="text-[13px] text-text">客人識別（customer app id）</span>
                <input
                  value={bindCustomerId}
                  onChange={(event) => setBindCustomerId(event.target.value)}
                  className="min-h-11 w-full rounded-2xl border border-border bg-white px-4 text-[14px] outline-none"
                />
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center justify-center rounded-full bg-primary px-4 text-[13px] font-medium text-white"
                  onClick={() => {
                    void startCustomerLineBindAction({
                      organizationId: organization.id,
                      customerId: bindCustomerId.trim(),
                    }).then((result) => {
                      setPersistMessage(result.message);
                      setBindCode(result.ok ? result.data?.code ?? null : null);
                    });
                  }}
                >
                  {LINE_AUTOMATION_START_BIND_LABEL}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-primary/35 px-4 text-[13px] font-medium text-primary"
                  onClick={() => {
                    void runAppointmentReminderDryRunAction(organization.id).then((result) => {
                      setPersistMessage(result.message);
                      void loadAppointmentReminderWorkspaceAction(organization.id).then((loaded) => {
                        if (loaded.ok && loaded.data) setDryRuns(loaded.data.dryRuns);
                      });
                    });
                  }}
                >
                  {LINE_AUTOMATION_DRY_RUN_ACTION_LABEL}
                </button>
              </div>
              <p className="text-[12px] text-secondary-text">{LINE_AUTOMATION_BIND_HINT}</p>
              {bindCode ? (
                <p className="text-[13px] font-medium text-text" data-line-automation-bind-code>
                  驗證碼：{bindCode}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-secondary-text">{LINE_AUTOMATION_DB_NOT_READY}</p>
          )}
        </Card>
      ) : null}

      <LineAutomationMonthlyStats stats={stats} />

      <p className="text-[12px] text-secondary-text">
        <Link href="/staff/line" className="text-primary">
          返回 LINE 群發
        </Link>
      </p>

      {editingId ? (
        <LineAutomationRuleEditor
          definition={lineAutomationById(editingId)}
          draft={drafts[editingId]}
          persistMessage={editingId === "appointment_reminder" ? persistMessage : null}
          onClose={() => setEditingId(null)}
          onApply={(next) => {
            setDrafts((current) => applyLineAutomationEditor(current, next));
            if (next.id !== "appointment_reminder") return;
            void saveAppointmentReminderRuleAction({
              organizationId: organization.id,
              draft: next,
            }).then((result) => {
              setPersistMessage(result.message || LINE_AUTOMATION_PERSIST_CLOSED_MESSAGE);
              setSaved(result.persisted === true);
              if (result.persisted) {
                void loadAppointmentReminderWorkspaceAction(organization.id).then((loaded) => {
                  if (!loaded.ok || !loaded.data) return;
                  setPlannedCount(loaded.data.plannedCount);
                  setBindCount(loaded.data.bindCount);
                  setDryRuns(loaded.data.dryRuns);
                  setDeliveries(loaded.data.deliveries);
                });
              }
            });
          }}
        />
      ) : null}
    </div>
  );
}
