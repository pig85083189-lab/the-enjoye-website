"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import {
  lineBroadcastHttpResultLabel,
  lineBroadcastMessageSummary,
  lineBroadcastOperatorLabel,
  lineBroadcastSafeErrorSummary,
  lineBroadcastSentAt,
  lineBroadcastTaipeiDateTime,
} from "@/lib/line/line-broadcast-center-ui";
import {
  lineBroadcastApiResultLabel,
  lineBroadcastStatusLabel,
} from "@/lib/line/line-visibility";
import type { LineBroadcastPublic } from "@/lib/line/line-types";

function statusTone(status: LineBroadcastPublic["status"]) {
  if (status === "accepted") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "pending_confirmation") return "warning" as const;
  if (status === "draft" || status === "confirm_pending") return "neutral" as const;
  return "primary" as const;
}

export function LineBroadcastHistoryPanel({
  rows,
  showRequestId,
}: {
  rows: LineBroadcastPublic[];
  showRequestId: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (rows.length === 0) {
    return <p className="text-sm text-secondary-text">還沒有草稿或發送紀錄。</p>;
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const expanded = openId === row.id;
        const error = lineBroadcastSafeErrorSummary(row.errorMessage);
        return (
          <li
            key={row.id}
            className="rounded-2xl border border-border px-4 py-3"
            data-line-broadcast-row={row.id}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge tone={statusTone(row.status)}>{lineBroadcastStatusLabel(row.status)}</Badge>
              <p className="text-[12px] text-secondary-text">
                建立 {lineBroadcastTaipeiDateTime(row.createdAt)}
              </p>
            </div>
            <p className="mt-2 text-sm font-medium text-text">
              {lineBroadcastMessageSummary(row.textBody)}
            </p>
            <dl className="mt-2 grid gap-1 text-[12px] text-secondary-text sm:grid-cols-2">
              <div>
                <dt className="sr-only">發送時間</dt>
                <dd>發送 {lineBroadcastSentAt(row)}</dd>
              </div>
              <div>
                <dt className="sr-only">操作者</dt>
                <dd>操作者 {lineBroadcastOperatorLabel(row)}</dd>
              </div>
              <div>
                <dt className="sr-only">LINE HTTP</dt>
                <dd>{lineBroadcastHttpResultLabel(row)}</dd>
              </div>
              <div>
                <dt className="sr-only">API 結果</dt>
                <dd>{lineBroadcastApiResultLabel(row.apiResult)}</dd>
              </div>
            </dl>
            {error ? <p className="mt-1 text-[12px] text-danger">{error}</p> : null}
            {showRequestId ? (
              <p className="mt-1 text-[12px] text-secondary-text">{row.requestId}</p>
            ) : null}
            <button
              type="button"
              className="mt-2 text-sm text-primary"
              data-line-history-full-text-toggle={row.id}
              onClick={() => setOpenId(expanded ? null : row.id)}
            >
              {expanded ? "收起全文" : "查看訊息全文"}
            </button>
            {expanded ? (
              <p
                data-line-history-full-text
                className="mt-2 whitespace-pre-wrap rounded-2xl bg-primary-light/40 px-3 py-2 text-[13px] text-text"
              >
                {row.textBody}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
