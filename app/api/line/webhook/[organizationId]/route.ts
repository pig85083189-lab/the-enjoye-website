import { NextResponse } from "next/server";
import {
  CONSUME_LINE_OWNER_BIND_RPC,
  READ_LINE_CHANNEL_SECRET_CIPHER_RPC,
} from "@/lib/line/line-command";
import { decryptLineCredential, encryptLineCredential } from "@/lib/line/line-crypto";
import { processLineWebhookBind } from "@/lib/line/line-webhook";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await context.params;
  if (!organizationId?.startsWith("org-")) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");
  const secrets = await admin.rpc(READ_LINE_CHANNEL_SECRET_CIPHER_RPC, {
    p_organization_id: organizationId,
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
    consume: async (bind) => {
      const consumed = await admin.rpc(CONSUME_LINE_OWNER_BIND_RPC, {
        p_organization_id: bind.organizationId,
        p_code: bind.code,
        p_line_user_id_cipher: bind.cipher,
        p_line_user_id_hint: bind.hint,
        p_key_id: bind.keyId,
      });
      const row = consumed.data && typeof consumed.data === "object" ? consumed.data : {};
      return { bound: (row as { bound?: unknown }).bound === true };
    },
  });
  if (!result.ok && result.reason === "unauthorized") {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  return NextResponse.json({ ok: true, bound: result.ok ? result.bound : false });
}
