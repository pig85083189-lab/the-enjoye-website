"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { loadLineCustomerBindings } from "@/lib/line/automations/customer-binding-actions";
import { hasPendingCustomerRebind, isTrustedCustomerBinding, type LineCustomerBindingRow } from "@/lib/line/automations/customer-bindings";

export function CustomerLineBindingCard({ customerId, organizationId }: { customerId: string; organizationId: string }) {
  const [row, setRow] = useState<LineCustomerBindingRow | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    setRow(null);
    setStatus("loading");
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

  const binding = row?.binding;
  const trusted = status === "ready" && isTrustedCustomerBinding(binding);
  const label = status === "loading" ? "讀取中" :
    status === "unavailable" ? "無法確認" :
    trusted ? "已綁定" :
    hasPendingCustomerRebind(binding) ? "重新綁定中" :
    binding?.status === "pending" ? "待確認" : "尚未綁定";

  return (
    <Card padding="md" data-customer-line-binding-card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-text">LINE 會員綁定</h3>
        <span className="rounded-full bg-[#F5F0EE] px-3 py-1 text-xs font-medium text-secondary-text">{label}</span>
      </div>
      <p className="text-sm text-secondary-text">
        完成 LINE 身分驗證與店長確認後，會員中心才能依授權顯示顧客自己的預約紀錄。
      </p>
      {trusted ? (
        <p className="text-sm text-text">已完成驗證{binding?.hint ? ` · LINE 識別提示 ${binding.hint}` : ""}。此處不顯示 LINE User ID。</p>
      ) : (
        <div className="rounded-xl border border-border/70 bg-[#FBF8F7] px-4 py-3">
          <p className="text-sm font-medium text-text">{status === "unavailable" ? "無法確認綁定狀態" : "安全綁定操作尚未開放"}</p>
          <p className="mt-1 text-xs leading-relaxed text-secondary-text">
            {status === "unavailable"
              ? "目前無法安全讀取綁定資料，請確認登入身分及測試環境設定。"
              : "綁定碼必須由已授權的店長產生，並透過官方 LINE 驗證及再次確認。此頁目前僅讀取真實狀態，不會建立或解除綁定。"}
          </p>
        </div>
      )}
      <Link href="/staff/settings/line" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
        查看 LINE 官方帳號設定
      </Link>
    </Card>
  );
}
