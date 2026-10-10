import { createClient } from "@/lib/supabase/server";
import type {
  LineBroadcastPublic,
  LineBroadcastStatus,
  LineConnectionTestStatus,
  LineOfficialAccountPublic,
} from "@/lib/line/line-types";

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
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    confirmedAt: (row.confirmed_at as string | null) ?? null,
  };
}

export type LineAccountRead =
  | { ok: true; account: LineOfficialAccountPublic | null }
  | { ok: false; message: string };

export async function readLineOfficialAccount(
  organizationId: string,
): Promise<LineAccountRead> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("line_official_accounts")
    .select(
      "organization_id,channel_id,bot_display_name,bot_basic_id,token_hint,secret_configured,token_configured,broadcast_enabled,last_tested_at,last_test_status,last_test_message",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    return { ok: false, message: "無法讀取 LINE 官方帳號設定" };
  }
  return { ok: true, account: asAccount((data as Record<string, unknown> | null) ?? null) };
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
      "id,organization_id,status,text_body,request_id,line_request_id,api_result,error_message,created_at,updated_at,confirmed_at",
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
      "id,organization_id,status,text_body,request_id,line_request_id,api_result,error_message,created_at,updated_at,confirmed_at",
    )
    .eq("organization_id", organizationId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (error || !data) return null;
  return asBroadcast(data as Record<string, unknown>);
}

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
