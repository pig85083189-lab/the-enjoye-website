"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  saveLineOfficialAccountAction,
  setLineBroadcastEnabledAction,
  testLineOfficialAccountAction,
  loadLineOfficialAccountAction,
} from "@/lib/line/actions";
import {
  LINE_SETTINGS_LOAD_ERROR,
  LINE_SETTINGS_SAVE_ERROR,
  LINE_SETTINGS_TEST_ERROR,
  LINE_SETTINGS_UNEXPECTED_ERROR,
  applyLineSettingsLoadResult,
  applyLineSettingsSaveResult,
  describeLineSettingsStatus,
  lineActionCaughtError,
  type LineActionFeedback,
  type LineSettingsLoadState,
} from "@/lib/line/line-settings-status";
import { canShowLineSettings } from "@/lib/line/line-visibility";
import type { LineOfficialAccountPublic } from "@/lib/line/line-types";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

const fieldClass =
  "min-h-11 w-full min-w-0 rounded-2xl border border-border bg-surface px-4 text-[15px] text-text outline-none ring-primary/30 focus-visible:ring-2";

function Feedback({
  feedback,
  testId,
}: {
  feedback: LineActionFeedback;
  testId: string;
}) {
  if (feedback.kind === "idle" || !feedback.message) return null;
  return (
    <p
      data-line-settings-feedback={testId}
      role={feedback.kind === "error" ? "alert" : "status"}
      className={
        feedback.kind === "error"
          ? "text-[13px] text-danger"
          : "text-[13px] text-[#5C7F66]"
      }
    >
      {feedback.message}
    </p>
  );
}

export function LineOfficialAccountSettings({
  connectionPilotEnabled,
}: {
  connectionPilotEnabled: boolean;
}) {
  const { organization, membership } = useOrganization();
  const [account, setAccount] = useState<LineOfficialAccountPublic | null>(null);
  const [loadState, setLoadState] = useState<LineSettingsLoadState>(
    connectionPilotEnabled ? "loading" : "idle",
  );
  const [channelId, setChannelId] = useState("");
  const [channelSecret, setChannelSecret] = useState("");
  const [channelAccessToken, setChannelAccessToken] = useState("");
  const [credentialFeedback, setCredentialFeedback] = useState<LineActionFeedback>({
    kind: "idle",
    message: "",
  });
  const [broadcastFeedback, setBroadcastFeedback] = useState<LineActionFeedback>({
    kind: "idle",
    message: "",
  });
  const [busy, setBusy] = useState(false);
  const generationRef = useRef(0);

  const allowed = canShowLineSettings(membership);
  const status = useMemo(
    () => describeLineSettingsStatus({ loadState, account }),
    [loadState, account],
  );

  useEffect(() => {
    if (!allowed || !connectionPilotEnabled) return;
    const generation = ++generationRef.current;
    void (async () => {
      try {
        setLoadState("loading");
        const loaded = await loadLineOfficialAccountAction(organization.id);
        const next = applyLineSettingsLoadResult({
          generation,
          currentGeneration: generationRef.current,
          ok: loaded.ok,
          account: loaded.ok ? loaded.data ?? null : null,
        });
        if (next.ignored) return;
        setLoadState(next.loadState);
        setAccount(next.account);
        if (next.account?.channelId) setChannelId(next.account.channelId);
        if (next.feedback.kind !== "idle") setCredentialFeedback(next.feedback);
      } catch {
        if (generation !== generationRef.current) return;
        setLoadState("load_failed");
        setCredentialFeedback(lineActionCaughtError(LINE_SETTINGS_LOAD_ERROR));
      }
    })();
  }, [allowed, connectionPilotEnabled, organization.id]);

  if (!allowed) {
    return (
      <Card data-line-settings-denied padding="lg">
        <p className="text-[16px] font-semibold text-text">只有店長可以管理 LINE</p>
        <p className="mt-2 text-sm text-secondary-text">
          LINE 官方帳號與群發使用現有員工角色，不會另外建立權限系統。
        </p>
      </Card>
    );
  }

  return (
    <div data-line-official-account-settings className="space-y-4">
      <header className="space-y-1">
        <p className="text-[11px] tracking-[0.18em] text-secondary-text">Beauty OS</p>
        <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
          LINE 官方帳號
        </h1>
        <p className="text-sm text-secondary-text">
          為 {organization.name} 連接 Messaging API。憑證只存在伺服器，不會進入瀏覽器 Bundle。
        </p>
        <Link href="/staff/settings" className="text-sm text-primary">
          返回設定
        </Link>
      </header>

      {!connectionPilotEnabled ? (
        <Card padding="lg">
          <p className="text-sm text-secondary-text">LINE 串接尚未在此環境啟用。</p>
        </Card>
      ) : (
        <>
          <Card padding="lg" className="space-y-4">
            <div>
              <h2 className="text-[16px] font-semibold text-text">Messaging API 憑證</h2>
              <p className="mt-1 text-[13px] text-secondary-text">
                Channel Secret 與 Access Token 會先加密再寫入資料庫。一般查詢看不到明文。
              </p>
            </div>
            <div
              data-line-settings-status={status.credentialState}
              data-line-settings-load={status.loadState}
              className="rounded-2xl bg-primary-light/50 px-4 py-3"
            >
              <p className="text-sm font-medium text-text">{status.statusLabel}</p>
              <p className="mt-1 text-[13px] text-secondary-text">
                Channel ID：{status.channelIdLabel} · {status.secretLabel} · {status.tokenLabel}
              </p>
            </div>
            <label className="block text-sm font-medium text-text">
              Channel ID
              <input
                className={`${fieldClass} mt-2`}
                value={channelId}
                onChange={(event) => setChannelId(event.target.value)}
                autoComplete="off"
                disabled={busy || loadState === "loading"}
              />
            </label>
            <label className="block text-sm font-medium text-text">
              Channel Secret
              <input
                className={`${fieldClass} mt-2`}
                type="password"
                value={channelSecret}
                onChange={(event) => setChannelSecret(event.target.value)}
                placeholder={
                  account?.secretConfigured ? "已保存，重新輸入即可覆蓋" : "請貼上 Channel Secret"
                }
                autoComplete="new-password"
                disabled={busy || loadState === "loading"}
              />
            </label>
            <label className="block text-sm font-medium text-text">
              Channel Access Token
              <input
                className={`${fieldClass} mt-2`}
                type="password"
                value={channelAccessToken}
                onChange={(event) => setChannelAccessToken(event.target.value)}
                placeholder={
                  account?.tokenHint
                    ? `已保存 ${account.tokenHint}`
                    : "請貼上 Channel Access Token"
                }
                autoComplete="new-password"
                disabled={busy || loadState === "loading"}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy || loadState === "loading"}
                onClick={() => {
                  const generation = ++generationRef.current;
                  setBusy(true);
                  setCredentialFeedback({ kind: "idle", message: "" });
                  void (async () => {
                    try {
                      const result = await saveLineOfficialAccountAction({
                        organizationId: organization.id,
                        channelId,
                        channelSecret,
                        channelAccessToken,
                      });
                      const next = applyLineSettingsSaveResult({
                        generation,
                        currentGeneration: generationRef.current,
                        ok: result.ok,
                        message: result.ok ? result.message : result.message,
                        account: result.ok ? result.data ?? null : null,
                      });
                      if (next.ignored) return;
                      setLoadState(next.loadState);
                      if (next.account) {
                        setAccount(next.account);
                        if (next.account.channelId) setChannelId(next.account.channelId);
                      }
                      if (next.clearSecrets) {
                        setChannelSecret("");
                        setChannelAccessToken("");
                      }
                      setCredentialFeedback(next.feedback);
                    } catch {
                      if (generation !== generationRef.current) return;
                      setCredentialFeedback(lineActionCaughtError(LINE_SETTINGS_SAVE_ERROR));
                    } finally {
                      if (generation === generationRef.current) setBusy(false);
                    }
                  })();
                }}
              >
                加密保存
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || loadState === "loading"}
                onClick={() => {
                  const generation = ++generationRef.current;
                  setBusy(true);
                  setCredentialFeedback({ kind: "idle", message: "" });
                  void (async () => {
                    try {
                      const result = await testLineOfficialAccountAction({
                        organizationId: organization.id,
                      });
                      if (generation !== generationRef.current) return;
                      setCredentialFeedback(
                        result.ok
                          ? { kind: "success", message: result.message }
                          : { kind: "error", message: result.message },
                      );
                    } catch {
                      if (generation !== generationRef.current) return;
                      setCredentialFeedback(lineActionCaughtError(LINE_SETTINGS_TEST_ERROR));
                    } finally {
                      if (generation === generationRef.current) setBusy(false);
                    }
                  })();
                }}
              >
                測試連線（不發送訊息）
              </Button>
            </div>
            <Feedback feedback={credentialFeedback} testId="credentials" />
            {account?.lastTestStatus ? (
              <p className="text-[13px] text-secondary-text">
                上次測試：{account.lastTestStatus}
                {account.botDisplayName ? ` · ${account.botDisplayName}` : ""}
              </p>
            ) : null}
          </Card>

          <Card padding="lg" className="space-y-3">
            <h2 className="text-[16px] font-semibold text-text">群發開關</h2>
            <p className="text-[13px] text-secondary-text">
              即使店長開啟，真實發送仍須伺服器開關。預設關閉，不會向好友發送，也不顯示好友數。
            </p>
            <p className="text-sm text-text">
              目前狀態：{account?.broadcastEnabled ? "店長已啟用（實際發送仍關閉）" : "已關閉"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || loadState === "loading"}
                onClick={() => {
                  const generation = ++generationRef.current;
                  setBusy(true);
                  setBroadcastFeedback({ kind: "idle", message: "" });
                  void (async () => {
                    try {
                      const result = await setLineBroadcastEnabledAction({
                        organizationId: organization.id,
                        enabled: !account?.broadcastEnabled,
                      });
                      if (generation !== generationRef.current) return;
                      setBroadcastFeedback(
                        result.ok
                          ? { kind: "success", message: result.message }
                          : { kind: "error", message: result.message },
                      );
                      if (result.ok) {
                        setAccount((current) =>
                          current
                            ? { ...current, broadcastEnabled: !current.broadcastEnabled }
                            : current,
                        );
                      }
                    } catch {
                      if (generation !== generationRef.current) return;
                      setBroadcastFeedback(lineActionCaughtError(LINE_SETTINGS_UNEXPECTED_ERROR));
                    } finally {
                      if (generation === generationRef.current) setBusy(false);
                    }
                  })();
                }}
              >
                {account?.broadcastEnabled ? "關閉群發" : "店長啟用群發"}
              </Button>
              <Link href="/staff/line" className="inline-flex min-h-11 items-center text-sm text-primary">
                前往群發中心
              </Link>
            </div>
            <Feedback feedback={broadcastFeedback} testId="broadcast" />
          </Card>
        </>
      )}
    </div>
  );
}
