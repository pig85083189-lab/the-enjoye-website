import type { LineOfficialAccountPublic, LineQuotaPublic } from "@/lib/line/line-types";

export const UNKNOWN_LINE_QUOTA_LABEL = "未知（無法取得 LINE 額度）";

export function unknownLineQuota(reason?: string | null): LineQuotaPublic {
  const detail = reason?.trim();
  return {
    known: false,
    type: null,
    limit: null,
    usage: null,
    remaining: null,
    label: detail ? `未知（${detail}）` : UNKNOWN_LINE_QUOTA_LABEL,
  };
}

export function describeLineQuota(input: {
  type?: "none" | "limited" | null;
  limit?: number | null;
  usage?: number | null;
}): LineQuotaPublic {
  if (input.type === "none") {
    return {
      known: true,
      type: "none",
      limit: null,
      usage: input.usage ?? null,
      remaining: null,
      label:
        input.usage == null
          ? "本月額度：無上限（LINE 回報）"
          : `本月額度：無上限（LINE 回報），已使用 ${input.usage}`,
    };
  }
  if (
    input.type === "limited" &&
    typeof input.limit === "number" &&
    Number.isFinite(input.limit) &&
    typeof input.usage === "number" &&
    Number.isFinite(input.usage)
  ) {
    const remaining = Math.max(0, input.limit - input.usage);
    return {
      known: true,
      type: "limited",
      limit: input.limit,
      usage: input.usage,
      remaining,
      label: `本月額度 ${input.limit}，已使用 ${input.usage}，剩餘 ${remaining}`,
    };
  }
  return unknownLineQuota("額度資料不完整");
}

export function isLineOfficialAccountConnected(
  account: LineOfficialAccountPublic | null | undefined,
): boolean {
  return Boolean(account?.tokenConfigured && account.lastTestStatus === "ok");
}

export function lineQuotaBlocksSend(quota: LineQuotaPublic | null | undefined): boolean {
  return Boolean(quota?.known && quota.type === "limited" && quota.remaining === 0);
}

export function latestRestorableLineDraft<T extends { status: string; createdAt: string }>(
  rows: T[],
): T | null {
  return (
    rows.find((row) => row.status === "draft") ??
    null
  );
}

export function restoreLineBroadcastEditor<
  T extends { id: string; status: string; textBody: string; requestId: string; createdAt: string },
>(input: {
  history: T[];
  currentText: string;
  currentRequestId: string;
  currentBroadcastId?: string;
}): {
  textBody: string;
  requestId: string;
  broadcastId?: string;
  restored: boolean;
} {
  if (input.currentText.trim() || input.currentBroadcastId) {
    return {
      textBody: input.currentText,
      requestId: input.currentRequestId,
      broadcastId: input.currentBroadcastId,
      restored: false,
    };
  }
  const draft = latestRestorableLineDraft(input.history);
  if (!draft) {
    return {
      textBody: input.currentText,
      requestId: input.currentRequestId,
      broadcastId: input.currentBroadcastId,
      restored: false,
    };
  }
  return {
    textBody: draft.textBody,
    requestId: draft.requestId,
    broadcastId: draft.id,
    restored: true,
  };
}
