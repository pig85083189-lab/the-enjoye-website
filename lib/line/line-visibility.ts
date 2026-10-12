import { canManageLineOfficialAccount } from "@/lib/line/line-roles";
import type { LineBroadcastStatus, LineQuotaPublic } from "@/lib/line/line-types";
import { ORG_BEAUTY_OS_TEST_ID } from "@/lib/tenant/constants";
import type { StaffRole } from "@/types/saas";

export const LINE_ONESHOT_PROBE_FRIEND_COUNT_LABEL = "尚未驗證";
export const LINE_ONESHOT_PROBE_UNCONFIRMED_LABEL = "無法確認";

export function canShowLineSettings(actor: {
  role?: StaffRole | string | null;
  isActive?: boolean;
} | null | undefined): boolean {
  return canManageLineOfficialAccount(actor);
}

/** Engineer-only LINE tools. Regular store owners never see this surface. */
export function canShowLineEngineerDiagnostics(
  organizationId?: string | null,
): boolean {
  return organizationId === ORG_BEAUTY_OS_TEST_ID;
}

/** Preview TEST Owner-only read-only LINE identity/quota card. */
export function canShowLineOneshotReadOnlyProbe(
  organizationId?: string | null,
): boolean {
  return canShowLineEngineerDiagnostics(organizationId);
}

export const LINE_ONESHOT_PROBE_WRONG_ORG_HINT =
  "檢查 LINE 連線與額度只在 Beauty OS TEST 顯示。請先切換組織。此檢查不依賴群發開關。";

/**
 * Settings-card visibility is organization-id only.
 * sendOpen / broadcast_enabled / oneshot / runtime / VERCEL_ENV must not hide the card.
 */
export function lineOneshotProbeSettingsVisibility(input: {
  organizationId?: string | null;
  broadcastEnabled?: boolean;
  sendOpen?: boolean;
  oneshotActive?: boolean;
  testPushRuntimeOpen?: boolean;
  broadcastTestRuntimeOpen?: boolean;
  vercelEnv?: string | null;
}): boolean {
  return canShowLineOneshotReadOnlyProbe(input.organizationId);
}

/** Offer a TEST switch only when the actor already has that organization. */
export function canOfferLineOneshotProbeOrganizationSwitch(input: {
  currentOrganizationId?: string | null;
  accessibleOrganizationIds?: readonly (string | null | undefined)[];
}): boolean {
  if (canShowLineOneshotReadOnlyProbe(input.currentOrganizationId)) return false;
  return (input.accessibleOrganizationIds ?? []).some((id) =>
    canShowLineOneshotReadOnlyProbe(id),
  );
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

export function lineBroadcastConfirmStatusHint(sendOpen: boolean): string {
  return sendOpen
    ? "送出後無法撤回，請確認訊息內容正確。"
    : "目前為預覽版本，尚未開放實際發送。";
}

export function lineBroadcastFormalStatusHint(input: {
  oneshotActive: boolean;
  formalActive: boolean;
  formalMessage?: string | null;
}): string {
  if (input.oneshotActive) {
    return "目前為 Beauty OS TEST 一次性測試路徑，不是日常正式群發。";
  }
  if (input.formalActive) {
    return "正式群發檢查已通過。LINE API 接受不代表每位好友都已收到。";
  }
  return input.formalMessage || "正式群發尚未開放。確認發送前必須通過店家、官方帳號與額度檢查。";
}

export function isLineBroadcastConfirmSubmitEnabled(input: {
  sendOpen: boolean;
  acknowledged: boolean;
  pending?: boolean;
  quotaBlocked?: boolean;
}): boolean {
  return (
    !input.pending &&
    input.sendOpen === true &&
    input.acknowledged === true &&
    input.quotaBlocked !== true
  );
}

export function lineOfficialQuotaOwnerMessage(
  quota: { known: boolean; type?: "none" | "limited" | null; remaining?: number | null; label: string },
  sendOpen: boolean,
): string {
  if (!sendOpen) return quota.label;
  if (!quota.known) return `無法確認 LINE 額度，已停止發送。${quota.label}`;
  if (quota.type === "limited" && (quota.remaining == null || quota.remaining <= 0)) {
    return `LINE 訊息額度不足，已停止發送。${quota.label}`;
  }
  return quota.label;
}

export function lineTestPushDisplayedError(message: string | null | undefined): string | null {
  const text = message?.trim() ?? "";
  if (!text) return null;
  if (text.includes("廣播")) return "LINE API 拒絕這則測試發送";
  return text;
}

export function lineTestPushDiagnosticLabel(row: {
  httpStatus?: number | null;
  errorClass?: string | null;
}): string | null {
  const parts: string[] = [];
  if (typeof row.httpStatus === "number") parts.push(`HTTP ${row.httpStatus}`);
  if (row.errorClass) parts.push(row.errorClass);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function lineOfficialAccountNameLabel(
  account: { botDisplayName?: string | null } | null | undefined,
): string {
  const name = account?.botDisplayName?.trim();
  return name || "未知（尚未完成連線測試）";
}

export function lineOwnerRecipientLabel(
  recipient: { bound?: boolean; hint?: string | null } | null | undefined,
): string {
  if (!recipient?.bound) return "尚未綁定店長 LINE";
  return `已綁定 ${recipient.hint || "••••"}`;
}

export function lineOneshotProbeText(value: string | number | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const trimmed = String(value ?? "").trim();
  return trimmed || LINE_ONESHOT_PROBE_UNCONFIRMED_LABEL;
}

export function lineOneshotProbeQuotaLimitLabel(quota: LineQuotaPublic): string {
  if (quota.type === "none") return "無上限";
  if (quota.type === "limited" && quota.limit != null) return String(quota.limit);
  return LINE_ONESHOT_PROBE_UNCONFIRMED_LABEL;
}

export function lineOneshotProbeQuotaUsageLabel(quota: LineQuotaPublic): string {
  return quota.usage == null ? LINE_ONESHOT_PROBE_UNCONFIRMED_LABEL : String(quota.usage);
}

export function lineOneshotProbeQuotaRemainingLabel(quota: LineQuotaPublic): string {
  if (quota.type === "none") return LINE_ONESHOT_PROBE_UNCONFIRMED_LABEL;
  if (quota.type === "limited" && quota.remaining != null) return String(quota.remaining);
  return LINE_ONESHOT_PROBE_UNCONFIRMED_LABEL;
}
