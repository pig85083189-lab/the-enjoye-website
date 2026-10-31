"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";

/**
 * Customer-level entry point. The existing owner-only LINE binding RPC flow
 * must be enabled only after a Preview deployment is connected to test data.
 * This component intentionally has no mutation handler or client-side secret.
 */
export function CustomerLineBindingCard() {
  return (
    <Card padding="md" data-customer-line-binding-card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-text">LINE 會員綁定</h3>
        <span className="rounded-full bg-[#F5F0EE] px-3 py-1 text-xs font-medium text-secondary-text">
          待驗證
        </span>
      </div>
      <p className="text-sm text-secondary-text">
        綁定後，顧客可透過 LINE 登入會員中心並查看自己的預約紀錄。
      </p>
      <div className="rounded-xl border border-border/70 bg-[#FBF8F7] px-4 py-3">
        <p className="text-sm font-medium text-text">安全綁定尚未開放</p>
        <p className="mt-1 text-xs leading-relaxed text-secondary-text">
          綁定碼必須由已授權的店長產生，並透過官方 LINE 驗證及再次確認。
          測試資料庫與 Preview 權限驗收完成前，不會在此頁建立或解除綁定。
        </p>
      </div>
      <Link
        href="/staff/settings/line"
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        查看 LINE 官方帳號設定
      </Link>
    </Card>
  );
}
