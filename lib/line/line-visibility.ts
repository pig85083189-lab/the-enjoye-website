import { canManageLineOfficialAccount } from "@/lib/line/line-roles";
import type { LineBroadcastStatus } from "@/lib/line/line-types";
import type { StaffRole } from "@/types/saas";

export function canShowLineSettings(actor: {
  role?: StaffRole | string | null;
  isActive?: boolean;
} | null | undefined): boolean {
  return canManageLineOfficialAccount(actor);
}

export function lineBroadcastStatusLabel(status: LineBroadcastStatus): string {
  switch (status) {
    case "draft":
      return "草稿";
    case "confirm_pending":
      return "等待確認";
    case "send_closed":
      return "未發送（群發關閉）";
    case "queued":
      return "排隊中";
    case "sending":
      return "發送中";
    case "accepted":
      return "LINE API 已接受";
    case "failed":
      return "發送失敗";
    case "canceled":
      return "已取消";
    case "pending_confirmation":
      return "待確認（未重送）";
  }
}

export function lineBroadcastApiResultLabel(result: string | null): string {
  if (result === "accepted") return "API 已接受（不代表每位好友已收到）";
  if (result === "pending_confirmation") return "待確認，不會自動重送";
  if (result === "send_closed") return "系統未呼叫 LINE 發送";
  if (result === "failed") return "API 拒絕";
  return "尚未發送";
}

export function lineOfficialAccountNameLabel(
  account: { botDisplayName?: string | null } | null | undefined,
): string {
  const name = account?.botDisplayName?.trim();
  return name || "未知（尚未完成連線測試）";
}
