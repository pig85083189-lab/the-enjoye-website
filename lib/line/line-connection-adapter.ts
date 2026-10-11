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

export type LineChannelTokenIdentityResult =
  | { ok: true; clientId: string | null; scope: string | null }
  | { ok: false; message: string };

export async function fetchLineChannelTokenIdentity(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LineChannelTokenIdentityResult> {
  if (typeof window !== "undefined") {
    throw new Error("LINE connection adapter cannot run in the browser");
  }
  try {
    const response = await fetchImpl(`${LINE_API_ORIGIN}${LINE_OAUTH_VERIFY_PATH}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      return { ok: false, message: "LINE Channel 驗證失敗" };
    }
    const body = (await response.json()) as {
      client_id?: string;
      scope?: string;
    };
    return {
      ok: true,
      clientId: body.client_id ?? null,
      scope: body.scope ?? null,
    };
  } catch {
    return { ok: false, message: "目前無法連線到 LINE API" };
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
