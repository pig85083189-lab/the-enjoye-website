"use server";

import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import {
  CLAIM_LINE_BROADCAST_SEND_RPC,
  CLAIM_LINE_TEST_SEND_RPC,
  COMPLETE_LINE_BROADCAST_SEND_RPC,
  COMPLETE_LINE_TEST_SEND_RPC,
  MARK_LINE_BROADCAST_SEND_CLOSED_RPC,
  OWNER_READ_LINE_RECIPIENT_CIPHER_RPC,
  OWNER_READ_LINE_TOKEN_CIPHER_RPC,
  UPSERT_LINE_WEBHOOK_PUBLIC_TOKEN_RPC,
  RECORD_LINE_BROADCAST_OWNER_EVENT_RPC,
  RECORD_LINE_CONNECTION_TEST_RPC,
  SET_LINE_BROADCAST_ENABLED_RPC,
  SET_LINE_TEST_PUSH_ENABLED_RPC,
  START_LINE_OWNER_BIND_RPC,
  UNBIND_LINE_OWNER_RECIPIENT_RPC,
  UPSERT_LINE_BROADCAST_DRAFT_RPC,
  UPSERT_LINE_CONNECTION_RPC,
  UPSERT_LINE_TEST_SEND_DRAFT_RPC,
  evaluateLineBroadcastDraft,
  evaluateLineBroadcastEnable,
  evaluateLineBroadcastRealSend,
  evaluateLineBroadcastSend,
  evaluateLineConnectionSave,
  evaluateLineConnectionTest,
  evaluateLineOwnerBindStart,
  evaluateLineTestPushEnable,
  evaluateLineTestPushSend,
  newLineRequestId,
  newLineTestRequestId,
  resolveVerifiedLineOrganizationId,
  type LineActor,
} from "@/lib/line/line-command";
import { fetchLineBotInfo } from "@/lib/line/line-connection-adapter";
import {
  canEncryptLineCredentials,
  decryptLineCredential,
  encryptLineCredential,
  tokenHintFromAccessToken,
} from "@/lib/line/line-crypto";
import { hashLineWebhookPublicToken } from "@/lib/line/line-bind";
import {
  createLineWebhookPublicToken,
  lineWebhookPublicUrl,
} from "@/lib/line/line-webhook-url";
import {
  hasLineCredentialKey,
  isLineBroadcastSendOpen,
  isLineConnectionPilotEnabled,
  isLineTestPushOpen,
  resolveLineTestPushTransport,
} from "@/lib/line/line-flag";
import { fetchLineMessageQuota } from "@/lib/line/line-quota-adapter";
import { isLineOfficialAccountConnected, unknownLineQuota } from "@/lib/line/line-quota";
import { executeLineTestPushHttp } from "@/lib/line/line-push-adapter";
import { executeLineBroadcastHttp } from "@/lib/line/line-send-adapter";
import { runClaimedLineBroadcastSend } from "@/lib/line/line-send-pipeline";
import {
  LINE_SETTINGS_LOAD_ERROR,
  LINE_SETTINGS_SAVE_ERROR,
  LINE_SETTINGS_SAVE_SUCCESS,
  LINE_SETTINGS_TEST_ERROR,
  LINE_SETTINGS_UNEXPECTED_ERROR,
  publicAccountAfterSave,
} from "@/lib/line/line-settings-status";
import {
  countAcceptedBroadcastsOnDay,
  loadLineBroadcastByRequestId,
  loadLineBroadcasts,
  loadLineOfficialAccount,
  loadLineOwnerRecipient,
  loadLineTestSendByRequestId,
  loadLineTestSends,
  loadLineWebhookPublicUrl,
  readLineOfficialAccount,
} from "@/lib/line/line-load";
import type {
  LineBroadcastPrepare,
  LineTestSendPublic,
  LineBroadcastPublic,
  LineDecisionReason,
  LineOfficialAccountPublic,
  LineWebhookPublicUrl,
} from "@/lib/line/line-types";
import { createClient } from "@/lib/supabase/server";

export type LineActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; reason: LineDecisionReason; message: string };

function actorFromResolved(
  resolved: Awaited<ReturnType<typeof getAuthenticatedStaffMembership>>,
  authUserId: string | null,
): LineActor {
  return {
    authUserId,
    role: resolved.status === "ok" ? resolved.membership.role : null,
    isActive: resolved.status === "ok" ? resolved.membership.isActive : false,
    organizationId: resolved.status === "ok" ? resolved.membership.organizationId : null,
    userId: resolved.status === "ok" ? resolved.membership.userId : null,
  };
}

async function loadActor(organizationId?: string | null) {
  const user = await getServerStaffAuthUser();
  const resolved = await getAuthenticatedStaffMembership({
    organizationId: organizationId ?? undefined,
  });
  return {
    actor: actorFromResolved(resolved, user?.id ?? null),
    resolved,
  };
}

async function loadVerifiedLineOrganization(requestedOrganizationId?: string | null): Promise<
  | { ok: true; actor: LineActor; organizationId: string }
  | { ok: false; reason: LineDecisionReason; message: string }
> {
  const { actor } = await loadActor(requestedOrganizationId);
  const verified = resolveVerifiedLineOrganizationId({
    requestedOrganizationId,
    actor,
  });
  if (!verified.ok) return verified;
  return { ok: true, actor, organizationId: verified.organizationId };
}

async function runLineAction<T>(
  work: () => Promise<LineActionResult<T>>,
  fallback: string,
): Promise<LineActionResult<T>> {
  try {
    return await work();
  } catch {
    return { ok: false, reason: "error", message: fallback };
  }
}

export async function loadLineOfficialAccountAction(
  organizationId: string,
): Promise<LineActionResult<LineOfficialAccountPublic | null>> {
  return runLineAction(async () => {
    const { actor } = await loadActor(organizationId);
    const gate = evaluateLineConnectionTest({
      connectionPilotEnabled: isLineConnectionPilotEnabled(),
      encryptionReady: true,
      organizationId,
      actor,
      secretConfigured: true,
      tokenConfigured: true,
    });
    if (!gate.ok && gate.reason === "unauthorized") {
      return { ok: false, reason: gate.reason, message: gate.message };
    }
    if (!isLineConnectionPilotEnabled()) {
      return { ok: false, reason: "pilot_disabled", message: "LINE 串接尚未啟用" };
    }
    const read = await readLineOfficialAccount(organizationId);
    if (!read.ok) {
      return { ok: false, reason: "error", message: LINE_SETTINGS_LOAD_ERROR };
    }
    return {
      ok: true,
      message: "ok",
      data: read.account,
    };
  }, LINE_SETTINGS_LOAD_ERROR);
}

export async function loadLineBroadcastsAction(
  organizationId: string,
): Promise<LineActionResult<LineBroadcastPublic[]>> {
  const { actor } = await loadActor(organizationId);
  const gate = evaluateLineBroadcastDraft({
    connectionPilotEnabled: isLineConnectionPilotEnabled(),
    organizationId,
    actor,
    textBody: "probe",
  });
  if (!gate.ok && gate.reason === "unauthorized") {
    return { ok: false, reason: gate.reason, message: gate.message };
  }
  if (!isLineConnectionPilotEnabled()) {
    return { ok: false, reason: "pilot_disabled", message: "LINE 串接尚未啟用" };
  }
  return {
    ok: true,
    message: "ok",
    data: await loadLineBroadcasts(organizationId),
  };
}

export async function saveLineOfficialAccountAction(input: {
  organizationId: string;
  channelId: string;
  channelSecret: string;
  channelAccessToken: string;
}): Promise<LineActionResult<LineOfficialAccountPublic>> {
  return runLineAction(async () => {
    const env = process.env;
    const { actor } = await loadActor(input.organizationId);
    const decision = evaluateLineConnectionSave({
      connectionPilotEnabled: isLineConnectionPilotEnabled(env),
      encryptionReady: canEncryptLineCredentials(env),
      organizationId: input.organizationId,
      actor,
      channelId: input.channelId,
      channelSecret: input.channelSecret,
      channelAccessToken: input.channelAccessToken,
    });
    if (!decision.ok) return decision;

    const secret = encryptLineCredential(input.channelSecret.trim(), env);
    const token = encryptLineCredential(input.channelAccessToken.trim(), env);
    if (!secret.ok || !token.ok) {
      return { ok: false, reason: "not_configured", message: "LINE 憑證加密金鑰尚未設定" };
    }

    const tokenHint = tokenHintFromAccessToken(input.channelAccessToken);
    const supabase = await createClient();
    const inserted = await supabase.rpc(UPSERT_LINE_CONNECTION_RPC, {
      p_organization_id: input.organizationId,
      p_channel_id: input.channelId.trim(),
      p_channel_secret_cipher: secret.cipher,
      p_channel_access_token_cipher: token.cipher,
      p_key_id: secret.keyId,
      p_token_hint: tokenHint,
    });
    if (inserted.error) {
      return { ok: false, reason: "error", message: LINE_SETTINGS_SAVE_ERROR };
    }
    const read = await readLineOfficialAccount(input.organizationId);
    const previous = read.ok ? read.account : null;
    return {
      ok: true,
      message: LINE_SETTINGS_SAVE_SUCCESS,
      data: publicAccountAfterSave({
        organizationId: input.organizationId,
        channelId: input.channelId.trim(),
        tokenHint,
        previous,
      }),
    };
  }, LINE_SETTINGS_SAVE_ERROR);
}

export async function testLineOfficialAccountAction(input: {
  organizationId: string;
}): Promise<LineActionResult> {
  return runLineAction(async () => {
  const env = process.env;
  const { actor } = await loadActor(input.organizationId);
  const account = await loadLineOfficialAccount(input.organizationId);
  const decision = evaluateLineConnectionTest({
    connectionPilotEnabled: isLineConnectionPilotEnabled(env),
    encryptionReady: hasLineCredentialKey(env) && canEncryptLineCredentials(env),
    organizationId: input.organizationId,
    actor,
    secretConfigured: Boolean(account?.secretConfigured),
    tokenConfigured: Boolean(account?.tokenConfigured),
  });
  if (!decision.ok) return decision;

  const supabase = await createClient();
  const secrets = await supabase.rpc(OWNER_READ_LINE_TOKEN_CIPHER_RPC, {
    p_organization_id: input.organizationId,
  });
  const payload = secrets.data && typeof secrets.data === "object" ? secrets.data : null;
  const cipher =
    payload && "channel_access_token_cipher" in payload
      ? String((payload as { channel_access_token_cipher?: unknown }).channel_access_token_cipher ?? "")
      : "";
  if (secrets.error || !cipher.startsWith("v1.")) {
    return { ok: false, reason: "not_configured", message: "找不到已保存的 LINE 憑證" };
  }
  const token = decryptLineCredential(cipher, env);
  if (!token.ok) {
    return { ok: false, reason: "error", message: token.message };
  }

  const probed = await fetchLineBotInfo(token.plaintext);
  await supabase.rpc(RECORD_LINE_CONNECTION_TEST_RPC, {
    p_organization_id: input.organizationId,
    p_status: probed.ok ? "ok" : "failed",
    p_message: probed.ok ? "已確認官方帳號連線，未發送任何訊息" : probed.message,
    p_bot_display_name: probed.ok ? probed.displayName : null,
    p_bot_basic_id: probed.ok ? probed.basicId : null,
  });
  if (!probed.ok) {
    return { ok: false, reason: "error", message: probed.message };
  }
  return { ok: true, message: "連線成功。這次測試沒有向好友發送訊息。" };
  }, LINE_SETTINGS_TEST_ERROR);
}

export async function setLineBroadcastEnabledAction(input: {
  organizationId: string;
  enabled: boolean;
}): Promise<LineActionResult> {
  return runLineAction(async () => {
    const { actor } = await loadActor(input.organizationId);
    const account = await loadLineOfficialAccount(input.organizationId);
    const decision = evaluateLineBroadcastEnable({
      connectionPilotEnabled: isLineConnectionPilotEnabled(),
      organizationId: input.organizationId,
      actor,
      enabled: input.enabled,
      tokenConfigured: Boolean(account?.tokenConfigured && account.lastTestStatus === "ok"),
    });
    if (!decision.ok) return decision;
    const supabase = await createClient();
    const updated = await supabase.rpc(SET_LINE_BROADCAST_ENABLED_RPC, {
      p_organization_id: input.organizationId,
      p_enabled: input.enabled,
    });
    if (updated.error) {
      return { ok: false, reason: "error", message: "無法更新群發開關" };
    }
    return {
      ok: true,
      message: input.enabled
        ? "已記錄店長啟用。真實發送仍須伺服器開關開啟後才會呼叫 LINE。"
        : "已關閉 LINE 群發",
    };
  }, LINE_SETTINGS_UNEXPECTED_ERROR);
}

async function readOwnerAccessTokenCipher(organizationId: string) {
  const supabase = await createClient();
  const secrets = await supabase.rpc(OWNER_READ_LINE_TOKEN_CIPHER_RPC, {
    p_organization_id: organizationId,
  });
  const payload = secrets.data && typeof secrets.data === "object" ? secrets.data : null;
  const cipher =
    payload && "channel_access_token_cipher" in payload
      ? String((payload as { channel_access_token_cipher?: unknown }).channel_access_token_cipher ?? "")
      : "";
  return { error: secrets.error, cipher };
}

async function loadLineQuotaForOwner(organizationId: string) {
  const env = process.env;
  if (!hasLineCredentialKey(env) || !canEncryptLineCredentials(env)) {
    return unknownLineQuota("憑證金鑰未設定");
  }
  const secrets = await readOwnerAccessTokenCipher(organizationId);
  if (secrets.error || !secrets.cipher.startsWith("v1.")) {
    return unknownLineQuota();
  }
  const token = decryptLineCredential(secrets.cipher, env);
  if (!token.ok) return unknownLineQuota();
  return fetchLineMessageQuota({ accessToken: token.plaintext });
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

export async function saveLineBroadcastDraftAction(input: {
  organizationId: string;
  textBody: string;
  broadcastId?: string;
  requestId?: string;
}): Promise<LineActionResult<{ broadcastId: string; requestId: string }>> {
  return runLineAction(async () => {
    const { actor } = await loadActor(input.organizationId);
    const decision = evaluateLineBroadcastDraft({
      connectionPilotEnabled: isLineConnectionPilotEnabled(),
      organizationId: input.organizationId,
      actor,
      textBody: input.textBody,
    });
    if (!decision.ok) return decision;
    const requestId = input.requestId?.startsWith("lbrq-")
      ? input.requestId
      : newLineRequestId();
    const supabase = await createClient();
    const saved = await supabase.rpc(UPSERT_LINE_BROADCAST_DRAFT_RPC, {
      p_organization_id: input.organizationId,
      p_broadcast_id: input.broadcastId ?? null,
      p_request_id: requestId,
      p_text_body: input.textBody,
    });
    const payload = Array.isArray(saved.data) ? saved.data[0] : saved.data;
    const broadcastId =
      payload && typeof payload === "object" && "broadcast_id" in payload
        ? String((payload as { broadcast_id?: unknown }).broadcast_id ?? "")
        : "";
    if (saved.error || !broadcastId.startsWith("lbr-")) {
      return { ok: false, reason: "error", message: "草稿寫入失敗" };
    }
    return {
      ok: true,
      message: "草稿已保存",
      data: { broadcastId, requestId },
    };
  }, "草稿寫入失敗");
}

export async function loadLineBroadcastPrepareAction(
  organizationId: string,
): Promise<LineActionResult<LineBroadcastPrepare>> {
  return runLineAction(async () => {
    const verified = await loadVerifiedLineOrganization(organizationId);
    if (!verified.ok) return verified;
    const { actor, organizationId: scopedOrg } = verified;
    const gate = evaluateLineBroadcastDraft({
      connectionPilotEnabled: isLineConnectionPilotEnabled(),
      organizationId: scopedOrg,
      actor,
      textBody: "probe",
    });
    if (!gate.ok && gate.reason === "unauthorized") {
      return { ok: false, reason: gate.reason, message: gate.message };
    }
    if (!isLineConnectionPilotEnabled()) {
      return { ok: false, reason: "pilot_disabled", message: "LINE 串接尚未啟用" };
    }
    const account = await loadLineOfficialAccount(scopedOrg);
    const broadcasts = await loadLineBroadcasts(scopedOrg);
    const quota =
      isLineBroadcastSendOpen() && account?.tokenConfigured
        ? await loadLineQuotaForOwner(scopedOrg)
        : unknownLineQuota(
            account?.tokenConfigured
              ? "實際發送尚未開放，未查詢 LINE 額度"
              : "尚未保存 Channel Access Token",
          );
    return {
      ok: true,
      message: "ok",
      data: {
        account,
        quota,
        sendOpen: isLineBroadcastSendOpen(),
        testPushOpen: isLineTestPushOpen({ organizationId: scopedOrg }),
        broadcasts,
        testSends: await loadLineTestSends(scopedOrg),
        recipient: await loadLineOwnerRecipient(scopedOrg),
        webhook: await loadLineWebhookPublicUrl(scopedOrg),
      },
    };
  }, "無法讀取群發準備資料");
}

export async function confirmLineBroadcastAction(input: {
  organizationId: string;
  textBody: string;
  requestId: string;
  broadcastId?: string;
}): Promise<LineActionResult> {
  const verified = await loadVerifiedLineOrganization(input.organizationId);
  if (!verified.ok) return verified;
  const { actor, organizationId } = verified;
  let existing =
    (input.broadcastId
      ? (await loadLineBroadcasts(organizationId)).find((row) => row.id === input.broadcastId)
      : null) ?? (await loadLineBroadcastByRequestId(organizationId, input.requestId));
  if (!existing) {
    const drafted = await saveLineBroadcastDraftAction({
      organizationId,
      textBody: input.textBody,
      requestId: input.requestId,
    });
    if (drafted.ok && drafted.data) {
      existing = await loadLineBroadcastByRequestId(
        organizationId,
        drafted.data.requestId,
      );
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const acceptedToday = countAcceptedBroadcastsOnDay(
    await loadLineBroadcasts(organizationId),
    today,
  );
  const account = await loadLineOfficialAccount(organizationId);
  const decision = evaluateLineBroadcastSend({
    connectionPilotEnabled: isLineConnectionPilotEnabled(),
    sendOpen: isLineBroadcastSendOpen(),
    ownerBroadcastEnabled: Boolean(account?.broadcastEnabled),
    organizationId,
    actor,
    textBody: input.textBody,
    existing,
    requestId: input.requestId,
    acceptedToday,
  });
  if (!decision.ok) {
    if (existing?.id) {
      const supabase = await createClient();
      if (decision.reason === "send_closed") {
        await supabase.rpc(MARK_LINE_BROADCAST_SEND_CLOSED_RPC, {
          p_organization_id: organizationId,
          p_broadcast_id: existing.id,
          p_request_id: input.requestId,
        });
      }
    }
    return decision;
  }
  return {
    ok: false,
    reason: "send_closed",
    message: "LINE 群發尚未開放實際發送",
  };
}

export async function sendLineBroadcastAction(input: {
  organizationId: string;
  textBody: string;
  requestId: string;
  broadcastId?: string;
  acknowledged: boolean;
}): Promise<LineActionResult> {
  return runLineAction(async () => {
    const verified = await loadVerifiedLineOrganization(input.organizationId);
    if (!verified.ok) return verified;
    const { actor, organizationId } = verified;
    let existing =
      (input.broadcastId
        ? (await loadLineBroadcasts(organizationId)).find((row) => row.id === input.broadcastId)
        : null) ?? (await loadLineBroadcastByRequestId(organizationId, input.requestId));
    if (!existing) {
      const drafted = await saveLineBroadcastDraftAction({
        organizationId,
        textBody: input.textBody,
        requestId: input.requestId,
      });
      if (drafted.ok && drafted.data) {
        existing = await loadLineBroadcastByRequestId(
          organizationId,
          drafted.data.requestId,
        );
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    const broadcasts = await loadLineBroadcasts(organizationId);
    const acceptedToday = countAcceptedBroadcastsOnDay(broadcasts, today);
    const account = await loadLineOfficialAccount(organizationId);
    const quota =
      isLineBroadcastSendOpen() && account?.tokenConfigured
        ? await loadLineQuotaForOwner(organizationId)
        : unknownLineQuota("實際發送尚未開放，未查詢 LINE 額度");
    const decision = evaluateLineBroadcastRealSend({
      connectionPilotEnabled: isLineConnectionPilotEnabled(),
      sendOpen: isLineBroadcastSendOpen(),
      ownerBroadcastEnabled: Boolean(account?.broadcastEnabled),
      organizationId,
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
      if (existing?.id) {
        const supabase = await createClient();
        await supabase.rpc(RECORD_LINE_BROADCAST_OWNER_EVENT_RPC, {
          p_organization_id: organizationId,
          p_broadcast_id: existing.id,
          p_event_type: "send_refused",
          p_detail: decision.message,
        });
      }
      return decision;
    }

    const supabase = await createClient();
    const pipeline = await runClaimedLineBroadcastSend({
      claim: async () => {
        const claimed = await supabase.rpc(CLAIM_LINE_BROADCAST_SEND_RPC, {
          p_organization_id: organizationId,
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
        existing = {
          ...(existing as LineBroadcastPublic),
          id: parsed.broadcastId,
          requestId: parsed.requestId || decision.requestId,
        };
        return {
          ok: true,
          broadcastId: parsed.broadcastId,
          requestId: parsed.requestId || decision.requestId,
        };
      },
      send: async () => {
        if (!isLineBroadcastSendOpen()) {
          return {
            timedOut: false,
            httpOk: false,
            lineRequestId: null,
            httpStatus: null,
          };
        }
        const secrets = await readOwnerAccessTokenCipher(organizationId);
        if (secrets.error || !secrets.cipher.startsWith("v1.")) {
          throw new Error("missing-token");
        }
        const token = decryptLineCredential(secrets.cipher, process.env);
        if (!token.ok) throw new Error("decrypt-failed");
        return executeLineBroadcastHttp({
          accessToken: token.plaintext,
          textBody: input.textBody,
          requestId: decision.requestId,
          sendOpen: isLineBroadcastSendOpen(),
        });
      },
      complete: async (outcome) => {
        const status =
          !isLineBroadcastSendOpen() && outcome.apiResult === "failed"
            ? "send_closed"
            : outcome.status;
        const apiResult =
          !isLineBroadcastSendOpen() && outcome.apiResult === "failed"
            ? "send_closed"
            : outcome.apiResult;
        await supabase.rpc(COMPLETE_LINE_BROADCAST_SEND_RPC, {
          p_organization_id: organizationId,
          p_broadcast_id: existing?.id ?? "",
          p_request_id: decision.requestId,
          p_status: status,
          p_api_result: apiResult,
          p_line_request_id: outcome.lineRequestId,
          p_error_message: outcome.message,
        });
      },
    });

    if (!isLineBroadcastSendOpen()) {
      return {
        ok: false,
        reason: "send_closed",
        message: "真實發送仍維持關閉。系統沒有呼叫 LINE Broadcast，也沒有向好友發送。",
      };
    }
    return pipeline.ok
      ? { ok: true, message: pipeline.message }
      : { ok: false, reason: pipeline.reason, message: pipeline.message };
  }, "真實發送失敗");
}

async function writeLineWebhookPublicToken(input: {
  organizationId: string;
  rotate: boolean;
}): Promise<LineActionResult<LineWebhookPublicUrl>> {
  const { actor } = await loadActor(input.organizationId);
  const account = await loadLineOfficialAccount(input.organizationId);
  const decision = evaluateLineOwnerBindStart({
    connectionPilotEnabled: isLineConnectionPilotEnabled(),
    organizationId: input.organizationId,
    actor,
    secretConfigured: Boolean(account?.secretConfigured),
  });
  if (!decision.ok) return decision;
  if (!input.rotate) {
    const existing = await loadLineWebhookPublicUrl(input.organizationId);
    if (existing) {
      return { ok: true, message: "Webhook URL 已準備", data: existing };
    }
  }
  const token = createLineWebhookPublicToken();
  const packed = encryptLineCredential(token);
  if (!packed.ok) {
    return { ok: false, reason: "error", message: packed.message };
  }
  const supabase = await createClient();
  const saved = await supabase.rpc(UPSERT_LINE_WEBHOOK_PUBLIC_TOKEN_RPC, {
    p_organization_id: input.organizationId,
    p_token_hash: hashLineWebhookPublicToken(input.organizationId, token),
    p_token_hint: tokenHintFromAccessToken(token),
    p_token_cipher: packed.cipher,
    p_key_id: packed.keyId,
    p_rotate: input.rotate,
  });
  if (saved.error) {
    return { ok: false, reason: "error", message: "無法建立 Webhook URL" };
  }
  const created =
    saved.data && typeof saved.data === "object"
      ? (saved.data as { created?: unknown }).created === true
      : false;
  if (!created) {
    const existing = await loadLineWebhookPublicUrl(input.organizationId);
    if (existing) {
      return { ok: true, message: "Webhook URL 已準備", data: existing };
    }
  }
  return {
    ok: true,
    message: input.rotate
      ? "已輪替 Webhook URL。請只填到專用測試官方帳號，不要改 THE ENJOYE。"
      : "Webhook URL 已準備。請只填到專用測試官方帳號，不要改 THE ENJOYE。",
    data: {
      url: lineWebhookPublicUrl(input.organizationId, token),
      hint: tokenHintFromAccessToken(token),
    },
  };
}

export async function ensureLineWebhookPublicUrlAction(input: {
  organizationId: string;
}): Promise<LineActionResult<LineWebhookPublicUrl>> {
  return runLineAction(
    () => writeLineWebhookPublicToken({ organizationId: input.organizationId, rotate: false }),
    "無法建立 Webhook URL",
  );
}

export async function rotateLineWebhookPublicTokenAction(input: {
  organizationId: string;
}): Promise<LineActionResult<LineWebhookPublicUrl>> {
  return runLineAction(
    () => writeLineWebhookPublicToken({ organizationId: input.organizationId, rotate: true }),
    "無法輪替 Webhook URL",
  );
}

export async function startLineOwnerBindAction(input: {
  organizationId: string;
}): Promise<LineActionResult<{ code: string; expiresAt: string }>> {
  return runLineAction(async () => {
    const { actor } = await loadActor(input.organizationId);
    const account = await loadLineOfficialAccount(input.organizationId);
    const decision = evaluateLineOwnerBindStart({
      connectionPilotEnabled: isLineConnectionPilotEnabled(),
      organizationId: input.organizationId,
      actor,
      secretConfigured: Boolean(account?.secretConfigured),
    });
    if (!decision.ok) return decision;
    const supabase = await createClient();
    const started = await supabase.rpc(START_LINE_OWNER_BIND_RPC, {
      p_organization_id: input.organizationId,
    });
    const payload = started.data && typeof started.data === "object" ? started.data : {};
    const code = String((payload as { code?: unknown }).code ?? "");
    const expiresAt = String((payload as { expires_at?: unknown }).expires_at ?? "");
    if (started.error || !/^[0-9A-F]{8}$/.test(code)) {
      return { ok: false, reason: "error", message: "無法產生綁定驗證碼" };
    }
    return {
      ok: true,
      message: "請用你自己的 LINE 把驗證碼傳給本官方帳號。不要輸入 User ID。",
      data: { code, expiresAt },
    };
  }, "無法產生綁定驗證碼");
}

export async function unbindLineOwnerRecipientAction(input: {
  organizationId: string;
}): Promise<LineActionResult> {
  return runLineAction(async () => {
    const { actor } = await loadActor(input.organizationId);
    const decision = evaluateLineOwnerBindStart({
      connectionPilotEnabled: isLineConnectionPilotEnabled(),
      organizationId: input.organizationId,
      actor,
      secretConfigured: true,
    });
    if (!decision.ok) return decision;
    const supabase = await createClient();
    const unbound = await supabase.rpc(UNBIND_LINE_OWNER_RECIPIENT_RPC, {
      p_organization_id: input.organizationId,
    });
    if (unbound.error) {
      return { ok: false, reason: "error", message: "無法解除綁定" };
    }
    return { ok: true, message: "已解除店長 LINE 綁定" };
  }, "無法解除綁定");
}

export async function setLineTestPushEnabledAction(input: {
  organizationId: string;
  enabled: boolean;
}): Promise<LineActionResult> {
  return runLineAction(async () => {
    const { actor } = await loadActor(input.organizationId);
    const recipient = await loadLineOwnerRecipient(input.organizationId);
    const decision = evaluateLineTestPushEnable({
      connectionPilotEnabled: isLineConnectionPilotEnabled(),
      organizationId: input.organizationId,
      actor,
      enabled: input.enabled,
      recipientBound: Boolean(recipient?.bound),
    });
    if (!decision.ok) return decision;
    const supabase = await createClient();
    const updated = await supabase.rpc(SET_LINE_TEST_PUSH_ENABLED_RPC, {
      p_organization_id: input.organizationId,
      p_enabled: input.enabled,
    });
    if (updated.error) {
      return { ok: false, reason: "error", message: "無法更新測試發送開關" };
    }
    return {
      ok: true,
      message: input.enabled
        ? "已記錄店長啟用測試發送。實際 Push 仍須伺服器開關開啟。"
        : "已關閉測試發送",
    };
  }, LINE_SETTINGS_UNEXPECTED_ERROR);
}

export async function sendLineTestPushAction(input: {
  organizationId: string;
  textBody: string;
  requestId: string;
  testSendId?: string;
  acknowledged: boolean;
}): Promise<LineActionResult> {
  return runLineAction(async () => {
    const verified = await loadVerifiedLineOrganization(input.organizationId);
    if (!verified.ok) return verified;
    const { actor, organizationId } = verified;
    const testPushOpen = isLineTestPushOpen({ organizationId });
    let existing =
      (input.testSendId
        ? (await loadLineTestSends(organizationId)).find((row) => row.id === input.testSendId)
        : null) ?? (await loadLineTestSendByRequestId(organizationId, input.requestId));
    if (!existing) {
      const requestId = input.requestId.startsWith("ltsq-")
        ? input.requestId
        : newLineTestRequestId();
      const supabase = await createClient();
      const drafted = await supabase.rpc(UPSERT_LINE_TEST_SEND_DRAFT_RPC, {
        p_organization_id: organizationId,
        p_test_send_id: input.testSendId ?? null,
        p_request_id: requestId,
        p_text_body: input.textBody,
      });
      const payload = drafted.data && typeof drafted.data === "object" ? drafted.data : {};
      const testSendId = String((payload as { test_send_id?: unknown }).test_send_id ?? "");
      if (!drafted.error && testSendId.startsWith("lts-")) {
        existing = await loadLineTestSendByRequestId(organizationId, requestId);
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    const acceptedToday = countAcceptedBroadcastsOnDay(
      await loadLineTestSends(organizationId),
      today,
    );
    const account = await loadLineOfficialAccount(organizationId);
    const recipient = await loadLineOwnerRecipient(organizationId);
    const decision = evaluateLineTestPushSend({
      connectionPilotEnabled: isLineConnectionPilotEnabled(),
      testPushOpen,
      ownerTestPushEnabled: Boolean(account?.testPushEnabled),
      organizationId,
      actor,
      textBody: input.textBody,
      existing,
      requestId: input.requestId,
      acceptedToday,
      accountConnected: isLineOfficialAccountConnected(account),
      acknowledged: input.acknowledged,
      recipient,
    });
    if (!decision.ok) {
      if (existing?.id) {
        const supabase = await createClient();
        await supabase.rpc(RECORD_LINE_BROADCAST_OWNER_EVENT_RPC, {
          p_organization_id: organizationId,
          p_broadcast_id: null,
          p_event_type: "send_refused",
          p_detail: decision.message,
        });
      }
      return decision;
    }

    const supabase = await createClient();
    const pipeline = await runClaimedLineBroadcastSend({
      claim: async () => {
        const claimed = await supabase.rpc(CLAIM_LINE_TEST_SEND_RPC, {
          p_organization_id: organizationId,
          p_test_send_id: existing?.id ?? null,
          p_request_id: decision.requestId,
          p_text_body: input.textBody,
        });
        const parsed = parseClaimPayload(claimed.data);
        if (claimed.error || !parsed.claimed || !parsed.broadcastId.startsWith("lts-")) {
          return {
            ok: false,
            reason: claimed.error ? "error" : parsed.reason,
            message: claimed.error ? "無法鎖定這則測試發送" : parsed.message,
          };
        }
        existing = {
          ...(existing as LineTestSendPublic),
          id: parsed.broadcastId,
          requestId: parsed.requestId || decision.requestId,
        };
        return {
          ok: true,
          broadcastId: parsed.broadcastId,
          requestId: parsed.requestId || decision.requestId,
        };
      },
      send: async () => {
        const transport = resolveLineTestPushTransport({ organizationId });
        if (!transport.open) {
          return { timedOut: false, httpOk: false, lineRequestId: null, httpStatus: null };
        }
        const tokenSecrets = await readOwnerAccessTokenCipher(transport.organizationId);
        const recipientSecrets = await supabase.rpc(OWNER_READ_LINE_RECIPIENT_CIPHER_RPC, {
          p_organization_id: transport.organizationId,
        });
        const recipientPayload =
          recipientSecrets.data && typeof recipientSecrets.data === "object"
            ? recipientSecrets.data
            : {};
        const userCipher = String(
          (recipientPayload as { line_user_id_cipher?: unknown }).line_user_id_cipher ?? "",
        );
        if (tokenSecrets.error || !tokenSecrets.cipher.startsWith("v1.") || !userCipher.startsWith("v1.")) {
          throw new Error("missing-credentials");
        }
        const token = decryptLineCredential(tokenSecrets.cipher, process.env);
        const userId = decryptLineCredential(userCipher, process.env);
        if (!token.ok || !userId.ok) throw new Error("decrypt-failed");
        return executeLineTestPushHttp({
          accessToken: token.plaintext,
          lineUserId: userId.plaintext,
          textBody: input.textBody,
          requestId: decision.requestId,
          testPushOpen: true,
        });
      },
      complete: async (outcome) => {
        const status =
          !isLineTestPushOpen({ organizationId }) && outcome.apiResult === "failed"
            ? "send_closed"
            : outcome.status;
        const apiResult =
          !isLineTestPushOpen({ organizationId }) && outcome.apiResult === "failed"
            ? "send_closed"
            : outcome.apiResult;
        await supabase.rpc(COMPLETE_LINE_TEST_SEND_RPC, {
          p_organization_id: organizationId,
          p_test_send_id: existing?.id ?? "",
          p_request_id: decision.requestId,
          p_status: status,
          p_api_result: apiResult,
          p_line_request_id: outcome.lineRequestId,
          p_error_message: outcome.message,
        });
      },
    });

    if (!isLineTestPushOpen({ organizationId })) {
      return {
        ok: false,
        reason: "send_closed",
        message: "測試發送仍維持關閉。系統沒有呼叫 LINE Push，也沒有向好友發送。",
      };
    }
    return pipeline.ok
      ? { ok: true, message: pipeline.message }
      : { ok: false, reason: pipeline.reason, message: pipeline.message };
  }, "測試發送失敗");
}
