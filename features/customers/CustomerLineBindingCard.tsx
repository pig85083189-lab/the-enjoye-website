"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { loadLineCustomerBindings, startLineCustomerBindAction, confirmLineCustomerBindingAction } from "@/lib/line/automations/customer-binding-actions";
import { hasPendingCustomerRebind, isTrustedCustomerBinding, type LineCustomerBindingRow } from "@/lib/line/automations/customer-bindings";

export function CustomerLineBindingCard({ customerId, organizationId }: { customerId: string; organizationId: string }) {
  const [row, setRow] = useState<LineCustomerBindingRow | null>(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [showManualTools, setShowManualTools] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issuedCode, setIssuedCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    setRow(null);
    setStatus("loading");
    setIdentityConfirmed(false);
    setShowManualTools(false);
    setIssuedCode(null);
    setFeedback("");
    void loadLineCustomerBindings(organizationId).then((result) => {
      if (!active) return;
      if (!result.ok || !result.data) {
        setStatus("unavailable");
        return;
      }
      setRow(result.data.customers.find((item) => item.customerId === customerId) ?? null);
      setStatus("ready");
    }).catch(() => {
      if (active) setStatus("unavailable");
    });
    return () => { active = false; };
  }, [customerId, organizationId]);

  async function refresh() {
    const result = await loadLineCustomerBindings(organizationId);
    if (!result.ok || !result.data) { setStatus("unavailable"); return; }
    setRow(result.data.customers.find(item => item.customerId === customerId) ?? null);
    setStatus("ready");
  }

  async function startBinding() {
    if (!identityConfirmed || busy) return;
    setBusy(true); setFeedback(""); setIssuedCode(null);
    try {
      const result = await startLineCustomerBindAction({ organizationId, customerId, identityConfirmed: true });
      setFeedback(result.message);
      if (result.ok && result.data) setIssuedCode({ code: result.data.code, expiresAt: result.data.expiresAt });
      await refresh();
    } catch { setFeedback("無法建立綁定，請稍後再試。"); }
    finally { setBusy(false); }
  }

  async function confirmBinding() {
    if (busy || !identityConfirmed) return;
    setBusy(true); setFeedback("");
    try {
      const result = await confirmLineCustomerBindingAction({ organizationId, customerId });
      setFeedback(result.message);
      if (result.ok) { setIssuedCode(null); setIdentityConfirmed(false); }
      await refresh();
    } catch { setFeedback("無法確認綁定，請稍後再試。"); }
    finally { setBusy(false); }
  }

  const binding = row?.binding;
  const manualPending = binding?.status === "pending";
  const trusted = status === "ready" && isTrustedCustomerBinding(binding);
  const label = status === "loading" ? "讀取中" :
    status === "unavailable" ? "無法確認" :
    trusted ? "已綁定" :
    hasPendingCustomerRebind(binding) ? "重新綁定中" :
    binding?.status === "pending" ? "待確認" : "尚未綁定";

  return (
    <Card padding="md" data-customer-line-binding-card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-text">會員帳號連結</h3>
        <span className="rounded-full bg-[#F5F0EE] px-3 py-1 text-xs font-medium text-secondary-text">{label}</span>
      </div>
      <p className="text-sm text-secondary-text">
        LINE 登入即可使用會員中心，不需要額外輸入身分驗證碼。套票、儲值與療程紀錄僅會在 LINE 帳號已正確對應這筆店內顧客資料後顯示。
      </p>
      {trusted ? (
        <p className="text-sm text-text">已完成驗證{binding?.hint ? ` · LINE 識別提示 ${binding.hint}` : ""}。此處不顯示 LINE User ID。</p>
      ) : (
        <div className="rounded-xl border border-border/70 bg-[#FBF8F7] px-4 py-3">
          <p className="text-sm font-medium text-text">{status === "unavailable" ? "無法確認綁定狀態" : "尚未對應店內顧客資料"}</p>
          <p className="mt-1 text-xs leading-relaxed text-secondary-text">
            {status === "unavailable"
              ? "目前無法安全讀取綁定資料，請確認登入身分及測試環境設定。"
              : "LINE 登入本身不需要再驗證。若要讀取既有顧客的套票與儲值，仍需先確認 LINE 帳號與該顧客紀錄的對應關係，避免將帳務資料提供給其他人。"}
          </p>
        </div>
      )}
      {!trusted && status === "ready" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border/70 p-4 text-sm">
            <p className="font-medium text-text">{manualPending ? "人工驗證待完成" : "LINE 會員與店內顧客資料尚未連結"}</p>
            <p className="mt-1 text-secondary-text">{manualPending ? "目前有尚未完成的人工驗證流程。請由授權店長核對顧客身分與 LINE 驗證狀態；未確認前不得開放會員資料。" : "LINE 登入已可使用會員中心；尚未有可信連結時，不會依姓名或電話自動認領既有顧客的套票、儲值及療程資料。特殊情況可由店長使用下方工具處理。"}</p>
          </div>
          <button type="button" aria-expanded={showManualTools} onClick={() => setShowManualTools(value => !value)} className="text-sm font-medium text-primary underline-offset-4 hover:underline">{showManualTools ? "收起店長協助連結工具" : "特殊情況：開啟店長協助連結工具"}</button>
          {showManualTools && (
        <div className="space-y-3 rounded-xl border border-border/70 p-4">
          <label className="flex items-start gap-2 text-sm text-text">
            <input type="checkbox" checked={identityConfirmed} onChange={event => setIdentityConfirmed(event.target.checked)} className="mt-1" />
            <span>我是已授權店長，已當面核對這位顧客的身分，並確認顧客同意將其 LINE 帳號連結至此顧客紀錄。</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!identityConfirmed || busy} onClick={startBinding} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">產生 LINE 綁定驗證碼</button>
            <button type="button" disabled={!identityConfirmed || busy || (!issuedCode && binding?.status !== "pending")} onClick={confirmBinding} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">確認綁定</button>
          </div>
          {issuedCode && <div className="rounded-lg bg-[#FBF8F7] p-3 text-sm">
            <p>請顧客使用自己的 LINE 對官方帳號傳送以下一次性驗證碼：</p>
            <p className="my-2 font-mono text-xl font-semibold tracking-widest">{issuedCode.code}</p>
            <p className="text-xs text-secondary-text">有效期限：{issuedCode.expiresAt || "依系統設定"}。店長確認 LINE 收到驗證碼後，再按「確認綁定」。請勿要求顧客提供 LINE User ID。</p>
          </div>}
          {feedback && <p role="status" className="text-sm text-secondary-text">{feedback}</p>}
          <p className="text-xs text-secondary-text">所有操作都會經過伺服器端店長權限、LINE 官方帳號及安全綁定功能開關檢查。功能未開放時不會建立綁定。</p>
        </div>
          )}
        </div>
      )}
      {showManualTools && (
        <Link href="/staff/settings/line" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
          店家 LINE 官方帳號設定
        </Link>
      )}
    </Card>
  );
}
