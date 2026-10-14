"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  evaluateControlledReminderPushAction,
  loadControlledReminderPushViewAction,
  startDesignatedCustomerLineBindAction,
} from "@/lib/line/automations/appointment-reminder-actions";
import type {
  ControlledReminderPushDecision,
  ControlledReminderPushView,
} from "@/lib/line/automations/appointment-reminder-controlled-push";
import {
  CONTROLLED_REMINDER_PUSH_CONFIRM_PHRASE,
  isControlledReminderPushPanelVisible,
} from "@/lib/line/automations/appointment-reminder-controlled-push";
import {
  LINE_CONTROLLED_PUSH_BIND_LABEL,
  LINE_CONTROLLED_PUSH_BIND_STATUS_LABEL,
  LINE_CONTROLLED_PUSH_CHECK_LABEL,
  LINE_CONTROLLED_PUSH_CLOSED_LABEL,
  LINE_CONTROLLED_PUSH_CONSENT_STATUS_LABEL,
  LINE_CONTROLLED_PUSH_HINT,
  LINE_CONTROLLED_PUSH_KILL_LABEL,
  LINE_CONTROLLED_PUSH_ONESHOT_LABEL,
  LINE_CONTROLLED_PUSH_PHRASE_LABEL,
  LINE_CONTROLLED_PUSH_PREVIEW_LABEL,
  LINE_CONTROLLED_PUSH_REMAINING_LABEL,
  LINE_CONTROLLED_PUSH_TITLE,
} from "@/lib/line/automations/copy";

function bindLabel(status: ControlledReminderPushView["bindStatus"]): string {
  if (status === "verified") return "已驗證";
  if (status === "blocked") return "已封鎖";
  return "未綁定";
}

function consentLabel(status: ControlledReminderPushView["consentStatus"]): string {
  if (status === "consented") return "已同意";
  if (status === "unsubscribed") return "已退訂";
  return "尚未同意";
}

export function LineControlledReminderPushCard(input: {
  organizationId: string;
  template: string;
}) {
  const visible = isControlledReminderPushPanelVisible(input.organizationId);
  const [view, setView] = useState<ControlledReminderPushView | null>(null);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [decision, setDecision] = useState<ControlledReminderPushDecision | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [bindCode, setBindCode] = useState<string | null>(null);
  const [audits, setAudits] = useState<ControlledReminderPushDecision["audit"][]>([]);

  useEffect(() => {
    if (!visible) {
      setView(null);
      setDecision(null);
      setBindCode(null);
      setAudits([]);
      return;
    }
    void loadControlledReminderPushViewAction({
      organizationId: input.organizationId,
      template: input.template,
    }).then((result) => {
      if (!result.ok || !result.data) {
        setMessage(result.message);
        return;
      }
      setView(result.data);
      setMessage(result.message);
    });
  }, [input.organizationId, input.template, visible]);

  if (!visible) return null;

  return (
    <Card padding="lg" data-line-controlled-reminder-push>
      <h2 className="text-[16px] font-semibold text-text">{LINE_CONTROLLED_PUSH_TITLE}</h2>
      <p className="mt-2 text-[13px] text-secondary-text">{LINE_CONTROLLED_PUSH_HINT}</p>
      <p className="mt-2 text-[12px] font-medium text-text" data-line-controlled-push-closed>
        {LINE_CONTROLLED_PUSH_CLOSED_LABEL}
      </p>
      <dl className="mt-4 grid gap-2 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-secondary-text">店家</dt>
          <dd className="font-medium text-text" data-line-controlled-push-org>
            {view?.organizationLabel ?? "Beauty OS TEST"}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">指定假客戶</dt>
          <dd className="font-medium text-text" data-line-controlled-push-customer>
            {view?.customerName ?? "—"}
            <span className="ml-1 text-secondary-text">{view?.customerId}</span>
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_CONTROLLED_PUSH_BIND_STATUS_LABEL}</dt>
          <dd className="font-medium text-text" data-line-controlled-push-bind>
            {view ? bindLabel(view.bindStatus) : "—"}
            {view?.recipientHint ? ` ${view.recipientHint}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_CONTROLLED_PUSH_CONSENT_STATUS_LABEL}</dt>
          <dd className="font-medium text-text" data-line-controlled-push-consent>
            {view ? consentLabel(view.consentStatus) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_CONTROLLED_PUSH_REMAINING_LABEL}</dt>
          <dd className="font-medium text-text" data-line-controlled-push-remaining>
            {view ? `${view.remainingToday} / 1` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_CONTROLLED_PUSH_KILL_LABEL}</dt>
          <dd className="font-medium text-text">已關閉</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-secondary-text">LINE Channel 額度</dt>
          <dd className="font-medium text-text">{view?.quotaLabel ?? "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-secondary-text">{LINE_CONTROLLED_PUSH_ONESHOT_LABEL}</dt>
          <dd className="font-medium text-text" data-line-controlled-push-oneshot>
            {view?.oneshotId || "檢查時會產生"}
          </dd>
        </div>
      </dl>
      <div className="mt-4">
        <p className="text-[13px] text-secondary-text">{LINE_CONTROLLED_PUSH_PREVIEW_LABEL}</p>
        <pre
          className="mt-1 whitespace-pre-wrap rounded-2xl border border-border bg-white px-4 py-3 text-[13px] text-text"
          data-line-controlled-push-preview
        >
          {view?.previewText || "—"}
        </pre>
      </div>
      <label className="mt-4 block space-y-1">
        <span className="text-[13px] text-text">{LINE_CONTROLLED_PUSH_PHRASE_LABEL}</span>
        <input
          value={confirmPhrase}
          onChange={(event) => setConfirmPhrase(event.target.value)}
          placeholder={CONTROLLED_REMINDER_PUSH_CONFIRM_PHRASE}
          autoComplete="off"
          spellCheck={false}
          className="min-h-11 w-full rounded-2xl border border-border bg-white px-4 text-[14px] outline-none"
          data-line-controlled-push-phrase
        />
      </label>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className="inline-flex min-h-10 items-center justify-center rounded-full bg-primary px-4 text-[13px] font-medium text-white"
          onClick={() => {
            void startDesignatedCustomerLineBindAction(input.organizationId).then((result) => {
              setMessage(result.message);
              setBindCode(result.ok ? result.data?.code ?? null : null);
            });
          }}
        >
          {LINE_CONTROLLED_PUSH_BIND_LABEL}
        </button>
        <button
          type="button"
          className="inline-flex min-h-10 items-center justify-center rounded-full border border-primary/35 px-4 text-[13px] font-medium text-primary"
          data-line-controlled-push-check
          onClick={() => {
            void evaluateControlledReminderPushAction({
              organizationId: input.organizationId,
              template: input.template,
              confirmPhrase,
              oneshotId: view?.oneshotId,
            }).then((result) => {
              setMessage(result.message);
              if (result.ok && result.data) {
                setView(result.data.view);
                setDecision(result.data.decision);
                setAudits((current) => [result.data!.decision.audit, ...current].slice(0, 8));
              }
            });
          }}
        >
          {LINE_CONTROLLED_PUSH_CHECK_LABEL}
        </button>
      </div>
      {bindCode ? (
        <p className="mt-3 text-[13px] font-medium text-text" data-line-controlled-push-bind-code>
          驗證碼：{bindCode}
        </p>
      ) : null}
      {message ? <p className="mt-3 text-[13px] text-secondary-text">{message}</p> : null}
      {decision ? (
        <p className="mt-2 text-[13px] font-medium text-text" data-line-controlled-push-decision>
          {decision.authorized ? "檢查通過" : decision.reason}：{decision.message}
        </p>
      ) : null}
      {audits.length > 0 ? (
        <ul className="mt-3 space-y-2" data-line-controlled-push-audit>
          {audits.map((row) => (
            <li key={`${row.oneshotId}-${row.jobId}`} className="rounded-2xl border border-border bg-white px-3 py-2 text-[13px]">
              <p className="font-medium text-text">
                {row.authorized ? "已授權檢查" : "未授權"} · 未發送
              </p>
              <p className="text-secondary-text">
                {row.customerAppId} · {row.oneshotId} · {row.recipientHint}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
