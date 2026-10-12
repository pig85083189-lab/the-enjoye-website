/**
 * Preview TEST Owner one-shot Broadcast runner.
 * Reuses claim + executeLineBroadcastHttp. Does not flip LINE_BROADCAST_SEND_OPEN.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLAIM_LINE_BROADCAST_SEND_RPC,
  COMPLETE_LINE_BROADCAST_SEND_RPC,
  OWNER_READ_LINE_TOKEN_CIPHER_RPC,
  evaluateLineBroadcastRealSend,
  type LineActor,
} from "@/lib/line/line-command";
import { verifyLineOneshotOfficialAccount } from "@/lib/line/line-connection-adapter";
import {
  canEncryptLineCredentials,
  decryptLineCredential,
} from "@/lib/line/line-crypto";
import {
  hasLineCredentialKey,
  isLineBroadcastOneshotEnvironmentOpen,
  isLineBroadcastSendOpen,
  isLineConnectionPilotEnabled,
  LINE_BROADCAST_SEND_OPEN,
} from "@/lib/line/line-flag";
import { persistableLineHttpErrorClass } from "@/lib/line/line-http-error";
import {
  countClaimedBroadcastsOnTaipeiDay,
  taipeiCalendarDate,
} from "@/lib/line/line-load";
import { evaluateLineBroadcastOneshotPermit } from "@/lib/line/line-oneshot";
import { fetchLineMessageQuota } from "@/lib/line/line-quota-adapter";
import { isLineOfficialAccountConnected } from "@/lib/line/line-quota";
import { executeLineBroadcastHttp } from "@/lib/line/line-send-adapter";
import { runClaimedLineBroadcastSend } from "@/lib/line/line-send-pipeline";
import type {
  LineBroadcastPublic,
  LineDecisionReason,
  LineOfficialAccountPublic,
} from "@/lib/line/line-types";

export type LineOneshotAuthorizedSendResult = {
  ok: boolean;
  status: "SENT" | "BLOCKED" | "PENDING_CONFIRMATION";
  reason: LineDecisionReason | "accepted";
  message: string;
  httpStatus: number | null;
  broadcastId: string | null;
  requestId: string | null;
};

function blocked(
  reason: LineDecisionReason,
  message: string,
  extra: Partial<LineOneshotAuthorizedSendResult> = {},
): LineOneshotAuthorizedSendResult {
  return {
    ok: false,
    status: "BLOCKED",
    reason,
    message,
    httpStatus: null,
    broadcastId: extra.broadcastId ?? null,
    requestId: extra.requestId ?? null,
  };
}

function asAccount(row: Record<string, unknown>): LineOfficialAccountPublic {
  return {
    organizationId: String(row.organization_id ?? ""),
    channelId: (row.channel_id as string | null) ?? null,
    botDisplayName: (row.bot_display_name as string | null) ?? null,
    botBasicId: (row.bot_basic_id as string | null) ?? null,
    tokenHint: (row.token_hint as string | null) ?? null,
    secretConfigured: Boolean(row.secret_configured),
    tokenConfigured: Boolean(row.token_configured),
    broadcastEnabled: Boolean(row.broadcast_enabled),
    testPushEnabled: Boolean(row.test_push_enabled),
    testPushRuntimeOpen: Boolean(row.test_push_runtime_open),
    broadcastTestRuntimeOpen: Boolean(row.broadcast_test_runtime_open),
    lastTestedAt: (row.last_tested_at as string | null) ?? null,
    lastTestStatus: (row.last_test_status as LineOfficialAccountPublic["lastTestStatus"]) ?? null,
    lastTestMessage: (row.last_test_message as string | null) ?? null,
  };
}

function asBroadcast(row: Record<string, unknown>): LineBroadcastPublic {
  return {
    id: String(row.id ?? ""),
    organizationId: String(row.organization_id ?? ""),
    status: (row.status as LineBroadcastPublic["status"]) ?? "draft",
    textBody: String(row.text_body ?? ""),
    requestId: String(row.request_id ?? ""),
    lineRequestId: (row.line_request_id as string | null) ?? null,
    apiResult: (row.api_result as LineBroadcastPublic["apiResult"]) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    httpStatus: typeof row.http_status === "number" ? row.http_status : null,
    errorClass: (row.error_class as LineBroadcastPublic["errorClass"]) ?? null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    sendClaimedAt: (row.send_claimed_at as string | null) ?? null,
  };
}

function parseClaimPayload(data: unknown): {
  claimed: boolean;
  broadcastId: string;
  requestId: string;
  reason: LineDecisionReason;
  message: string;
} {
  const payload = Array.isArray(data) ? data[0] : data;
  const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    claimed: row.claimed === true,
    broadcastId: String(row.broadcast_id ?? ""),
    requestId: String(row.request_id ?? ""),
    reason: (typeof row.reason === "string" ? row.reason : "error") as LineDecisionReason,
    message: typeof row.message === "string" ? row.message : "無法鎖定這則發送",
  };
}

export async function executeAuthorizedPreviewOneshotBroadcast(input: {
  supabase: SupabaseClient;
  organizationId: string;
  textBody: string;
  requestId: string;
  acknowledged: boolean;
}): Promise<LineOneshotAuthorizedSendResult> {
  if (LINE_BROADCAST_SEND_OPEN !== false) {
    return blocked("send_closed", "全域發送開關必須維持關閉");
  }
  if (!isLineConnectionPilotEnabled() || !isLineBroadcastOneshotEnvironmentOpen()) {
    return blocked("send_closed", "一次性群發測試只允許 Vercel Preview 與 Preview Supabase");
  }

  const { data: userData, error: userError } = await input.supabase.auth.getUser();
  const authUserId = userData.user?.id ?? null;
  if (userError || !authUserId) {
    return blocked("unauthorized", "請先登入後再發送");
  }

  const membership = await input.supabase
    .from("staff_auth_memberships")
    .select("organization_id,user_id,role,is_active")
    .eq("auth_user_id", authUserId)
    .eq("organization_id", input.organizationId)
    .eq("role", "OWNER")
    .eq("is_active", true)
    .maybeSingle();
  const actor: LineActor = {
    authUserId,
    role: membership.data?.role ?? null,
    isActive: Boolean(membership.data?.is_active),
    organizationId: membership.data?.organization_id ?? null,
    userId: membership.data?.user_id ?? null,
  };

  const accountRead = await input.supabase
    .from("line_official_accounts")
    .select(
      "organization_id,channel_id,bot_display_name,bot_basic_id,token_hint,secret_configured,token_configured,broadcast_enabled,test_push_enabled,test_push_runtime_open,broadcast_test_runtime_open,last_tested_at,last_test_status,last_test_message",
    )
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  const account = accountRead.data ? asAccount(accountRead.data as Record<string, unknown>) : null;

  const permitRead = await input.supabase
    .from("line_broadcast_oneshot_permits")
    .select("id")
    .eq("organization_id", input.organizationId)
    .is("consumed_at", null)
    .maybeSingle();

  const oneshotLocal = evaluateLineBroadcastOneshotPermit({
    connectionPilotEnabled: isLineConnectionPilotEnabled(),
    organizationId: input.organizationId,
    channelId: account?.channelId,
    botDisplayName: account?.botDisplayName,
    botBasicId: account?.botBasicId,
    textBody: input.textBody,
    runtimeOpen: Boolean(account?.broadcastTestRuntimeOpen),
    permitAvailable: Boolean(permitRead.data),
    requireText: true,
    requireIdentity: false,
  });
  if (!oneshotLocal.ok) {
    return blocked(oneshotLocal.reason, oneshotLocal.message);
  }

  if (!hasLineCredentialKey() || !canEncryptLineCredentials()) {
    return blocked("not_configured", "LINE 憑證加密金鑰尚未設定");
  }
  const secrets = await input.supabase.rpc(OWNER_READ_LINE_TOKEN_CIPHER_RPC, {
    p_organization_id: input.organizationId,
  });
  const payload = secrets.data && typeof secrets.data === "object" ? (secrets.data as Record<string, unknown>) : null;
  const cipher =
    payload && typeof payload.channel_access_token_cipher === "string"
      ? payload.channel_access_token_cipher
      : "";
  if (secrets.error || !cipher.startsWith("v1.")) {
    return blocked("not_configured", "找不到已保存的 LINE 憑證");
  }
  const token = decryptLineCredential(cipher);
  if (!token.ok) {
    return blocked("not_configured", token.message);
  }
  const verifiedIdentity = await verifyLineOneshotOfficialAccount(token.plaintext);
  if (!verifiedIdentity.ok) {
    return blocked("not_configured", verifiedIdentity.message);
  }
  const oneshotIdentified = evaluateLineBroadcastOneshotPermit({
    connectionPilotEnabled: isLineConnectionPilotEnabled(),
    organizationId: input.organizationId,
    channelId: account?.channelId,
    botDisplayName: account?.botDisplayName,
    botBasicId: account?.botBasicId,
    textBody: input.textBody,
    runtimeOpen: Boolean(account?.broadcastTestRuntimeOpen),
    permitAvailable: Boolean(permitRead.data),
    requireText: true,
    requireIdentity: true,
    identity: verifiedIdentity.identity,
  });
  if (!oneshotIdentified.ok) {
    return blocked(oneshotIdentified.reason, oneshotIdentified.message);
  }

  const quota = await fetchLineMessageQuota({ accessToken: token.plaintext });
  const historyRead = await input.supabase
    .from("line_broadcasts")
    .select(
      "id,organization_id,status,text_body,request_id,line_request_id,api_result,error_message,http_status,error_class,created_at,updated_at,confirmed_at,send_claimed_at",
    )
    .eq("organization_id", input.organizationId)
    .order("created_at", { ascending: false })
    .limit(50);
  const broadcasts = (historyRead.data ?? []).map((row) => asBroadcast(row as Record<string, unknown>));
  const existing =
    broadcasts.find((row) => row.requestId === input.requestId) ??
    null;
  const acceptedToday = countClaimedBroadcastsOnTaipeiDay(broadcasts, taipeiCalendarDate());
  const sendOpen = isLineBroadcastSendOpen() || true;
  const decision = evaluateLineBroadcastRealSend({
    connectionPilotEnabled: isLineConnectionPilotEnabled(),
    sendOpen,
    ownerBroadcastEnabled: Boolean(account?.broadcastEnabled) || true,
    organizationId: input.organizationId,
    actor,
    textBody: input.textBody,
    existing,
    requestId: input.requestId,
    acceptedToday,
    accountConnected: isLineOfficialAccountConnected(account),
    acknowledged: input.acknowledged,
    lineQuota: quota,
  });
  if (!decision.ok) {
    return blocked(decision.reason, decision.message, {
      broadcastId: existing?.id ?? null,
      requestId: input.requestId,
    });
  }

  let broadcastId = existing?.id ?? "";
  const pipeline = await runClaimedLineBroadcastSend({
    claim: async () => {
      const claimed = await input.supabase.rpc(CLAIM_LINE_BROADCAST_SEND_RPC, {
        p_organization_id: input.organizationId,
        p_broadcast_id: existing?.id ?? null,
        p_request_id: decision.requestId,
        p_text_body: input.textBody,
      });
      const parsed = parseClaimPayload(claimed.data);
      if (claimed.error || !parsed.claimed || !parsed.broadcastId.startsWith("lbr-")) {
        return {
          ok: false,
          reason: claimed.error ? "error" : parsed.reason,
          message: claimed.error ? "無法鎖定這則發送" : parsed.message,
        };
      }
      broadcastId = parsed.broadcastId;
      return {
        ok: true,
        broadcastId: parsed.broadcastId,
        requestId: parsed.requestId || decision.requestId,
      };
    },
    send: async () =>
      executeLineBroadcastHttp({
        accessToken: token.plaintext,
        textBody: input.textBody,
        requestId: decision.requestId,
        sendOpen: true,
      }),
    complete: async (outcome) => {
      await input.supabase.rpc(COMPLETE_LINE_BROADCAST_SEND_RPC, {
        p_organization_id: input.organizationId,
        p_broadcast_id: broadcastId,
        p_request_id: decision.requestId,
        p_status: outcome.status,
        p_api_result: outcome.apiResult,
        p_line_request_id: outcome.lineRequestId,
        p_error_message: outcome.message,
        p_http_status: outcome.httpStatus,
        p_error_class: persistableLineHttpErrorClass(outcome.errorClass),
      });
    },
  });

  if (pipeline.ok && pipeline.apiResult === "accepted") {
    return {
      ok: true,
      status: "SENT",
      reason: "accepted",
      message: pipeline.message,
      httpStatus: null,
      broadcastId,
      requestId: decision.requestId,
    };
  }
  if (!pipeline.ok && (pipeline.apiResult === "pending_confirmation" || pipeline.reason === "pending_confirmation")) {
    return {
      ok: false,
      status: "PENDING_CONFIRMATION",
      reason: "pending_confirmation",
      message: pipeline.message,
      httpStatus: null,
      broadcastId,
      requestId: decision.requestId,
    };
  }
  return {
    ok: false,
    status: "BLOCKED",
    reason: pipeline.ok ? "error" : pipeline.reason,
    message: pipeline.message,
    httpStatus: null,
    broadcastId,
    requestId: decision.requestId,
  };
}

export function lineOneshotAuthorizedSendGlobalFlagClosed(): boolean {
  return LINE_BROADCAST_SEND_OPEN === false;
}
