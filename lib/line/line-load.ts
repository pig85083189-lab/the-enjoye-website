import { createClient } from "@/lib/supabase/server";
import { OWNER_READ_LINE_WEBHOOK_TOKEN_CIPHER_RPC } from "@/lib/line/line-command";
import { decryptLineCredential } from "@/lib/line/line-crypto";
import { lineWebhookPublicUrl } from "@/lib/line/line-webhook-url";
import { isLineHttpErrorClass } from "@/lib/line/line-http-error";
import { utcIsoToTaipeiLocal } from "@/lib/persistence/appointment-time";
import type {
  LineBroadcastPublic,
  LineBroadcastStatus,
  LineConnectionTestStatus,
  LineOfficialAccountPublic,
  LineOwnerRecipientPublic,
  LineTestSendPublic,
  LineWebhookPublicUrl,
} from "@/lib/line/line-types";

export const LINE_BROADCAST_QUOTA_TIMEZONE = "Asia/Taipei";

const LEGACY_CLAIMED_BROADCAST_STATUSES = [
  "accepted",
  "sending",
  "pending_confirmation",
] as const;

function asAccount(row: Record<string, unknown> | null): LineOfficialAccountPublic | null {
  if (!row) return null;
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
    lastTestStatus: (row.last_test_status as LineConnectionTestStatus | null) ?? null,
    lastTestMessage: (row.last_test_message as string | null) ?? null,
  };
}

function asBroadcast(row: Record<string, unknown>): LineBroadcastPublic {
  return {
    id: String(row.id ?? ""),
    organizationId: String(row.organization_id ?? ""),
    status: (row.status as LineBroadcastStatus) ?? "draft",
    textBody: String(row.text_body ?? ""),
    requestId: String(row.request_id ?? ""),
    lineRequestId: (row.line_request_id as string | null) ?? null,
    apiResult: (row.api_result as LineBroadcastPublic["apiResult"]) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    httpStatus: typeof row.http_status === "number" ? row.http_status : null,
    errorClass:
      typeof row.error_class === "string" && isLineHttpErrorClass(row.error_class)
        ? row.error_class
        : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    sendClaimedAt: (row.send_claimed_at as string | null) ?? null,
  };
}

export type LineAccountRead =
  | { ok: true; account: LineOfficialAccountPublic | null }
  | { ok: false; message: string };

const LINE_ACCOUNT_PUBLIC_COLUMNS =
  "organization_id,channel_id,bot_display_name,bot_basic_id,token_hint,secret_configured,token_configured,broadcast_enabled,test_push_enabled,last_tested_at,last_test_status,last_test_message";

export async function readLineTestPushRuntimeOpen(
  organizationId: string,
): Promise<{ readOk: boolean; open: boolean; runtimeOpen: boolean | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("line_official_accounts")
    .select("organization_id,test_push_runtime_open")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) {
    return { readOk: false, open: false, runtimeOpen: null };
  }
  const runtimeOpen = Boolean(
    (data as { test_push_runtime_open?: unknown }).test_push_runtime_open,
  );
  return { readOk: true, open: runtimeOpen, runtimeOpen };
}

export async function readLineBroadcastTestRuntimeOpen(
  organizationId: string,
): Promise<{ readOk: boolean; open: boolean; runtimeOpen: boolean | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("line_official_accounts")
    .select("organization_id,broadcast_test_runtime_open")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) {
    return { readOk: false, open: false, runtimeOpen: null };
  }
  const runtimeOpen = Boolean(
    (data as { broadcast_test_runtime_open?: unknown }).broadcast_test_runtime_open,
  );
  return { readOk: true, open: runtimeOpen, runtimeOpen };
}

export async function readLineBroadcastOneshotPermit(
  organizationId: string,
): Promise<{ readOk: boolean; available: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("line_broadcast_oneshot_permits")
    .select("id")
    .eq("organization_id", organizationId)
    .is("consumed_at", null)
    .maybeSingle();
  if (error) {
    return { readOk: false, available: false };
  }
  return { readOk: true, available: Boolean(data) };
}

export async function readLineOfficialAccount(
  organizationId: string,
): Promise<LineAccountRead> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("line_official_accounts")
    .select(LINE_ACCOUNT_PUBLIC_COLUMNS)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    return { ok: false, message: "無法讀取 LINE 官方帳號設定" };
  }
  if (!data) {
    return { ok: true, account: null };
  }
  const runtime = await readLineTestPushRuntimeOpen(organizationId);
  const broadcastRuntime = await readLineBroadcastTestRuntimeOpen(organizationId);
  return {
    ok: true,
    account: asAccount({
      ...(data as Record<string, unknown>),
      test_push_runtime_open: runtime.readOk ? runtime.runtimeOpen : false,
      broadcast_test_runtime_open: broadcastRuntime.readOk
        ? broadcastRuntime.runtimeOpen
        : false,
    }),
  };
}

export async function loadLineOfficialAccount(
  organizationId: string,
): Promise<LineOfficialAccountPublic | null> {
  const read = await readLineOfficialAccount(organizationId);
  return read.ok ? read.account : null;
}

export async function loadLineBroadcasts(
  organizationId: string,
): Promise<LineBroadcastPublic[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("line_broadcasts")
    .select(
      "id,organization_id,status,text_body,request_id,line_request_id,api_result,error_message,http_status,error_class,created_at,updated_at,confirmed_at,send_claimed_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data.map((row) => asBroadcast(row as Record<string, unknown>));
}

export async function loadLineBroadcastByRequestId(
  organizationId: string,
  requestId: string,
): Promise<LineBroadcastPublic | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("line_broadcasts")
    .select(
      "id,organization_id,status,text_body,request_id,line_request_id,api_result,error_message,http_status,error_class,created_at,updated_at,confirmed_at,send_claimed_at",
    )
    .eq("organization_id", organizationId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (error || !data) return null;
  return asBroadcast(data as Record<string, unknown>);
}

export async function loadLineOwnerRecipient(
  organizationId: string,
): Promise<LineOwnerRecipientPublic | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("line_owner_recipients")
    .select("organization_id,line_user_id_hint,bind_method,bound_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    organizationId: String(row.organization_id ?? organizationId),
    bound: true,
    hint: (row.line_user_id_hint as string | null) ?? null,
    bindMethod: "webhook_code",
    boundAt: (row.bound_at as string | null) ?? null,
  };
}

export async function loadLineTestSends(
  organizationId: string,
): Promise<LineTestSendPublic[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("line_test_sends")
    .select(
      "id,organization_id,status,text_body,request_id,line_request_id,api_result,error_message,http_status,error_class,created_at,updated_at,confirmed_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data.map((row) => asBroadcast(row as Record<string, unknown>));
}

export async function loadLineTestSendByRequestId(
  organizationId: string,
  requestId: string,
): Promise<LineTestSendPublic | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("line_test_sends")
    .select(
      "id,organization_id,status,text_body,request_id,line_request_id,api_result,error_message,http_status,error_class,created_at,updated_at,confirmed_at",
    )
    .eq("organization_id", organizationId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (error || !data) return null;
  return asBroadcast(data as Record<string, unknown>);
}

export async function loadLineWebhookPublicUrl(
  organizationId: string,
): Promise<LineWebhookPublicUrl | null> {
  const supabase = await createClient();
  const read = await supabase.rpc(OWNER_READ_LINE_WEBHOOK_TOKEN_CIPHER_RPC, {
    p_organization_id: organizationId,
  });
  const row = read.data && typeof read.data === "object" ? (read.data as Record<string, unknown>) : null;
  const cipher = row && typeof row.token_cipher === "string" ? row.token_cipher : "";
  const hint = row && typeof row.token_hint === "string" ? row.token_hint : "";
  if (!cipher.startsWith("v1.")) return null;
  const opened = decryptLineCredential(cipher);
  if (!opened.ok) return null;
  return {
    url: lineWebhookPublicUrl(organizationId, opened.plaintext),
    hint: hint || "••••",
  };
}

export function taipeiCalendarDate(instant: Date | string = new Date()): string {
  const iso = instant instanceof Date ? instant.toISOString() : instant;
  return utcIsoToTaipeiLocal(iso).dateYmd;
}

export function broadcastConsumesTaipeiDayQuota(
  row: LineBroadcastPublic,
  taipeiDay: string,
): boolean {
  if (row.sendClaimedAt) {
    return taipeiCalendarDate(row.sendClaimedAt) === taipeiDay;
  }
  if (!(LEGACY_CLAIMED_BROADCAST_STATUSES as readonly string[]).includes(row.status)) {
    return false;
  }
  const legacyAt = row.confirmedAt ?? row.createdAt;
  return Boolean(legacyAt) && taipeiCalendarDate(legacyAt) === taipeiDay;
}

export function countClaimedBroadcastsOnTaipeiDay(
  rows: LineBroadcastPublic[],
  taipeiDay: string,
): number {
  return rows.filter((row) => broadcastConsumesTaipeiDayQuota(row, taipeiDay)).length;
}

/** Test-push helper. Official Broadcast uses countClaimedBroadcastsOnTaipeiDay. */
export function countAcceptedBroadcastsOnDay(
  rows: LineBroadcastPublic[],
  dayIso: string,
): number {
  return rows.filter((row) => {
    if (row.status !== "accepted" && row.status !== "sending" && row.status !== "pending_confirmation") {
      return false;
    }
    return row.createdAt.slice(0, 10) === dayIso;
  }).length;
}
