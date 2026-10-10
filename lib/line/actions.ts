"use server";

import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import {
  MARK_LINE_BROADCAST_SEND_CLOSED_RPC,
  OWNER_READ_LINE_TOKEN_CIPHER_RPC,
  RECORD_LINE_CONNECTION_TEST_RPC,
  SET_LINE_BROADCAST_ENABLED_RPC,
  UPSERT_LINE_BROADCAST_DRAFT_RPC,
  UPSERT_LINE_CONNECTION_RPC,
  evaluateLineBroadcastDraft,
  evaluateLineBroadcastEnable,
  evaluateLineBroadcastSend,
  evaluateLineConnectionSave,
  evaluateLineConnectionTest,
  newLineRequestId,
  type LineActor,
} from "@/lib/line/line-command";
import { fetchLineBotInfo } from "@/lib/line/line-connection-adapter";
import {
  canEncryptLineCredentials,
  decryptLineCredential,
  encryptLineCredential,
  tokenHintFromAccessToken,
} from "@/lib/line/line-crypto";
import {
  hasLineCredentialKey,
  isLineBroadcastSendOpen,
  isLineConnectionPilotEnabled,
} from "@/lib/line/line-flag";
import {
  countAcceptedBroadcastsOnDay,
  loadLineBroadcastByRequestId,
  loadLineBroadcasts,
  loadLineOfficialAccount,
} from "@/lib/line/line-load";
import type {
  LineBroadcastPublic,
  LineDecisionReason,
  LineOfficialAccountPublic,
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

export async function loadLineOfficialAccountAction(
  organizationId: string,
): Promise<LineActionResult<LineOfficialAccountPublic | null>> {
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
  return {
    ok: true,
    message: "ok",
    data: await loadLineOfficialAccount(organizationId),
  };
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
}): Promise<LineActionResult> {
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

  const supabase = await createClient();
  const inserted = await supabase.rpc(UPSERT_LINE_CONNECTION_RPC, {
    p_organization_id: input.organizationId,
    p_channel_id: input.channelId.trim(),
    p_channel_secret_cipher: secret.cipher,
    p_channel_access_token_cipher: token.cipher,
    p_key_id: secret.keyId,
    p_token_hint: tokenHintFromAccessToken(input.channelAccessToken),
  });
  if (inserted.error) {
    return { ok: false, reason: "error", message: "LINE 憑證寫入失敗" };
  }
  return { ok: true, message: "LINE 官方帳號憑證已加密保存" };
}

export async function testLineOfficialAccountAction(input: {
  organizationId: string;
}): Promise<LineActionResult> {
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
}

export async function setLineBroadcastEnabledAction(input: {
  organizationId: string;
  enabled: boolean;
}): Promise<LineActionResult> {
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
      ? "已記錄店長啟用。Phase 1 仍不會實際發送 LINE 訊息。"
      : "已關閉 LINE 群發",
  };
}

export async function saveLineBroadcastDraftAction(input: {
  organizationId: string;
  textBody: string;
  broadcastId?: string;
  requestId?: string;
}): Promise<LineActionResult<{ broadcastId: string; requestId: string }>> {
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
}

export async function confirmLineBroadcastAction(input: {
  organizationId: string;
  textBody: string;
  requestId: string;
  broadcastId?: string;
}): Promise<LineActionResult> {
  const { actor } = await loadActor(input.organizationId);
  let existing =
    (input.broadcastId
      ? (await loadLineBroadcasts(input.organizationId)).find((row) => row.id === input.broadcastId)
      : null) ?? (await loadLineBroadcastByRequestId(input.organizationId, input.requestId));
  if (!existing) {
    const drafted = await saveLineBroadcastDraftAction({
      organizationId: input.organizationId,
      textBody: input.textBody,
      requestId: input.requestId,
    });
    if (drafted.ok && drafted.data) {
      existing = await loadLineBroadcastByRequestId(
        input.organizationId,
        drafted.data.requestId,
      );
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const acceptedToday = countAcceptedBroadcastsOnDay(
    await loadLineBroadcasts(input.organizationId),
    today,
  );
  const account = await loadLineOfficialAccount(input.organizationId);
  const decision = evaluateLineBroadcastSend({
    connectionPilotEnabled: isLineConnectionPilotEnabled(),
    sendOpen: isLineBroadcastSendOpen(),
    ownerBroadcastEnabled: Boolean(account?.broadcastEnabled),
    organizationId: input.organizationId,
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
          p_organization_id: input.organizationId,
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
