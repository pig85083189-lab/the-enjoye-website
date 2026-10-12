import { lineBroadcastMonthlyQuotaLines } from "@/lib/line/line-broadcast-center-ui";
import { lineOfficialQuotaOwnerMessage } from "@/lib/line/line-visibility";
import type { LineQuotaPublic } from "@/lib/line/line-types";

export function LineBroadcastConfirmQuota({
  quota,
  sendOpen,
}: {
  quota: LineQuotaPublic;
  sendOpen: boolean;
}) {
  const lines = lineBroadcastMonthlyQuotaLines(quota);

  return (
    <div data-line-confirm-quota className="space-y-1 rounded-2xl border border-border px-4 py-3 text-sm">
      <p className="font-medium text-text">本月可用額度與用量</p>
      <p className="text-secondary-text">上限 {lines.limit} · 已使用 {lines.usage} · 剩餘 {lines.remaining}</p>
      <p className="text-[12px] text-secondary-text">{lineOfficialQuotaOwnerMessage(quota, sendOpen)}</p>
    </div>
  );
}
