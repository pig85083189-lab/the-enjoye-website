import { NextResponse } from "next/server";
import {
  CLAIM_LINE_WEBHOOK_EVENT_RPC,
  CONSUME_LINE_OWNER_BIND_PUBLIC_RPC,
  READ_LINE_WEBHOOK_CHANNEL_SECRET_CIPHER_RPC,
} from "@/lib/line/line-command";
import { decryptLineCredential, encryptLineCredential } from "@/lib/line/line-crypto";
import { evaluateLineWebhookAdmission } from "@/lib/line/line-webhook-host";
import { processLineWebhookCustomerAutomation } from "@/lib/line/automations/customer-line-webhook";
import {
  CONSUME_LINE_CUSTOMER_BIND_RPC,
  MARK_LINE_CUSTOMER_BLOCKED_RPC,
  MARK_LINE_CUSTOMER_UNSUBSCRIBED_RPC,
  SET_LINE_APPOINTMENT_REMINDER_CONSENT_RPC,
  UNBIND_LINE_CUSTOMER_BY_HASH_RPC,
} from "@/lib/line/automations/appointment-reminder-rpc";
import { processLineWebhookBind } from "@/lib/line/line-webhook";
import { createAnonymousClient } from "@/lib/supabase/anon";
import { createServiceRoleClient } from "@/lib/supabase/admin";

function requestHost(request: Request): string | null {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host");
}

function json(status: number, body: { ok: boolean; bound?: boolean }) {
  return NextResponse.json(body, { status });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ organizationId: string; publicToken: string }> },
) {
  const { organizationId, publicToken } = await context.params;
  const admitted = evaluateLineWebhookAdmission({
    organizationId,
    publicToken,
    host: requestHost(request),
    pathname: new URL(request.url).pathname,
  });
  if (!admitted.allow) {
    return json(404, { ok: false });
  }
  return json(200, { ok: true, bound: false });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string; publicToken: string }> },
) {
  const { organizationId, publicToken } = await context.params;
  const admitted = evaluateLineWebhookAdmission({
    organizationId,
    publicToken,
    host: requestHost(request),
    pathname: new URL(request.url).pathname,
  });
  if (!admitted.allow) {
    return json(404, { ok: false });
  }
  const token = publicToken.trim();
  const supabase = createAnonymousClient();
  if (!supabase) {
    return json(503, { ok: false });
  }
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");
  const secrets = await supabase.rpc(READ_LINE_WEBHOOK_CHANNEL_SECRET_CIPHER_RPC, {
    p_organization_id: organizationId,
    p_public_token: token,
  });
  const payload = secrets.data && typeof secrets.data === "object" ? secrets.data : null;
  const cipher =
    payload && "channel_secret_cipher" in payload
      ? String((payload as { channel_secret_cipher?: unknown }).channel_secret_cipher ?? "")
      : "";
  const opened = cipher.startsWith("v1.") ? decryptLineCredential(cipher) : null;
  const result = await processLineWebhookBind({
    organizationId,
    rawBody,
    signature,
    channelSecret: opened && opened.ok ? opened.plaintext : null,
    encryptUserId: (userId) => {
      const packed = encryptLineCredential(userId);
      return packed.ok ? { cipher: packed.cipher, keyId: packed.keyId } : null;
    },
    claimEvent: async (eventId) => {
      const claimed = await supabase.rpc(CLAIM_LINE_WEBHOOK_EVENT_RPC, {
        p_organization_id: organizationId,
        p_public_token: token,
        p_event_id: eventId,
      });
      const row = claimed.data && typeof claimed.data === "object" ? claimed.data : {};
      return { duplicate: (row as { duplicate?: unknown }).duplicate === true };
    },
    consume: async (bind) => {
      const consumed = await supabase.rpc(CONSUME_LINE_OWNER_BIND_PUBLIC_RPC, {
        p_organization_id: bind.organizationId,
        p_public_token: token,
        p_code: bind.code,
        p_line_user_id_cipher: bind.cipher,
        p_line_user_id_hint: bind.hint,
        p_key_id: bind.keyId,
      });
      const row = consumed.data && typeof consumed.data === "object" ? consumed.data : {};
      return {
        bound: (row as { bound?: unknown }).bound === true,
        reason: (row as { reason?: "invalid_input" | "expired" | "attempt_limited" | "unauthorized" })
          .reason,
      };
    },
  });
  if (!result.ok && result.reason === "unauthorized") {
    return json(403, { ok: false });
  }
  const admin = opened && opened.ok ? createServiceRoleClient() : null;
  if (admin) {
    await processLineWebhookCustomerAutomation({
      organizationId,
      rawBody,
      encryptUserId: (userId) => {
        const packed = encryptLineCredential(userId);
        return packed.ok ? { cipher: packed.cipher, keyId: packed.keyId } : null;
      },
      consumeBind: async (bind) => {
        const consumed = await admin.rpc(CONSUME_LINE_CUSTOMER_BIND_RPC, {
          p_organization_id: bind.organizationId,
          p_code: bind.code,
          p_line_user_id_cipher: bind.cipher,
          p_line_user_id_hash: bind.hash,
          p_line_user_id_hint: bind.hint,
          p_key_id: bind.keyId,
        });
        const row = consumed.data && typeof consumed.data === "object" ? consumed.data : {};
        return { bound: (row as { bound?: unknown }).bound === true };
      },
      setConsent: async (hash, optIn) => {
        await admin.rpc(SET_LINE_APPOINTMENT_REMINDER_CONSENT_RPC, {
          p_organization_id: organizationId,
          p_line_user_id_hash: hash,
          p_opt_in: optIn,
        });
      },
      markUnsubscribed: async (hash) => {
        await admin.rpc(MARK_LINE_CUSTOMER_UNSUBSCRIBED_RPC, {
          p_organization_id: organizationId,
          p_line_user_id_hash: hash,
        });
      },
      markUnbound: async (hash) => {
        await admin.rpc(UNBIND_LINE_CUSTOMER_BY_HASH_RPC, {
          p_organization_id: organizationId,
          p_line_user_id_hash: hash,
        });
      },
      markBlocked: async (hash) => {
        await admin.rpc(MARK_LINE_CUSTOMER_BLOCKED_RPC, {
          p_organization_id: organizationId,
          p_line_user_id_hash: hash,
        });
      },
      claimEvent: async (eventId) => {
        const claimed = await supabase.rpc(CLAIM_LINE_WEBHOOK_EVENT_RPC, {
          p_organization_id: organizationId,
          p_public_token: token,
          p_event_id: eventId,
        });
        const row = claimed.data && typeof claimed.data === "object" ? claimed.data : {};
        return { duplicate: (row as { duplicate?: unknown }).duplicate === true };
      },
    });
  }
  return json(200, { ok: true, bound: result.ok ? result.bound : false });
}
