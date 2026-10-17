"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  ensureLineWebhookPublicUrlAction,
  loadLineBroadcastPrepareAction,
  loadLineOfficialAccountAction,
  probeLineOneshotReadOnlyAction,
  rotateLineWebhookPublicTokenAction,
  saveLineOfficialAccountAction,
  setLineBroadcastEnabledAction,
  setLineTestPushEnabledAction,
  setLineTestPushRuntimeOpenAction,
  startLineOwnerBindAction,
  testLineOfficialAccountAction,
  unbindLineOwnerRecipientAction,
} from "@/lib/line/actions";
import {
  LINE_SETTINGS_LOAD_ERROR,
  LINE_SETTINGS_PROBE_ERROR,
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
import {
  LINE_ONESHOT_PROBE_FRIEND_COUNT_LABEL,
  LINE_ONESHOT_PROBE_UNCONFIRMED_LABEL,
  LINE_ONESHOT_PROBE_WRONG_ORG_HINT,
  canOfferLineOneshotProbeOrganizationSwitch,
  canShowLineEngineerDiagnostics,
  canShowLineSettings,
  lineOneshotProbeSettingsVisibility,
  lineOneshotProbeQuotaLimitLabel,
  lineOneshotProbeQuotaRemainingLabel,
  lineOneshotProbeQuotaUsageLabel,
  lineOneshotProbeText,
  lineOwnerRecipientLabel,
} from "@/lib/line/line-visibility";
import type {
  LineOfficialAccountPublic,
  LineOneshotReadOnlyProbePublic,
  LineOwnerRecipientPublic,
  LineWebhookPublicUrl,
} from "@/lib/line/line-types";
import { LineEnjoyeOwnerBindPrepCard } from "@/features/line/LineEnjoyeOwnerBindPrepCard";
import { canShowEnjoyeOwnerBindPrep } from "@/lib/line/enjoye-owner-bind-prep";
import { ORG_BEAUTY_OS_TEST_ID } from "@/lib/tenant/constants";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

const fieldClass =
  "min-h-11 w-full min-w-0 rounded-2xl border border-border bg-surface px-4 text-[15px] text-text outline-none ring-primary/30 focus-visible:ring-2";

function formatLineOneshotProbeCheckedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return LINE_ONESHOT_PROBE_UNCONFIRMED_LABEL;
  return date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

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
  const { organization, organizations, membership, switchOrganization } =
    useOrganization();
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
  const [bindFeedback, setBindFeedback] = useState<LineActionFeedback>({
    kind: "idle",
    message: "",
  });
  const [recipient, setRecipient] = useState<LineOwnerRecipientPublic | null>(null);
  const [webhook, setWebhook] = useState<LineWebhookPublicUrl | null>(null);
  const [bindCode, setBindCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [oneshotProbe, setOneshotProbe] = useState<LineOneshotReadOnlyProbePublic | null>(
    null,
  );
  const [probeFeedback, setProbeFeedback] = useState<LineActionFeedback>({
    kind: "idle",
    message: "",
  });
  const generationRef = useRef(0);

  const allowed = canShowLineSettings(membership);
  const engineer = canShowLineEngineerDiagnostics(organization.id);
  const oneshotProbeVisible = lineOneshotProbeSettingsVisibility({
    organizationId: organization.id,
  });
  const offerProbeOrgSwitch = canOfferLineOneshotProbeOrganizationSwitch({
    currentOrganizationId: organization.id,
    accessibleOrganizationIds: organizations.map((org) => org.id),
  });
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
        if (canShowLineEngineerDiagnostics(organization.id)) {
          const prepared = await loadLineBroadcastPrepareAction(organization.id);
          if (generation === generationRef.current && prepared.ok && prepared.data) {
            setRecipient(prepared.data.recipient ?? null);
            setWebhook(prepared.data.webhook ?? null);
            if (prepared.data.account) setAccount(prepared.data.account);
          }
          if (
            generation === generationRef.current &&
            loaded.ok &&
            loaded.data?.secretConfigured &&
            !(prepared.ok && prepared.data?.webhook)
          ) {
            const ensured = await ensureLineWebhookPublicUrlAction({
              organizationId: organization.id,
            });
            if (generation === generationRef.current && ensured.ok && ensured.data) {
              setWebhook(ensured.data);
            }
          }
        }
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
          LINE 設定
        </h1>
        <p
          data-line-settings-organization={organization.id}
          className="text-sm text-secondary-text"
        >
          目前組織：{organization.name}。第一次填入 Channel ID 與 Channel Access Token。憑證只存在伺服器，畫面不會再顯示明文。
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
                必要的串接資訊會先加密再寫入資料庫。已保存後不必每次重填。
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
                      if (
                        next.account?.secretConfigured &&
                        canShowLineEngineerDiagnostics(organization.id)
                      ) {
                        const ensured = await ensureLineWebhookPublicUrlAction({
                          organizationId: organization.id,
                        });
                        if (generation === generationRef.current && ensured.ok && ensured.data) {
                          setWebhook(ensured.data);
                        }
                      }
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
            <h2 className="text-[16px] font-semibold text-text">群發準備</h2>
            <p className="text-[13px] text-secondary-text">
              店長啟用後，仍須伺服器開放才會真正發送。目前實際發送維持關閉，也不估計好友數。
            </p>
            <p className="text-sm text-text">
              目前狀態：{account?.broadcastEnabled ? "已啟用（實際發送尚未開放）" : "尚未啟用"}
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
                前往建立群發
              </Link>
            </div>
            <Feedback feedback={broadcastFeedback} testId="broadcast" />
          </Card>

          {offerProbeOrgSwitch ? (
            <Card data-line-oneshot-probe-org-hint padding="lg" className="space-y-3">
              <h2 className="text-[16px] font-semibold text-text">檢查 LINE 連線與額度</h2>
              <p className="text-[13px] text-secondary-text">{LINE_ONESHOT_PROBE_WRONG_ORG_HINT}</p>
              <p className="text-sm text-text">目前組織：{organization.name}</p>
              <Button
                type="button"
                variant="outline"
                data-line-oneshot-probe-org-switch
                disabled={busy}
                onClick={() => {
                  switchOrganization(ORG_BEAUTY_OS_TEST_ID);
                }}
              >
                切換到 Beauty OS TEST
              </Button>
            </Card>
          ) : null}

          {oneshotProbeVisible ? (
            <Card data-line-oneshot-probe padding="lg" className="space-y-3">
              <h2 className="text-[16px] font-semibold text-text">檢查 LINE 連線與額度</h2>
              <p className="text-[13px] text-secondary-text">
                只讀取官方帳號身分與月訊息額度。不會發送訊息、不會寫入資料，也不依賴發送開關。
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={busy || loadState === "loading"}
                data-line-oneshot-probe-submit
                onClick={() => {
                  const generation = ++generationRef.current;
                  setBusy(true);
                  setProbeFeedback({ kind: "idle", message: "" });
                  void (async () => {
                    try {
                      const result = await probeLineOneshotReadOnlyAction({
                        organizationId: organization.id,
                      });
                      if (generation !== generationRef.current) return;
                      if (result.data) setOneshotProbe(result.data);
                      setProbeFeedback(
                        result.ok
                          ? { kind: "success", message: result.message }
                          : { kind: "error", message: result.message },
                      );
                    } catch {
                      if (generation !== generationRef.current) return;
                      setProbeFeedback(lineActionCaughtError(LINE_SETTINGS_PROBE_ERROR));
                    } finally {
                      if (generation === generationRef.current) setBusy(false);
                    }
                  })();
                }}
              >
                檢查 LINE 連線與額度
              </Button>
              {oneshotProbe ? (
                <dl
                  data-line-oneshot-probe-result={oneshotProbe.connected ? "ok" : "failed"}
                  className="space-y-1 text-sm text-text"
                >
                  <div>LINE 連線：{oneshotProbe.connected ? "成功" : "失敗"}</div>
                  <div>官方帳號名稱：{lineOneshotProbeText(oneshotProbe.displayName)}</div>
                  <div>Basic ID：{lineOneshotProbeText(oneshotProbe.basicId)}</div>
                  <div>Channel ID：{lineOneshotProbeText(oneshotProbe.channelId)}</div>
                  <div>月訊息額度：{lineOneshotProbeQuotaLimitLabel(oneshotProbe.quota)}</div>
                  <div>已使用訊息數：{lineOneshotProbeQuotaUsageLabel(oneshotProbe.quota)}</div>
                  <div>
                    剩餘額度：{lineOneshotProbeQuotaRemainingLabel(oneshotProbe.quota)}
                  </div>
                  <div>好友人數：{LINE_ONESHOT_PROBE_FRIEND_COUNT_LABEL}</div>
                  <div>
                    最後檢查時間：{formatLineOneshotProbeCheckedAt(oneshotProbe.checkedAt)}
                  </div>
                </dl>
              ) : null}
              <Feedback feedback={probeFeedback} testId="oneshot-probe" />
            </Card>
          ) : null}

          {canShowEnjoyeOwnerBindPrep({
            organizationId: organization.id,
            staffUserId: membership?.userId,
            role: membership?.role,
            isActive: membership?.isActive,
          }) ? (
            <LineEnjoyeOwnerBindPrepCard
              actor={{
                organizationId: organization.id,
                staffUserId: membership?.userId,
                role: membership?.role,
                isActive: membership?.isActive,
              }}
              channelId={account?.channelId ?? null}
            />
          ) : null}

          {engineer ? (
          <Card data-line-owner-bind data-line-engineer-diagnostics padding="lg" className="space-y-3">
            <h2 className="text-[16px] font-semibold text-text">工程師診斷</h2>
            <p className="text-[13px] text-secondary-text">
              店長用自己的 LINE 把驗證碼傳給本官方帳號。系統用 Webhook 簽章確認身分，不能手填
              User ID，也不能使用 Developers Console 的管理者 ID。
            </p>
            <div data-line-webhook-url className="space-y-2">
              <p className="text-sm font-medium text-text">專用測試官方帳號 Webhook URL</p>
              <p className="text-[13px] text-secondary-text">
                只填到<strong>新的測試官方帳號</strong>。禁止改 THE ENJOYE 既有 Webhook，也禁止覆蓋已保存的
                THE ENJOYE 憑證。專用 webhook 主機核准後，此 URL 不會指向 Staff Preview 網域。
              </p>
              <input
                className={`${fieldClass} font-mono text-[12px]`}
                readOnly
                value={webhook?.url ?? "請先保存 Channel Secret，系統會產生 URL"}
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !webhook?.url}
                  onClick={() => {
                    if (!webhook?.url) return;
                    void navigator.clipboard.writeText(webhook.url).then(
                      () =>
                        setBindFeedback({
                          kind: "success",
                          message: "已複製 Webhook URL。請只貼到專用測試官方帳號。",
                        }),
                      () =>
                        setBindFeedback({
                          kind: "error",
                          message: "無法複製，請手動選取 URL。",
                        }),
                    );
                  }}
                >
                  複製 Webhook URL
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || loadState === "loading"}
                  onClick={() => {
                    const generation = ++generationRef.current;
                    setBusy(true);
                    void (async () => {
                      try {
                        const result = await rotateLineWebhookPublicTokenAction({
                          organizationId: organization.id,
                        });
                        if (generation !== generationRef.current) return;
                        setBindFeedback(
                          result.ok
                            ? { kind: "success", message: result.message }
                            : { kind: "error", message: result.message },
                        );
                        if (result.ok && result.data) setWebhook(result.data);
                      } catch {
                        if (generation !== generationRef.current) return;
                        setBindFeedback(lineActionCaughtError(LINE_SETTINGS_UNEXPECTED_ERROR));
                      } finally {
                        if (generation === generationRef.current) setBusy(false);
                      }
                    })();
                  }}
                >
                  輪替 URL
                </Button>
              </div>
            </div>
            <p className="text-sm text-text" data-line-owner-bind-status>
              {lineOwnerRecipientLabel(recipient)}
            </p>
            {bindCode ? (
              <p className="rounded-2xl bg-primary-light/50 px-4 py-3 font-mono text-[18px] tracking-[0.2em]">
                {bindCode}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || loadState === "loading"}
                onClick={() => {
                  const generation = ++generationRef.current;
                  setBusy(true);
                  setBindFeedback({ kind: "idle", message: "" });
                  void (async () => {
                    try {
                      const result = await startLineOwnerBindAction({
                        organizationId: organization.id,
                      });
                      if (generation !== generationRef.current) return;
                      setBindFeedback(
                        result.ok
                          ? { kind: "success", message: result.message }
                          : { kind: "error", message: result.message },
                      );
                      if (result.ok && result.data) setBindCode(result.data.code);
                    } catch {
                      if (generation !== generationRef.current) return;
                      setBindFeedback(lineActionCaughtError(LINE_SETTINGS_UNEXPECTED_ERROR));
                    } finally {
                      if (generation === generationRef.current) setBusy(false);
                    }
                  })();
                }}
              >
                產生驗證碼
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || !recipient?.bound}
                onClick={() => {
                  const generation = ++generationRef.current;
                  setBusy(true);
                  void (async () => {
                    try {
                      const result = await unbindLineOwnerRecipientAction({
                        organizationId: organization.id,
                      });
                      if (generation !== generationRef.current) return;
                      setBindFeedback(
                        result.ok
                          ? { kind: "success", message: result.message }
                          : { kind: "error", message: result.message },
                      );
                      if (result.ok) {
                        setRecipient(null);
                        setBindCode("");
                      }
                    } catch {
                      if (generation !== generationRef.current) return;
                      setBindFeedback(lineActionCaughtError(LINE_SETTINGS_UNEXPECTED_ERROR));
                    } finally {
                      if (generation === generationRef.current) setBusy(false);
                    }
                  })();
                }}
              >
                解除綁定
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const generation = ++generationRef.current;
                  setBusy(true);
                  void (async () => {
                    try {
                      const result = await setLineTestPushEnabledAction({
                        organizationId: organization.id,
                        enabled: !account?.testPushEnabled,
                      });
                      if (generation !== generationRef.current) return;
                      setBindFeedback(
                        result.ok
                          ? { kind: "success", message: result.message }
                          : { kind: "error", message: result.message },
                      );
                      if (result.ok) {
                        setAccount((current) =>
                          current
                            ? { ...current, testPushEnabled: !current.testPushEnabled }
                            : current,
                        );
                      }
                    } catch {
                      if (generation !== generationRef.current) return;
                      setBindFeedback(lineActionCaughtError(LINE_SETTINGS_UNEXPECTED_ERROR));
                    } finally {
                      if (generation === generationRef.current) setBusy(false);
                    }
                  })();
                }}
              >
                {account?.testPushEnabled ? "關閉測試發送" : "店長啟用測試發送"}
              </Button>
              {engineer ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  data-line-test-runtime-switch
                  onClick={() => {
                    const generation = ++generationRef.current;
                    setBusy(true);
                    void (async () => {
                      try {
                        const result = await setLineTestPushRuntimeOpenAction({
                          organizationId: organization.id,
                          open: !account?.testPushRuntimeOpen,
                        });
                        if (generation !== generationRef.current) return;
                        setBindFeedback(
                          result.ok
                            ? { kind: "success", message: result.message }
                            : { kind: "error", message: result.message },
                        );
                        if (result.ok) {
                          setAccount((current) =>
                            current
                              ? {
                                  ...current,
                                  testPushRuntimeOpen: !current.testPushRuntimeOpen,
                                }
                              : current,
                          );
                        }
                      } catch {
                        if (generation !== generationRef.current) return;
                        setBindFeedback(lineActionCaughtError(LINE_SETTINGS_UNEXPECTED_ERROR));
                      } finally {
                        if (generation === generationRef.current) setBusy(false);
                      }
                    })();
                  }}
                >
                  {account?.testPushRuntimeOpen
                    ? "立即關閉測試發送總開關"
                    : "開啟測試發送總開關（預設關閉）"}
                </Button>
              ) : null}
            </div>
            <p className="text-[12px] text-secondary-text">
              測試發送開關與正式群發開關分開。兩者預設都關閉，不會呼叫 Push 或 Broadcast。
              Beauty OS TEST 的伺服器總開關可立即停止後續新發送，不需重新部署。
              已開始的 LINE HTTP 無法保證取消。
            </p>
            <Feedback feedback={bindFeedback} testId="bind" />
          </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
