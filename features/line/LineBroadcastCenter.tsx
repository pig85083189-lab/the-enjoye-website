"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  loadLineBroadcastPrepareAction,
  saveLineBroadcastDraftAction,
  sendLineBroadcastAction,
  sendLineTestPushAction,
  setLineTestPushEnabledAction,
  setLineTestPushRuntimeOpenAction,
} from "@/lib/line/actions";
import { newLineRequestId, newLineTestRequestId } from "@/lib/line/line-command";
import { LINE_BROADCAST_TEXT_MAX } from "@/lib/line/line-flag";
import { restoreLineBroadcastEditor, unknownLineQuota } from "@/lib/line/line-quota";
import {
  canShowLineEngineerDiagnostics,
  canShowLineSettings,
  isLineBroadcastConfirmSubmitEnabled,
  lineBroadcastApiResultLabel,
  lineBroadcastConfirmStatusHint,
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
  const [testTextBody, setTestTextBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [realSendAck, setRealSendAck] = useState(false);
  const [testAck, setTestAck] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const allowed = canShowLineSettings(membership);
  const engineer = canShowLineEngineerDiagnostics(organization.id);

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
          LINE 群發
        </h1>
        <p className="text-sm text-secondary-text">
          編輯訊息、預覽後確認，會發送給此官方帳號所有可接收訊息的好友。
        </p>
        <Link href="/staff/settings/line" className="text-sm text-primary">
          LINE 設定
        </Link>
      </header>

      {!connectionPilotEnabled ? (
        <Card padding="lg">
          <p className="text-sm text-secondary-text">LINE 串接尚未在此環境啟用。</p>
        </Card>
      ) : (
        <div className="grid gap-4 min-[1200px]:grid-cols-2">
          <Card padding="lg" className="space-y-4" data-line-broadcast-editor-card>
            <h2 className="text-[16px] font-semibold text-text">建立群發</h2>
            <textarea
              data-line-broadcast-editor
              className="min-h-40 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-[15px] outline-none"
              maxLength={LINE_BROADCAST_TEXT_MAX}
              value={textBody}
              onChange={(event) => setTextBody(event.target.value)}
              placeholder="輸入要群發給全部好友的文字"
            />
            <p className="text-[12px] text-secondary-text">
              {textBody.length} / {LINE_BROADCAST_TEXT_MAX}
              {engineer ? ` · 識別 ${requestId}` : ""}
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
              發送對象：此官方帳號所有可接收訊息的好友。系統不估計好友數。
            </p>
          </Card>
        </div>
      )}

      {confirming ? (
        <Card data-line-broadcast-confirm padding="lg" className="space-y-4">
          <h2 className="text-[16px] font-semibold text-text">確認發送</h2>
          <div className="rounded-2xl bg-primary-light/50 px-4 py-3 text-sm space-y-1">
            <p data-line-confirm-oa>官方帳號：{officialName}</p>
            <p data-line-confirm-audience>發送對象：全部好友</p>
          </div>
          <div
            data-line-confirm-message
            className="rounded-2xl border border-border px-4 py-3 text-[15px] whitespace-pre-wrap"
          >
            {preview || "尚未輸入文字"}
          </div>
          <p className="text-sm text-secondary-text" data-line-confirm-status>
            {lineBroadcastConfirmStatusHint(sendOpen)}
          </p>
          <div className="space-y-3" data-line-broadcast-real-send>
            <label className="flex items-start gap-2 text-sm text-text">
              <input
                type="checkbox"
                data-line-real-send-ack
                className="mt-1"
                checked={realSendAck}
                onChange={(event) => setRealSendAck(event.target.checked)}
                disabled={!sendOpen || pending}
              />
              <span>我確認訊息內容正確，並同意發送給全部好友。</span>
            </label>
            <Button
              type="button"
              data-line-confirm-submit
              disabled={!isLineBroadcastConfirmSubmitEnabled({
                sendOpen,
                acknowledged: realSendAck,
                pending,
              })}
              onClick={() => {
                if (
                  !isLineBroadcastConfirmSubmitEnabled({
                    sendOpen,
                    acknowledged: realSendAck,
                    pending,
                  })
                ) {
                  return;
                }
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
              確認發送
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setConfirming(false);
              setRealSendAck(false);
            }}
          >
            返回編輯
          </Button>
        </Card>
      ) : null}

      <Card padding="lg" className="space-y-3" data-line-broadcast-history>
        <h2 className="text-[16px] font-semibold text-text">發送紀錄</h2>
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
                  {lineBroadcastApiResultLabel(row.apiResult)}
                  {engineer ? ` · ${row.requestId}` : ""}
                  {row.errorMessage ? ` · ${row.errorMessage}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {engineer ? (
        <Card padding="lg" className="space-y-4" data-line-engineer-diagnostics>
          <h2 className="text-[16px] font-semibold text-text">工程師診斷</h2>
          <p className="text-sm text-secondary-text">
            此區塊只在 Beauty OS TEST 顯示，不是一般店長操作。單人測試 Push 不是全好友 Broadcast。
          </p>
          <div data-line-test-push className="space-y-3">
            <p className="text-sm font-medium text-text">單人測試 Push</p>
            <p className="text-sm text-secondary-text" data-line-test-env>
              測試發送環境：{testPushOpen ? "允許" : "不允許"}
            </p>
            <p className="text-sm text-secondary-text" data-line-test-runtime>
              伺服器總開關：{account?.testPushRuntimeOpen ? "開啟" : "關閉（預設）"}
              。關閉後可立即停止後續新發送；已開始的 LINE HTTP 無法保證取消。
            </p>
            <p className="text-sm text-secondary-text">
              店長測試開關：{account?.testPushEnabled ? "已啟用" : "未啟用"}
            </p>
            <p className="text-sm text-secondary-text" data-line-test-recipient>
              收件者：{lineOwnerRecipientLabel(recipient)}
            </p>
            <textarea
              data-line-test-editor
              className="min-h-24 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-[15px] outline-none"
              maxLength={LINE_BROADCAST_TEXT_MAX}
              value={testTextBody}
              onChange={(event) => setTestTextBody(event.target.value)}
              placeholder="BeautyOS TEST 2"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const result = await setLineTestPushEnabledAction({
                      organizationId: organization.id,
                      enabled: !account?.testPushEnabled,
                    });
                    if (!result.ok) setError(result.message);
                    else setMessage(result.message);
                    reload(false);
                  });
                }}
              >
                {account?.testPushEnabled ? "關閉店長測試開關" : "開啟店長測試開關"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                data-line-test-runtime-switch
                onClick={() => {
                  startTransition(async () => {
                    const result = await setLineTestPushRuntimeOpenAction({
                      organizationId: organization.id,
                      open: !account?.testPushRuntimeOpen,
                    });
                    if (!result.ok) setError(result.message);
                    else setMessage(result.message);
                    reload(false);
                  });
                }}
              >
                {account?.testPushRuntimeOpen ? "關閉伺服器總開關" : "開啟伺服器總開關"}
              </Button>
            </div>
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
              disabled={pending || !testAck}
              onClick={() => {
                setError("");
                startTransition(async () => {
                  const result = await sendLineTestPushAction({
                    organizationId: organization.id,
                    textBody: testTextBody,
                    requestId: testRequestId,
                    acknowledged: testAck,
                  });
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
          </div>
          <div className="space-y-3" data-line-test-history>
            <h3 className="text-sm font-medium text-text">測試發送紀錄</h3>
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
          </div>
        </Card>
      ) : null}

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
