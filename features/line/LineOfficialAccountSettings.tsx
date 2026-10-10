"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  saveLineOfficialAccountAction,
  setLineBroadcastEnabledAction,
  testLineOfficialAccountAction,
  loadLineOfficialAccountAction,
} from "@/lib/line/actions";
import { canShowLineSettings } from "@/lib/line/line-visibility";
import type { LineOfficialAccountPublic } from "@/lib/line/line-types";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

const fieldClass =
  "min-h-11 w-full min-w-0 rounded-2xl border border-border bg-surface px-4 text-[15px] text-text outline-none ring-primary/30 focus-visible:ring-2";

export function LineOfficialAccountSettings({
  connectionPilotEnabled,
}: {
  connectionPilotEnabled: boolean;
}) {
  const { organization, membership } = useOrganization();
  const [account, setAccount] = useState<LineOfficialAccountPublic | null>(null);
  const [channelId, setChannelId] = useState("");
  const [channelSecret, setChannelSecret] = useState("");
  const [channelAccessToken, setChannelAccessToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const allowed = canShowLineSettings(membership);

  useEffect(() => {
    if (!allowed || !connectionPilotEnabled) return;
    startTransition(async () => {
      const loaded = await loadLineOfficialAccountAction(organization.id);
      if (loaded.ok) {
        setAccount(loaded.data ?? null);
        setChannelId(loaded.data?.channelId ?? "");
      }
    });
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

  function refresh() {
    startTransition(async () => {
      const loaded = await loadLineOfficialAccountAction(organization.id);
      if (loaded.ok) setAccount(loaded.data ?? null);
    });
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
            <label className="block text-sm font-medium text-text">
              Channel ID
              <input
                className={`${fieldClass} mt-2`}
                value={channelId}
                onChange={(event) => setChannelId(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="block text-sm font-medium text-text">
              Channel Secret
              <input
                className={`${fieldClass} mt-2`}
                type="password"
                value={channelSecret}
                onChange={(event) => setChannelSecret(event.target.value)}
                placeholder={account?.secretConfigured ? "已保存，重新輸入即可覆蓋" : "請貼上 Channel Secret"}
                autoComplete="new-password"
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
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={pending}
                onClick={() => {
                  setError("");
                  setMessage("");
                  startTransition(async () => {
                    const result = await saveLineOfficialAccountAction({
                      organizationId: organization.id,
                      channelId,
                      channelSecret,
                      channelAccessToken,
                    });
                    if (result.ok) {
                      setMessage(result.message);
                      setChannelSecret("");
                      setChannelAccessToken("");
                      refresh();
                    } else {
                      setError(result.message);
                    }
                  });
                }}
              >
                加密保存
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setError("");
                  setMessage("");
                  startTransition(async () => {
                    const result = await testLineOfficialAccountAction({
                      organizationId: organization.id,
                    });
                    if (result.ok) {
                      setMessage(result.message);
                      refresh();
                    } else {
                      setError(result.message);
                    }
                  });
                }}
              >
                測試連線（不發送訊息）
              </Button>
            </div>
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
              即使店長開啟，Phase 1 仍不會實際呼叫 LINE Broadcast。系統不會顯示好友數或會員分群。
            </p>
            <p className="text-sm text-text">
              目前狀態：{account?.broadcastEnabled ? "店長已啟用（實際發送仍關閉）" : "已關閉"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const result = await setLineBroadcastEnabledAction({
                      organizationId: organization.id,
                      enabled: !account?.broadcastEnabled,
                    });
                    if (result.ok) {
                      setMessage(result.message);
                      refresh();
                    } else {
                      setError(result.message);
                    }
                  });
                }}
              >
                {account?.broadcastEnabled ? "關閉群發" : "店長啟用群發"}
              </Button>
              <Link href="/staff/line" className="inline-flex min-h-11 items-center text-sm text-primary">
                前往群發中心
              </Link>
            </div>
          </Card>
        </>
      )}

      {message ? <p className="text-[13px] text-[#5C7F66]">{message}</p> : null}
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
