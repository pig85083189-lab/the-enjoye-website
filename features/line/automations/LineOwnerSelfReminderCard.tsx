"use client";

import { Card } from "@/components/ui/Card";
import {
  LINE_AUTOMATION_FLAG_CLOSED,
  LINE_OWNER_SELF_ACK_LABEL,
  LINE_OWNER_SELF_ACK_NOTE,
  LINE_OWNER_SELF_BIND_LABEL,
  LINE_OWNER_SELF_CHECK_LABEL,
  LINE_OWNER_SELF_CLOSED_LABEL,
  LINE_OWNER_SELF_CONSENT_LABEL,
  LINE_OWNER_SELF_DISABLED_HINT,
  LINE_OWNER_SELF_FLOW_HINT,
  LINE_OWNER_SELF_GRANT_LABEL,
  LINE_OWNER_SELF_GRANT_TTL_LABEL,
  LINE_OWNER_SELF_HINT,
  LINE_OWNER_SELF_ISSUE_LABEL,
  LINE_OWNER_SELF_MATCH_LABEL,
  LINE_OWNER_SELF_ONCE_ONLY_LABEL,
  LINE_OWNER_SELF_ONESHOT_LABEL,
  LINE_OWNER_SELF_ONESHOT_TTL_LABEL,
  LINE_OWNER_SELF_PHRASE_LABEL,
  LINE_OWNER_SELF_PURPOSE_LABEL,
  LINE_OWNER_SELF_REMAINING_LABEL,
  LINE_OWNER_SELF_REVOKE_LABEL,
  LINE_OWNER_SELF_SEND_OPEN_LABEL,
  LINE_OWNER_SELF_TITLE,
  LINE_OWNER_SELF_TRUST_LABEL,
  LINE_OWNER_SELF_UNAVAILABLE,
  LINE_OWNER_SELF_WEBHOOK_LABEL,
} from "@/lib/line/automations/copy";
import { LINE_OWNER_SELF_GRANT_PERSIST_OPEN } from "@/lib/line/automations/production-safe-flags";

const DISABLED_INTENTS = [
  ["grant", LINE_OWNER_SELF_GRANT_LABEL],
  ["issue", LINE_OWNER_SELF_ISSUE_LABEL],
  ["revoke", LINE_OWNER_SELF_REVOKE_LABEL],
] as const;

export function LineOwnerSelfReminderCard() {
  return (
    <Card
      padding="lg"
      data-line-owner-self-reminder
      data-line-owner-self-production-safe
      data-line-owner-self-persist-open={LINE_OWNER_SELF_GRANT_PERSIST_OPEN ? "true" : "false"}
    >
      <h2 className="text-[16px] font-semibold text-text">{LINE_OWNER_SELF_TITLE}</h2>
      <p className="mt-2 text-[13px] text-secondary-text">{LINE_OWNER_SELF_HINT}</p>
      <p className="mt-2 text-[12px] font-medium text-text">{LINE_OWNER_SELF_CLOSED_LABEL}</p>
      <p
        className="mt-2 rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2 text-[12px] font-medium text-text"
        data-line-owner-self-once-only
      >
        {LINE_OWNER_SELF_ONCE_ONLY_LABEL}
      </p>
      <p className="mt-2 text-[12px] text-secondary-text" data-line-owner-self-flow>
        {LINE_OWNER_SELF_FLOW_HINT}
      </p>
      <dl className="mt-4 grid gap-2 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_BIND_LABEL}</dt>
          <dd className="font-medium text-text" data-line-owner-self-bind>
            {LINE_OWNER_SELF_UNAVAILABLE}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_WEBHOOK_LABEL}</dt>
          <dd className="font-medium text-text" data-line-owner-self-webhook>
            {LINE_OWNER_SELF_UNAVAILABLE}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_MATCH_LABEL}</dt>
          <dd className="font-medium text-text" data-line-owner-self-match>
            {LINE_OWNER_SELF_UNAVAILABLE}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_PURPOSE_LABEL}</dt>
          <dd className="font-medium text-text" data-line-owner-self-purpose>
            僅接收一則測試預約提醒
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_CONSENT_LABEL}</dt>
          <dd className="font-medium text-text" data-line-owner-self-consent>
            {LINE_OWNER_SELF_UNAVAILABLE}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_GRANT_TTL_LABEL}</dt>
          <dd className="font-medium text-text" data-line-owner-self-grant-ttl>
            {LINE_OWNER_SELF_UNAVAILABLE}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_TRUST_LABEL}</dt>
          <dd className="font-medium text-text" data-line-owner-self-trust>
            {LINE_OWNER_SELF_UNAVAILABLE}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_REMAINING_LABEL}</dt>
          <dd className="font-medium text-text">—</dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_ONESHOT_LABEL}</dt>
          <dd className="font-medium text-text">{LINE_OWNER_SELF_UNAVAILABLE}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_ONESHOT_TTL_LABEL}</dt>
          <dd className="font-medium text-text" data-line-owner-self-oneshot-ttl>
            {LINE_OWNER_SELF_UNAVAILABLE}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_OWNER_SELF_SEND_OPEN_LABEL}</dt>
          <dd className="font-medium text-text" data-line-owner-self-send-open>
            {LINE_AUTOMATION_FLAG_CLOSED}
          </dd>
        </div>
      </dl>
      <label className="mt-4 flex items-start gap-2 text-[13px] text-secondary-text">
        <input
          type="checkbox"
          checked={false}
          disabled
          readOnly
          className="mt-1"
          data-line-owner-self-ack
        />
        <span>
          {LINE_OWNER_SELF_ACK_LABEL}
          <span className="mt-1 block text-[12px]">{LINE_OWNER_SELF_ACK_NOTE}</span>
        </span>
      </label>
      <label className="mt-4 block space-y-1">
        <span className="text-[13px] text-text">{LINE_OWNER_SELF_PHRASE_LABEL}</span>
        <input
          value=""
          disabled
          readOnly
          autoComplete="off"
          spellCheck={false}
          className="min-h-11 w-full rounded-2xl border border-border bg-[#F7F4F3] px-4 text-[14px] text-secondary-text outline-none"
          data-line-owner-self-phrase
        />
      </label>
      <div className="mt-4">
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-full border border-border px-4 text-[13px] font-medium text-secondary-text"
          data-line-owner-self-check
        >
          {LINE_OWNER_SELF_CHECK_LABEL}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {DISABLED_INTENTS.map(([intent, label]) => (
          <button
            key={intent}
            type="button"
            disabled
            aria-disabled="true"
            className="inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-full border border-border px-4 text-[13px] font-medium text-secondary-text"
            data-line-owner-self-intent={intent}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-secondary-text" data-line-owner-self-persist>
        {LINE_OWNER_SELF_DISABLED_HINT}
      </p>
    </Card>
  );
}
