/**
 * Server-only LINE connection test. Uses GET /v2/bot/info.
 * Never broadcasts. Never logs tokens or secrets.
 */

import { LINE_API_ORIGIN, LINE_BOT_INFO_PATH } from "@/lib/line/line-command";

export type LineBotInfoResult =
  | {
      ok: true;
      displayName: string | null;
      basicId: string | null;
    }
  | { ok: false; message: string };

export async function fetchLineBotInfo(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LineBotInfoResult> {
  if (typeof window !== "undefined") {
    throw new Error("LINE connection adapter cannot run in the browser");
  }
  try {
    const response = await fetchImpl(`${LINE_API_ORIGIN}${LINE_BOT_INFO_PATH}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      return { ok: false, message: "LINE 連線測試失敗，請確認 Channel Access Token" };
    }
    const body = (await response.json()) as {
      displayName?: string;
      basicId?: string;
    };
    return {
      ok: true,
      displayName: body.displayName ?? null,
      basicId: body.basicId ?? null,
    };
  } catch {
    return { ok: false, message: "目前無法連線到 LINE API" };
  }
}

export function lineBroadcastHttpForbidden(): never {
  throw new Error("LINE broadcast HTTP is closed in Phase 1");
}
