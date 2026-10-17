"use client";

import { Card } from "@/components/ui/Card";
import {
  ENJOYE_OWNER_BIND_DISABLED_HINT,
  ENJOYE_OWNER_BIND_HINT,
  ENJOYE_OWNER_BIND_ISSUE_LABEL,
  ENJOYE_OWNER_BIND_TITLE,
  ENJOYE_OWNER_BIND_UNAVAILABLE,
  ENJOYE_OWNER_BIND_WEBHOOK_WARNING,
  canShowEnjoyeOwnerBindPrep,
  enjoyeOwnerBindMatchLabel,
  evaluateEnjoyeOwnerBindIssue,
  maskLineChannelId,
  type EnjoyeOwnerBindPrepActor,
} from "@/lib/line/enjoye-owner-bind-prep";
import type { OwnerSelfProductionBind } from "@/lib/line/automations/appointment-reminder-owner-self-production";

export function LineEnjoyeOwnerBindPrepCard({
  actor,
  channelId,
  bind,
}: {
  actor: EnjoyeOwnerBindPrepActor;
  channelId?: string | null;
  bind?: OwnerSelfProductionBind | null;
}) {
  if (!canShowEnjoyeOwnerBindPrep(actor)) return null;
  const issue = evaluateEnjoyeOwnerBindIssue({ actor, bind });

  return (
    <Card
      padding="lg"
      data-line-enjoye-owner-bind-prep
      data-line-enjoye-bind-issue-open="false"
      className="space-y-3"
    >
      <h2 className="text-[16px] font-semibold text-text">{ENJOYE_OWNER_BIND_TITLE}</h2>
      <p className="text-[13px] text-secondary-text">{ENJOYE_OWNER_BIND_HINT}</p>
      <p
        className="rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2 text-[12px] font-medium text-text"
        data-line-enjoye-bind-webhook-warning
      >
        {ENJOYE_OWNER_BIND_WEBHOOK_WARNING}
      </p>
      <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-secondary-text">LINE Channel（遮罩）</dt>
          <dd className="font-medium text-text" data-line-enjoye-bind-channel>
            {maskLineChannelId(channelId)}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">驗證來源</dt>
          <dd className="font-medium text-text" data-line-enjoye-bind-method>
            webhook_code（官方 Webhook，尚未切換）
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">登入 operational staff id</dt>
          <dd className="font-medium text-text" data-line-enjoye-bind-actor>
            {(actor.staffUserId ?? "").trim() || ENJOYE_OWNER_BIND_UNAVAILABLE}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">綁定 staff id</dt>
          <dd className="font-medium text-text" data-line-enjoye-bind-staff>
            {(bind?.staffUserId ?? "").trim() || ENJOYE_OWNER_BIND_UNAVAILABLE}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">目前登入是否為綁定本人</dt>
          <dd className="font-medium text-text" data-line-enjoye-bind-match>
            {enjoyeOwnerBindMatchLabel({ actor, bind })}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">綁定狀態</dt>
          <dd className="font-medium text-text" data-line-enjoye-bind-status>
            {bind?.boundAt ? `有列（${bind.hint || "••••"}），不能當作本人證明` : "未載入或尚未綁定"}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">綁定時間</dt>
          <dd className="font-medium text-text">{bind?.boundAt || ENJOYE_OWNER_BIND_UNAVAILABLE}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">加密憑證版本</dt>
          <dd className="font-medium text-text">{bind?.keyId || ENJOYE_OWNER_BIND_UNAVAILABLE}</dd>
        </div>
      </dl>
      <label className="block space-y-1">
        <span className="text-[13px] text-text">8 碼驗證碼</span>
        <input
          value=""
          disabled
          readOnly
          autoComplete="off"
          className="min-h-11 w-full rounded-2xl border border-border bg-[#F7F4F3] px-4 font-mono text-[16px] tracking-[0.2em] text-secondary-text outline-none"
          data-line-enjoye-bind-code
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-full border border-border px-4 text-[13px] font-medium text-secondary-text"
          data-line-enjoye-bind-issue
        >
          {ENJOYE_OWNER_BIND_ISSUE_LABEL}
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-full border border-border px-4 text-[13px] font-medium text-secondary-text"
          data-line-enjoye-bind-unbind
        >
          解除綁定
        </button>
      </div>
      <p className="text-[12px] text-secondary-text" data-line-enjoye-bind-issue-reason>
        {issue.message}
      </p>
      <p className="text-[12px] text-secondary-text">{ENJOYE_OWNER_BIND_DISABLED_HINT}</p>
    </Card>
  );
}
