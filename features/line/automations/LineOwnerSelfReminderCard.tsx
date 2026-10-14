"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  evaluateOwnerSelfReminderPushAction,
  loadOwnerSelfReminderViewAction,
} from "@/lib/line/automations/appointment-reminder-actions";
import type {
  OwnerSelfReminderDecision,
  OwnerSelfReminderView,
} from "@/lib/line/automations/appointment-reminder-owner-self-push";
import {
  OWNER_SELF_REMINDER_CONFIRM_PHRASE,
  isOwnerSelfReminderPanelVisible,
} from "@/lib/line/automations/appointment-reminder-owner-self-push";
import {
  LINE_CONTROLLED_PUSH_ONESHOT_LABEL,
  LINE_CONTROLLED_PUSH_PHRASE_LABEL,
  LINE_CONTROLLED_PUSH_REMAINING_LABEL,
  LINE_OWNER_SELF_ACK_LABEL,
  LINE_OWNER_SELF_ACK_NOTE,
  LINE_OWNER_SELF_BIND_LABEL,
  LINE_OWNER_SELF_CHECK_LABEL,
  LINE_OWNER_SELF_CLOSED_LABEL,
  LINE_OWNER_SELF_CONSENT_LABEL,
  LINE_OWNER_SELF_HINT,
  LINE_OWNER_SELF_ONCE_ONLY_LABEL,
  LINE_OWNER_SELF_TITLE,
  LINE_OWNER_SELF_TRUST_LABEL,
} from "@/lib/line/automations/copy";

export function LineOwnerSelfReminderCard(input: { organizationId: string }) {
  const visible = isOwnerSelfReminderPanelVisible(input.organizationId);
  const [view, setView] = useState<OwnerSelfReminderView | null>(null);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [decision, setDecision] = useState<OwnerSelfReminderDecision | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [audits, setAudits] = useState<OwnerSelfReminderDecision["audit"][]>([]);

  useEffect(() => {
    if (!visible) {
      setView(null);
      setDecision(null);
      setAudits([]);
      return;
    }
    void loadOwnerSelfReminderViewAction({ organizationId: input.organizationId }).then((result) => {
      if (!result.ok || !result.data) {
        setMessage(result.message);
        return;
      }
      setView(result.data);
      setMessage(result.message);
    });
  }, [input.organizationId, visible]);

  if (!visible) return null;

  return (
    <Card padding="lg" data-line-owner-self-reminder>
      <h2 className="text-[16px] font-semibold text-text">{LINE_OWNER_SELF_TITLE}</h2>
      <p className="mt-2 text-[13px] text-secondary-text">{LINE_OWNER_SELF_HINT}</p>
      <p className="mt-2 text-[12px] font-medium text-text">{LINE_OWNER_SELF_CLOSED_LABEL}</p>
      <p
        className="mt-2 rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2 text-[12px] font-medium text-text"
        data-line-owner-self-once-only
      >
        {LINE_OWNER_SELF_ONCE_ONLY_LABEL}
      </p>
      <dl className="mt-4 grid gap-2 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-secondary-text">LINE Channel</dt>
          <dd className="font-medium text-text">••••{view?.channelLast4 ?? "9238"}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_BIND_LABEL}</dt>
          <dd className="font-medium text-text" data-line-owner-self-bind>
            {view?.ownerBindPresent ? `已驗證 ${view.ownerBindHint}` : "尚未驗證"}
            {view ? " · 只當身分證據" : ""}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_CONSENT_LABEL}</dt>
          <dd className="font-medium text-text" data-line-owner-self-consent>
            {view?.independentConsent ? "已有伺服器授權列" : "尚未同意（test-push 不算）"}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_TRUST_LABEL}</dt>
          <dd className="font-medium text-text" data-line-owner-self-trust>
            尚未指定
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_CONTROLLED_PUSH_REMAINING_LABEL}</dt>
          <dd className="font-medium text-text">{view ? `${view.remainingToday} / 1` : "—"}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_CONTROLLED_PUSH_ONESHOT_LABEL}</dt>
          <dd className="font-medium text-text">{view?.oneshotId || "檢查時會產生"}</dd>
        </div>
      </dl>
      <label className="mt-4 flex items-start gap-2 text-[13px] text-text">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-1"
          data-line-owner-self-ack
        />
        <span>
          {LINE_OWNER_SELF_ACK_LABEL}
          <span className="mt-1 block text-[12px] text-secondary-text">
            {LINE_OWNER_SELF_ACK_NOTE}
          </span>
        </span>
      </label>
      <label className="mt-4 block space-y-1">
        <span className="text-[13px] text-text">{LINE_CONTROLLED_PUSH_PHRASE_LABEL}</span>
        <input
          value={confirmPhrase}
          onChange={(event) => setConfirmPhrase(event.target.value)}
          placeholder={OWNER_SELF_REMINDER_CONFIRM_PHRASE}
          autoComplete="off"
          spellCheck={false}
          className="min-h-11 w-full rounded-2xl border border-border bg-white px-4 text-[14px] outline-none"
          data-line-owner-self-phrase
        />
      </label>
      <div className="mt-4">
        <button
          type="button"
          className="inline-flex min-h-10 items-center justify-center rounded-full border border-primary/35 px-4 text-[13px] font-medium text-primary"
          data-line-owner-self-check
          onClick={() => {
            void evaluateOwnerSelfReminderPushAction({
              organizationId: input.organizationId,
              confirmPhrase,
              oneshotId: view?.oneshotId,
              clientAcknowledged: acknowledged,
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
          {LINE_OWNER_SELF_CHECK_LABEL}
        </button>
      </div>
      {message ? <p className="mt-3 text-[13px] text-secondary-text">{message}</p> : null}
      {decision ? (
        <p className="mt-2 text-[13px] font-medium text-text">
          {decision.authorized ? "檢查通過" : decision.reason}：{decision.message}
        </p>
      ) : null}
      {audits.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {audits.map((row) => (
            <li key={row.oneshotId} className="rounded-2xl border border-border bg-white px-3 py-2 text-[13px]">
              <p className="font-medium text-text">{row.authorized ? "已授權檢查" : "未授權"} · 未發送</p>
              <p className="text-secondary-text">
                {row.oneshotId} · {row.recipientHint}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
