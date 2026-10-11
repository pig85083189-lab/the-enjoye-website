"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  confirmLineBroadcastAction,
  loadLineBroadcastPrepareAction,
  saveLineBroadcastDraftAction,
  sendLineBroadcastAction,
  sendLineTestPushAction,
} from "@/lib/line/actions";
import { newLineRequestId, newLineTestRequestId } from "@/lib/line/line-command";
import { LINE_BROADCAST_TEXT_MAX } from "@/lib/line/line-flag";
import { restoreLineBroadcastEditor, unknownLineQuota } from "@/lib/line/line-quota";
import {
  canShowLineSettings,
  lineBroadcastApiResultLabel,
  lineBroadcastStatusLabel,
  lineOfficialAccountNameLabel,
  lineOwnerRecipientLabel,
  lineTestPushDiagnosticLabel,
  lineTestPushDisplayedError,
} from "@/lib/line/line-visibility";
import type {
  LineBroadcastPublic,
  LineOfficialAccountPublic,
  LineOwnerRecipientPublic,
  LineQuotaPublic,
  LineTestSendPublic,
} from "@/lib/line/line-types";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

function lineTestSendHistoryMeta(row: LineTestSendPublic): string {
  const shownError = lineTestPushDisplayedError(row.errorMessage);
  const diagnostic = lineTestPushDiagnosticLabel(row);
  return `${lineBroadcastApiResultLabel(row.apiResult)} · ${row.requestId}${
    shownError ? ` · ${shownError}` : ""
  }${diagnostic ? ` · ${diagnostic}` : ""}`;
}

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
  const [account, setAccount] = useState<LineOfficialAccountPublic | null>(null);
  const [quota, setQuota] = useState<LineQuotaPublic>(() => unknownLineQuota());
  const [sendOpen, setSendOpen] = useState(false);
  const [testPushOpen, setTestPushOpen] = useState(false);
  const [recipient, setRecipient] = useState<LineOwnerRecipientPublic | null>(null);
  const [testSends, setTestSends] = useState<LineTestSendPublic[]>([]);
  const [testRequestId, setTestRequestId] = useState(() => newLineTestRequestId());
  const [confirming, setConfirming] = useState(false);
  const [realSendAck, setRealSendAck] = useState(false);
  const [testAck, setTestAck] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const allowed = canShowLineSettings(membership);

  const preview = useMemo(() => textBody.trim(), [textBody]);
  const officialName = lineOfficialAccountNameLabel(account);

  function applyPrepare(data: {
    account: LineOfficialAccountPublic | null;
    quota: LineQuotaPublic;
    sendOpen: boolean;
    testPushOpen: boolean;
    broadcasts: LineBroadcastPublic[];
    testSends: LineTestSendPublic[];
    recipient: LineOwnerRecipientPublic | null;
  }) {
    setAccount(data.account);
    setQuota(data.quota);
    setSendOpen(data.sendOpen);
    setTestPushOpen(data.testPushOpen);
    setHistory(data.broadcasts);
    setTestSends(data.testSends);
    setRecipient(data.recipient);
  }

  function reload(restoreDraft: boolean) {
    startTransition(async () => {
      const loaded = await loadLineBroadcastPrepareAction(organization.id);
      if (!loaded.ok || !loaded.data) {
        if (!loaded.ok) setError(loaded.message);
        return;
      }
      applyPrepare(loaded.data);
      if (!restoreDraft) return;
      const restored = restoreLineBroadcastEditor({
        history: loaded.data.broadcasts,
        currentText: "",
        currentRequestId: requestId,
      });
      if (restored.restored) {
        setTextBody(restored.textBody);
        setRequestId(restored.requestId);
        setBroadcastId(restored.broadcastId);
      }
    });
  }

  useEffect(() => {
    if (allowed && connectionPilotEnabled) reload(true);
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
          只支援官方帳號全好友文字 Broadcast。成功只代表 API 已接受，不估計好友數。
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
                      reload(false);
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
                onClick={() => {
                  setRealSendAck(false);
                  setTestAck(false);
                  setConfirming(true);
                  reload(false);
                }}
              >
                預覽並確認
              </Button>
            </div>
          </Card>

          <Card data-line-broadcast-preview padding="lg" className="space-y-3">
            <h2 className="text-[16px] font-semibold text-text">訊息預覽</h2>
            <p className="text-[13px] text-secondary-text" data-line-oa-name>
              官方帳號：{officialName}
            </p>
            <div className="rounded-2xl bg-primary-light/50 px-4 py-3 text-[15px] whitespace-pre-wrap">
              {preview || "尚未輸入文字"}
            </div>
            <p className="text-[12px] text-secondary-text" data-line-quota>
              LINE 額度：{quota.label}
            </p>
            <p className="text-[12px] text-secondary-text">
              發送對象：此官方帳號的全部好友。系統不估計送達人數。
            </p>
          </Card>
        </div>
      )}

      {confirming ? (
        <Card data-line-broadcast-confirm padding="lg" className="space-y-4">
          <p className="font-semibold text-text">確認發送？</p>
          <div className="rounded-2xl bg-primary-light/50 px-4 py-3 text-sm space-y-1">
            <p data-line-confirm-oa>官方帳號：{officialName}</p>
            <p data-line-confirm-quota>LINE 額度：{quota.label}</p>
            <p>伺服器發送開關：{sendOpen ? "開啟" : "關閉（預設）"}</p>
            <p>店長群發開關：{account?.broadcastEnabled ? "已啟用" : "未啟用"}</p>
            <p>
              連線狀態：
              {account?.lastTestStatus === "ok" ? "已連線" : "尚未確認連線"}
            </p>
          </div>
          <div className="rounded-2xl border border-border px-4 py-3 text-[15px] whitespace-pre-wrap">
            {preview || "尚未輸入文字"}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-text">練習確認</p>
            <p className="text-sm text-secondary-text">
              這一步不會呼叫 LINE Broadcast，只會留下「未發送」紀錄。
            </p>
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
                  setRealSendAck(false);
                  if (result.ok) {
                    setMessage(result.message);
                  } else {
                    setError(result.message);
                  }
                  reload(false);
                });
              }}
            >
              確認（不會實際發送）
            </Button>
          </div>

          <div className="space-y-2 border-t border-border pt-4" data-line-broadcast-real-send>
            <p className="text-sm font-medium text-text">真實發送</p>
            <p className="text-sm text-secondary-text">
              這不是練習按鈕。成功只顯示「API 已接受」，不代表全部好友已收到。逾時不會自動重送。
            </p>
            <label className="flex items-start gap-2 text-sm text-text">
              <input
                type="checkbox"
                data-line-real-send-ack
                className="mt-1"
                checked={realSendAck}
                onChange={(event) => setRealSendAck(event.target.checked)}
              />
              <span>
                我了解這會向「{officialName}」的全部好友發送，且系統不會在逾時後自動重送。
              </span>
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !realSendAck}
              onClick={() => {
                setError("");
                startTransition(async () => {
                  const result = await sendLineBroadcastAction({
                    organizationId: organization.id,
                    textBody,
                    requestId,
                    broadcastId,
                    acknowledged: realSendAck,
                  });
                  setConfirming(false);
                  setRealSendAck(false);
                  if (result.ok) {
                    setMessage(result.message);
                    setTextBody("");
                    setBroadcastId(undefined);
                    setRequestId(newLineRequestId());
                  } else {
                    setError(result.message);
                  }
                  reload(false);
                });
              }}
            >
              確認真實發送
            </Button>
          </div>

          <div className="space-y-2 border-t border-border pt-4" data-line-test-push>
            <p className="text-sm font-medium text-text">發送測試給自己</p>
            <p className="text-sm text-secondary-text">
              使用 Push 傳給已驗證的店長 LINE，不是 Broadcast。環境允許：
              {testPushOpen ? "開啟" : "關閉（預設）"}。伺服器總開關：
              {account?.testPushRuntimeOpen ? "開啟" : "關閉（預設）"}。
              關閉總開關可立即停止後續新發送；已開始的 LINE HTTP 無法保證取消。
            </p>
            <p className="text-sm text-secondary-text" data-line-test-recipient>
              收件者：{lineOwnerRecipientLabel(recipient)}
            </p>
            <label className="flex items-start gap-2 text-sm text-text">
              <input
                type="checkbox"
                data-line-test-send-ack
                className="mt-1"
                checked={testAck}
                onChange={(event) => setTestAck(event.target.checked)}
              />
              <span>
                我是店長，確認把這則測試訊息只發給已綁定的自己，且逾時不會自動重送。
              </span>
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !testAck}
              onClick={() => {
                setError("");
                startTransition(async () => {
                  const result = await sendLineTestPushAction({
                    organizationId: organization.id,
                    textBody,
                    requestId: testRequestId,
                    acknowledged: testAck,
                  });
                  setConfirming(false);
                  setTestAck(false);
                  setTestRequestId(newLineTestRequestId());
                  if (result.ok) {
                    setMessage(result.message);
                  } else {
                    setError(result.message);
                  }
                  reload(false);
                });
              }}
            >
              確認測試發送
            </Button>
            <Link href="/staff/settings/line" className="block text-sm text-primary">
              前往綁定店長 LINE
            </Link>
          </div>

          <Button type="button" variant="ghost" onClick={() => {
            setConfirming(false);
            setTestAck(false);
          }}>
            返回編輯
          </Button>
        </Card>
      ) : null}

      <Card padding="lg" className="space-y-3" data-line-test-history>
        <h2 className="text-[16px] font-semibold text-text">測試發送紀錄</h2>
        {testSends.length === 0 ? (
          <p className="text-sm text-secondary-text">還沒有測試發送紀錄。</p>
        ) : (
          <ul className="space-y-2">
            {testSends.map((row) => (
              <li key={row.id} className="rounded-2xl border border-border px-4 py-3">
                <p className="text-sm font-medium text-text">
                  {lineBroadcastStatusLabel(row.status)}
                </p>
                <p className="mt-1 text-[13px] whitespace-pre-wrap text-secondary-text">
                  {row.textBody}
                </p>
                <p className="mt-1 text-[12px] text-secondary-text">
                  {lineTestSendHistoryMeta(row)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

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
                  {row.errorMessage ? ` · ${row.errorMessage}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {message ? (
        <p className="text-[13px] text-[#5C7F66]" data-line-broadcast-message>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] text-danger" data-line-broadcast-error>
          {error}
        </p>
      ) : null}
    </div>
  );
}
