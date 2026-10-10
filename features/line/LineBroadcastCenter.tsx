"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  confirmLineBroadcastAction,
  loadLineBroadcastsAction,
  saveLineBroadcastDraftAction,
} from "@/lib/line/actions";
import { newLineRequestId } from "@/lib/line/line-command";
import { LINE_BROADCAST_TEXT_MAX } from "@/lib/line/line-flag";
import {
  canShowLineSettings,
  lineBroadcastApiResultLabel,
  lineBroadcastStatusLabel,
} from "@/lib/line/line-visibility";
import type { LineBroadcastPublic } from "@/lib/line/line-types";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

export function LineBroadcastCenter({
  connectionPilotEnabled,
}: {
  connectionPilotEnabled: boolean;
}) {
  const { organization, membership } = useOrganization();
  const [textBody, setTextBody] = useState("");
  const [requestId, setRequestId] = useState(() => newLineRequestId());
  const [broadcastId, setBroadcastId] = useState<string | undefined>();
  const [history, setHistory] = useState<LineBroadcastPublic[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const allowed = canShowLineSettings(membership);

  const preview = useMemo(() => textBody.trim(), [textBody]);

  function reload() {
    startTransition(async () => {
      const loaded = await loadLineBroadcastsAction(organization.id);
      if (loaded.ok) setHistory(loaded.data ?? []);
    });
  }

  useEffect(() => {
    if (allowed && connectionPilotEnabled) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, connectionPilotEnabled, organization.id]);

  if (!allowed) {
    return (
      <Card data-line-broadcast-denied padding="lg">
        <p className="text-[16px] font-semibold text-text">只有店長可以使用 LINE 群發</p>
      </Card>
    );
  }

  return (
    <div data-line-broadcast-center className="space-y-4">
      <header className="space-y-1">
        <p className="text-[11px] tracking-[0.18em] text-secondary-text">Beauty OS</p>
        <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
          LINE 群發中心
        </h1>
        <p className="text-sm text-secondary-text">
          Phase 1 只支援官方帳號全好友文字 Broadcast。不會顯示好友數或假分群。
        </p>
        <Link href="/staff/settings/line" className="text-sm text-primary">
          LINE 官方帳號設定
        </Link>
      </header>

      {!connectionPilotEnabled ? (
        <Card padding="lg">
          <p className="text-sm text-secondary-text">LINE 串接尚未在此環境啟用。</p>
        </Card>
      ) : (
        <div className="grid gap-4 min-[1200px]:grid-cols-2">
          <Card padding="lg" className="space-y-4">
            <h2 className="text-[16px] font-semibold text-text">文字訊息</h2>
            <textarea
              data-line-broadcast-editor
              className="min-h-40 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-[15px] outline-none"
              maxLength={LINE_BROADCAST_TEXT_MAX}
              value={textBody}
              onChange={(event) => setTextBody(event.target.value)}
              placeholder="輸入要群發給全部好友的文字"
            />
            <p className="text-[12px] text-secondary-text">
              {textBody.length} / {LINE_BROADCAST_TEXT_MAX} · 識別 {requestId}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setError("");
                  startTransition(async () => {
                    const saved = await saveLineBroadcastDraftAction({
                      organizationId: organization.id,
                      textBody,
                      broadcastId,
                      requestId,
                    });
                    if (saved.ok && saved.data) {
                      setBroadcastId(saved.data.broadcastId);
                      setRequestId(saved.data.requestId);
                      setMessage(saved.message);
                      reload();
                    } else if (!saved.ok) {
                      setError(saved.message);
                    }
                  });
                }}
              >
                保存草稿
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirming(true)}
              >
                預覽並確認
              </Button>
            </div>
          </Card>

          <Card data-line-broadcast-preview padding="lg" className="space-y-3">
            <h2 className="text-[16px] font-semibold text-text">訊息預覽</h2>
            <div className="rounded-2xl bg-primary-light/50 px-4 py-3 text-[15px] whitespace-pre-wrap">
              {preview || "尚未輸入文字"}
            </div>
            <p className="text-[12px] text-secondary-text">
              發送對象：此官方帳號的全部好友。系統不估計送達人數。
            </p>
          </Card>
        </div>
      )}

      {confirming ? (
        <Card data-line-broadcast-confirm padding="lg" className="space-y-3">
          <p className="font-semibold text-text">確認發送？</p>
          <p className="text-sm text-secondary-text">
            Phase 1 不會呼叫 LINE Broadcast。確認後只會留下「未發送」紀錄，避免重複請求。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                setError("");
                startTransition(async () => {
                  const result = await confirmLineBroadcastAction({
                    organizationId: organization.id,
                    textBody,
                    requestId,
                    broadcastId,
                  });
                  setConfirming(false);
                  if (result.ok) {
                    setMessage(result.message);
                  } else {
                    setError(result.message);
                  }
                  reload();
                });
              }}
            >
              確認（不會實際發送）
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              返回編輯
            </Button>
          </div>
        </Card>
      ) : null}

      <Card padding="lg" className="space-y-3">
        <h2 className="text-[16px] font-semibold text-text">歷史紀錄</h2>
        {history.length === 0 ? (
          <p className="text-sm text-secondary-text">還沒有草稿或發送紀錄。</p>
        ) : (
          <ul className="space-y-2">
            {history.map((row) => (
              <li
                key={row.id}
                className="rounded-2xl border border-border px-4 py-3"
                data-line-broadcast-row={row.id}
              >
                <p className="text-sm font-medium text-text">
                  {lineBroadcastStatusLabel(row.status)}
                </p>
                <p className="mt-1 text-[13px] whitespace-pre-wrap text-secondary-text">
                  {row.textBody}
                </p>
                <p className="mt-1 text-[12px] text-secondary-text">
                  {lineBroadcastApiResultLabel(row.apiResult)} · {row.requestId}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {message ? <p className="text-[13px] text-[#5C7F66]">{message}</p> : null}
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
