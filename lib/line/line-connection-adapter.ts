/**
 * Server-only LINE connection test. Uses GET /v2/bot/info.
 * Never broadcasts. Never logs tokens or secrets.
 */

import {
  LINE_API_ORIGIN,
  LINE_BOT_INFO_PATH,
  LINE_OAUTH_VERIFY_PATH,
} from "@/lib/line/line-command";
import type { LineOneshotIdentity } from "@/lib/line/line-oneshot";

function lineConnectionHttpErrorMessage(error: unknown): string {
  if (
    (error instanceof Error && error.name === "AbortError") ||
    /timeout|aborted/i.test(error instanceof Error ? error.message : "")
  ) {
    return "LINE 連線逾時，未變更任何資料";
  }
  return "目前無法連線到 LINE API";
}

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
  } catch (error) {
    return {
      ok: false,
      message: lineConnectionHttpErrorMessage(error),
    };
  }
}

export type LineChannelTokenIdentityResult =
  | { ok: true; clientId: string | null; scope: string | null; httpStatus: number }
  | { ok: false; message: string; httpStatus?: number | null };

/**
 * Official verify for short-lived and long-lived Channel Access Tokens:
 * POST /v2/oauth/verify with application/x-www-form-urlencoded access_token.
 * Do not use GET + Bearer — that is for Messaging API bot endpoints, not this verify.
 */
export function inspectLineChannelTokenVerifyRequest(accessToken: string): {
  url: string;
  method: "POST";
  headers: { "Content-Type": "application/x-www-form-urlencoded" };
  body: string;
} {
  return {
    url: `${LINE_API_ORIGIN}${LINE_OAUTH_VERIFY_PATH}`,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ access_token: accessToken }).toString(),
  };
}

export async function fetchLineChannelTokenIdentity(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LineChannelTokenIdentityResult> {
  if (typeof window !== "undefined") {
    throw new Error("LINE connection adapter cannot run in the browser");
  }
  const request = inspectLineChannelTokenVerifyRequest(accessToken);
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        message: `LINE Token 驗證 API 回傳 HTTP ${response.status}`,
      };
    }
    let body: { client_id?: unknown; scope?: unknown };
    try {
      body = (await response.json()) as { client_id?: unknown; scope?: unknown };
    } catch {
      return {
        ok: false,
        httpStatus: response.status,
        message: "LINE Token 驗證回應無法解析",
      };
    }
    const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
    if (!clientId) {
      return {
        ok: false,
        httpStatus: response.status,
        message: "LINE API 回傳資料不足，無法確認 Channel ID",
      };
    }
    return {
      ok: true,
      clientId,
      scope: typeof body.scope === "string" ? body.scope : null,
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      message: lineConnectionHttpErrorMessage(error),
    };
  }
}

export async function verifyLineOneshotOfficialAccount(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<
  | { ok: true; identity: Required<LineOneshotIdentity> }
  | { ok: false; message: string }
> {
  if (typeof window !== "undefined") {
    throw new Error("LINE connection adapter cannot run in the browser");
  }
  const [bot, token] = await Promise.all([
    fetchLineBotInfo(accessToken, fetchImpl),
    fetchLineChannelTokenIdentity(accessToken, fetchImpl),
  ]);
  if (!bot.ok) return { ok: false, message: bot.message };
  if (!token.ok) return { ok: false, message: token.message };
  return {
    ok: true,
    identity: {
      clientId: token.clientId,
      displayName: bot.displayName,
      basicId: bot.basicId,
    },
  };
}

export function lineBroadcastHttpForbidden(): never {
  throw new Error("LINE broadcast HTTP is closed in Phase 1");
}
