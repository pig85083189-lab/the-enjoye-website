/**
 * Phase 2F-2 read-only classification for official LINE webhook + Owner bind.
 * Pure helpers only. Does not call LINE, Vercel, or Supabase.
 */
export const OFFICIAL_LINE_CHANNEL_ID = "2009219238";
export const OFFICIAL_SITE_HOST = "the-enjoye-website.vercel.app";
export const PREVIEW_WEBHOOK_ALIAS_HOST =
  "the-enjoye-line-webhook-preview-pig85083189-6631s-projects.vercel.app";

export type OfficialWebhookTarget = "A_production" | "B_preview_alias" | "C_other" | "D_unknown";
export type ProductionOwnerBindVerdict = "trusted" | "untrusted" | "absent" | "unknown";

export function classifyOfficialLineWebhookUrl(url?: string | null): OfficialWebhookTarget {
  const raw = (url ?? "").trim();
  if (!raw) return "D_unknown";
  let host = "";
  let path = "";
  try {
    const parsed = new URL(raw);
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname;
  } catch {
    return "C_other";
  }
  const officialPath = path.startsWith("/api/line/webhook/org-the-enjoye/");
  if (host === OFFICIAL_SITE_HOST && officialPath) return "A_production";
  if (host === PREVIEW_WEBHOOK_ALIAS_HOST) return "B_preview_alias";
  return "C_other";
}

export function evaluateProductionOwnerBindSnapshot(input: {
  readable: boolean;
  organizationId?: string | null;
  staffUserId?: string | null;
  actorStaffUserId?: string | null;
  bindMethod?: string | null;
  hint?: string | null;
  boundAt?: string | null;
  keyId?: string | null;
  unbound?: boolean;
  blocked?: boolean;
}): ProductionOwnerBindVerdict {
  if (!input.readable) return "unknown";
  if (input.unbound || input.blocked) return "absent";
  if (!input.organizationId && !input.bindMethod && !input.hint) return "absent";
  if (input.organizationId !== "org-the-enjoye") return "untrusted";
  if (input.bindMethod !== "webhook_code") return "untrusted";
  if (!input.hint?.startsWith("••••")) return "untrusted";
  if (!input.boundAt) return "untrusted";
  if (input.keyId !== "line-cred-v1") return "untrusted";
  const actor = (input.actorStaffUserId ?? "").trim();
  const bound = (input.staffUserId ?? "").trim();
  if (!actor || !bound || actor !== bound) return "untrusted";
  return "trusted";
}

/** This agent run could not read LINE Developers or Production bind rows. */
export const PHASE_2F2_WEBHOOK_TARGET: OfficialWebhookTarget = "D_unknown";
export const PHASE_2F2_OWNER_BIND_VERDICT: ProductionOwnerBindVerdict = "unknown";

export function officialWebhookManualSteps(): string[] {
  return [
    "登入 https://developers.line.biz ，不要改任何設定。",
    "打開 Messaging API Channel 2009219238（官方帳號 ai）。",
    "進入 Messaging API 設定，只查看 Webhook URL，不要按更新或輪替 Token / Secret。",
    "若 URL 主機是 the-enjoye-website.vercel.app 且路徑是 /api/line/webhook/org-the-enjoye/… → A 正式網站。",
    "若 URL 主機是 the-enjoye-line-webhook-preview-pig85083189-6631s-projects.vercel.app → B 舊 Preview 別名。",
    "若是其他網址 → C。把遮罩後的主機與路徑回報即可，不要貼 Token。",
  ];
}

export function nextOfficialIntegrationSteps(input: {
  webhook: OfficialWebhookTarget;
  bind: ProductionOwnerBindVerdict;
}): string[] {
  if (input.webhook === "D_unknown" || input.bind === "unknown") {
    return [
      "Owner 依手動步驟回報正式 Webhook 實際指向（A / B / C）。",
      "Owner 在正式網站以 THE ENJOYE 店長登入後，再核准一次唯讀綁定檢查。",
      "在 Webhook 與本人綁定都確認前，不套用 Production SQL、不輪替 Token、不改 Developers URL。",
      "不可手寫已驗證、不可複製 Preview 身分、不可指定未驗證 LINE userId。",
    ];
  }
  if (input.webhook === "B_preview_alias") {
    return [
      "正式綁定事件仍會打到 Preview 別名，不能在正式網站完成本人驗證。",
      "下一步需 Owner 另一次核准，才把 Developers Webhook 改到正式網站同一路徑。",
      "不輪替 public token，不改 Channel Token / Secret。",
      "改 URL 前不套用 grant SQL，不建立同意。",
    ];
  }
  if (input.webhook === "C_other") {
    return [
      "Webhook 指向未知位置，先停住。",
      "不要改 URL、不要套用 SQL、不要建立授權。",
    ];
  }
  if (input.bind !== "trusted") {
    return [
      "Webhook 已指向正式網站時，用既有 public token 讓 Enjoye Owner 走官方 webhook_code 綁定。",
      "不輪替 Token，不開 bind 以外的發送開關。",
      "可信本人綁定成立後，才考慮套用 Production SQL（persist / send 仍關閉）。",
    ];
  }
  return [
    "Webhook 與可信本人綁定都已成立時，最小下一步才是套用 Production SQL 草案。",
    "SEND / OWNER_SELF_PUSH / KILL_SWITCH / Broadcast send 維持關閉。",
    "不合併 Preview PR，不複製 Preview grant / oneshot。",
  ];
}
