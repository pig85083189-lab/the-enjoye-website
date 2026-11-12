/**
 * Phase 2A presentation helpers for the formal LINE broadcast center.
 * Does not send, claim, open flags, or create permits.
 */
import { newLineRequestId } from "@/lib/line/line-command";
import { canManageLineOfficialAccount } from "@/lib/line/line-roles";
import { canShowLineSettings } from "@/lib/line/line-visibility";
import type {
  LineBroadcastPublic,
  LineOfficialAccountPublic,
  LineQuotaPublic,
} from "@/lib/line/line-types";
import { utcIsoToTaipeiLocal } from "@/lib/persistence/appointment-time";
import type { StaffRole } from "@/types/saas";

export const LINE_BROADCAST_CONFIRM_AUDIENCE_SHORT = "發送對象：全部好友";
export const LINE_BROADCAST_CONFIRM_AUDIENCE_DETAIL =
  "發送給此官方帳號所有符合接收資格的好友";
export const LINE_BROADCAST_OPERATOR_ROLE_LABEL = "店長";
export const LINE_BROADCAST_MESSAGE_SUMMARY_MAX = 36;

const SENSITIVE_LINE_UI = /channel-secret|access-token|U[0-9a-f]{32}|BEAUTY_OS_LINE_CREDENTIAL_KEY|v1\.[A-Za-z0-9+/=._-]+/i;

export function canUseLineBroadcastCenter(actor: {
  role?: StaffRole | string | null;
  isActive?: boolean;
} | null | undefined): boolean {
  return canShowLineSettings(actor) && canManageLineOfficialAccount(actor);
}

export function visibleLineAccountForOrganization(
  account: LineOfficialAccountPublic | null | undefined,
  organizationId: string,
): LineOfficialAccountPublic | null {
  if (!account || account.organizationId !== organizationId) return null;
  return account;
}

export function visibleLineBroadcastsForOrganization(
  rows: readonly LineBroadcastPublic[],
  organizationId: string,
): LineBroadcastPublic[] {
  return rows.filter((row) => row.organizationId === organizationId);
}

export function editorStateForOrganizationChange(input: {
  previousOrganizationId: string | null;
  nextOrganizationId: string;
  currentText: string;
  currentRequestId: string;
  currentBroadcastId?: string;
}): {
  reset: boolean;
  textBody: string;
  requestId: string;
  broadcastId?: string;
} {
  if (
    !input.previousOrganizationId ||
    input.previousOrganizationId === input.nextOrganizationId
  ) {
    return {
      reset: false,
      textBody: input.currentText,
      requestId: input.currentRequestId,
      broadcastId: input.currentBroadcastId,
    };
  }
  return {
    reset: true,
    textBody: "",
    requestId: newLineRequestId(),
    broadcastId: undefined,
  };
}

export function lineOfficialAccountConnectionView(
  account: LineOfficialAccountPublic | null | undefined,
): {
  tone: "success" | "warning" | "danger" | "neutral";
  label: string;
  detail: string;
} {
  if (!account || !account.tokenConfigured) {
    return {
      tone: "neutral",
      label: "尚未保存官方帳號憑證",
      detail: "請先到 LINE 設定完成官方帳號連線。",
    };
  }
  if (account.lastTestStatus === "ok") {
    return {
      tone: "success",
      label: "已完成連線測試",
      detail: account.botDisplayName
        ? `官方帳號「${account.botDisplayName}」可編輯群發。`
        : "官方帳號已連線，可編輯群發。",
    };
  }
  if (account.lastTestStatus === "failed") {
    return {
      tone: "danger",
      label: "連線測試失敗",
      detail: "尚未通過連線測試，正式發送會被拒絕。",
    };
  }
  return {
    tone: "warning",
    label: "尚未完成連線測試",
    detail: "請先完成連線測試，未驗證前不得發送。",
  };
}

export function lineBroadcastMessageSummary(
  textBody: string,
  max = LINE_BROADCAST_MESSAGE_SUMMARY_MAX,
): string {
  const compact = textBody.replace(/\s+/g, " ");
  if (compact.length <= max) return compact || "（空白訊息）";
  return `${compact.slice(0, max)}…`;
}

export function lineBroadcastOperatorLabel(row: {
  createdByStaffId?: string | null;
  confirmedByStaffId?: string | null;
}): string {
  const staffId = row.confirmedByStaffId || row.createdByStaffId;
  if (staffId && /^staff-[a-z0-9-]+$/i.test(staffId)) {
    return `${LINE_BROADCAST_OPERATOR_ROLE_LABEL}（${staffId}）`;
  }
  return LINE_BROADCAST_OPERATOR_ROLE_LABEL;
}

export function lineBroadcastTaipeiDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const local = utcIsoToTaipeiLocal(iso);
    return `${local.dateYmd.replaceAll("-", "/")} ${local.hm}`;
  } catch {
    return "—";
  }
}

export function lineBroadcastSentAt(row: Pick<LineBroadcastPublic, "sendClaimedAt" | "confirmedAt">): string {
  return lineBroadcastTaipeiDateTime(row.sendClaimedAt || row.confirmedAt);
}

export function lineBroadcastHttpResultLabel(row: Pick<LineBroadcastPublic, "httpStatus" | "apiResult">): string {
  if (typeof row.httpStatus === "number") {
    if (row.httpStatus >= 200 && row.httpStatus < 300) {
      return `HTTP ${row.httpStatus}（LINE API 已接受，不代表已送達）`;
    }
    return `HTTP ${row.httpStatus}`;
  }
  if (row.apiResult === "send_closed") return "未呼叫 LINE";
  if (row.apiResult === "pending_confirmation") return "結果不明，未重送";
  return "尚未呼叫 LINE";
}

export function lineBroadcastSafeErrorSummary(message: string | null | undefined): string | null {
  const text = message?.trim() ?? "";
  if (!text) return null;
  if (SENSITIVE_LINE_UI.test(text)) return "發送失敗（已隱藏敏感細節）";
  if (/token|secret|cipher|bearer/i.test(text)) return "發送失敗（已隱藏敏感細節）";
  return text;
}

export function lineBroadcastConfirmCopy(input: {
  organizationName: string;
  officialName: string;
  textBody: string;
}): {
  organizationName: string;
  officialName: string;
  audienceShort: string;
  audienceDetail: string;
  fullText: string;
} {
  return {
    organizationName: input.organizationName,
    officialName: input.officialName,
    audienceShort: LINE_BROADCAST_CONFIRM_AUDIENCE_SHORT,
    audienceDetail: LINE_BROADCAST_CONFIRM_AUDIENCE_DETAIL,
    fullText: input.textBody,
  };
}

export function lineBroadcastMonthlyQuotaLines(quota: LineQuotaPublic): {
  limit: string;
  usage: string;
  remaining: string;
  label: string;
} {
  return {
    limit:
      quota.type === "none"
        ? "無上限"
        : quota.limit == null
          ? "無法確認"
          : String(quota.limit),
    usage: quota.usage == null ? "無法確認" : String(quota.usage),
    remaining:
      quota.type === "none"
        ? "—"
        : quota.remaining == null
          ? "無法確認"
          : String(quota.remaining),
    label: quota.label,
  };
}

export function lineBroadcastUiContainsSecrets(source: string): boolean {
  return SENSITIVE_LINE_UI.test(source);
}

export function lineBroadcastsStayIsolatedWhenChannelsMatch(input: {
  leftOrganizationId: string;
  rightOrganizationId: string;
  leftChannelId: string | null;
  rightChannelId: string | null;
}): boolean {
  return (
    input.leftOrganizationId !== input.rightOrganizationId &&
    Boolean(input.leftChannelId) &&
    input.leftChannelId === input.rightChannelId
  );
}
