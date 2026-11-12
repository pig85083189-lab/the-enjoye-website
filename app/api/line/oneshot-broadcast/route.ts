import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID, LINE_BROADCAST_ONESHOT_TEXT } from "@/lib/line/line-flag";
import { executeAuthorizedPreviewOneshotBroadcast } from "@/lib/line/line-oneshot-authorized-send";
import { isLineBroadcastOneshotText } from "@/lib/line/line-oneshot";
import { getSupabaseEnv } from "@/lib/supabase/env";

export async function POST(request: Request) {
  if ((process.env.VERCEL_ENV ?? "").trim() !== "preview") {
    return NextResponse.json(
      { ok: false, status: "BLOCKED", message: "一次性群發測試只允許 Vercel Preview" },
      { status: 403 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const accessToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!accessToken) {
    return NextResponse.json(
      { ok: false, status: "BLOCKED", message: "請先登入後再發送" },
      { status: 401 },
    );
  }

  let body: {
    organizationId?: string;
    textBody?: string;
    requestId?: string;
    acknowledged?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, status: "BLOCKED", message: "請求格式不正確" },
      { status: 400 },
    );
  }

  if ((body.organizationId ?? "").trim() !== LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID) {
    return NextResponse.json(
      { ok: false, status: "BLOCKED", message: "一次性群發測試只允許 Beauty OS TEST" },
      { status: 403 },
    );
  }
  if (!isLineBroadcastOneshotText(body.textBody) || body.acknowledged !== true) {
    return NextResponse.json(
      { ok: false, status: "BLOCKED", message: "訊息必須與指定測試全文完全一致" },
      { status: 400 },
    );
  }
  if (!(body.requestId ?? "").startsWith("lbrq-")) {
    return NextResponse.json(
      { ok: false, status: "BLOCKED", message: "缺少可追蹤的發送識別" },
      { status: 400 },
    );
  }

  const { url, publishableKey } = getSupabaseEnv();
  const supabase = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const result = await executeAuthorizedPreviewOneshotBroadcast({
    supabase,
    organizationId: LINE_BROADCAST_ONESHOT_ALLOWED_ORG_ID,
    textBody: LINE_BROADCAST_ONESHOT_TEXT,
    requestId: body.requestId!,
    acknowledged: true,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
