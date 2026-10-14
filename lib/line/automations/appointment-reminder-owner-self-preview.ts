/**
 * Preview-only Owner-self runtime + compatibility notes.
 * PostgreSQL cannot discover the live Supabase project ref, so SQL
 * isolation is fail-closed until a trusted server arms the identity
 * row. Session GUCs and authenticated callers cannot arm it.
 * Residual risk: applying this draft to Production and then calling
 * the service-role arm with the Preview host string would still be
 * possible if the Production GUC is unset. Never apply to Production.
 */

import {
  LINE_BROADCAST_FORMAL_PRODUCTION_SUPABASE_HOST,
  LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST,
} from "@/lib/line/line-flag";

export const OWNER_SELF_REMINDER_PREVIEW_SUPABASE_REF = "bfzquejrtgqzzarhkiya";
export const OWNER_SELF_REMINDER_PRODUCTION_SUPABASE_REF = "knccefcxncglgpmvgqlp";
export const OWNER_SELF_REMINDER_GRANT_PERSIST_OPEN = true;

export type OwnerSelfPreviewRuntimeDecision =
  | { ok: true; host: string }
  | { ok: false; reason: "send_closed"; message: string };

function hostnameOf(url?: string | null): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

export function evaluateOwnerSelfPreviewRuntime(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): OwnerSelfPreviewRuntimeDecision {
  const vercelEnv = (env.VERCEL_ENV ?? "").trim();
  const host = hostnameOf(env.NEXT_PUBLIC_SUPABASE_URL);
  if (vercelEnv === "production" || host === LINE_BROADCAST_FORMAL_PRODUCTION_SUPABASE_HOST) {
    return {
      ok: false,
      reason: "send_closed",
      message: "店長本人測試授權不可在 Production 執行",
    };
  }
  if (vercelEnv !== "preview" || host !== LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST) {
    return {
      ok: false,
      reason: "send_closed",
      message: "店長本人測試授權只允許已確認的 Preview Supabase，未設定或環境不一致時拒絕",
    };
  }
  return { ok: true, host };
}

export function confirmTrustedOwnerSelfPreviewTarget(input: {
  managementProjectId?: string | null;
  managementDbHost?: string | null;
  vercelEnv?: string | null;
  supabaseUrl?: string | null;
  linkedProjectRef?: string | null;
}): { ok: true; ref: string } | { ok: false; reason: "send_closed"; message: string } {
  const refuse = (
    message: string,
  ): { ok: false; reason: "send_closed"; message: string } => ({
    ok: false,
    reason: "send_closed",
    message,
  });
  const ref = (input.managementProjectId ?? "").trim();
  if (!ref) {
    return refuse("缺少可信的管理端 Preview 專案識別，未設定時拒絕");
  }
  if (ref === OWNER_SELF_REMINDER_PRODUCTION_SUPABASE_REF) {
    return refuse("店長本人測試授權不可在 Production 執行");
  }
  if (ref !== OWNER_SELF_REMINDER_PREVIEW_SUPABASE_REF) {
    return refuse("管理端專案識別不是指定 Preview Supabase");
  }
  const linked = (input.linkedProjectRef ?? "").trim();
  if (linked && linked !== ref) {
    return refuse("CLI 連結的專案與管理端 Preview 不一致");
  }
  const host = hostnameOf(input.supabaseUrl);
  if (host !== `${ref}.supabase.co`) {
    return refuse("環境變數 host 與管理端 Preview 專案不一致");
  }
  if ((input.vercelEnv ?? "").trim() !== "preview") {
    return refuse("部署環境不是 Preview");
  }
  const dbHost = (input.managementDbHost ?? "").trim();
  if (dbHost && dbHost !== `db.${ref}.supabase.co`) {
    return refuse("資料庫 host 不是指定 Preview");
  }
  return { ok: true, ref };
}

export const OWNER_SELF_REMINDER_PREVIEW_COMPAT = {
  previewHost: LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST,
  productionHost: LINE_BROADCAST_FORMAL_PRODUCTION_SUPABASE_HOST,
  requiredTables: [
    "staff_auth_memberships",
    "line_owner_recipients",
    "line_owner_recipient_secrets",
    "line_official_accounts",
    "line_broadcasts",
  ] as const,
  requiredFunctions: [
    "user_is_org_owner",
    "is_operational_staff_id",
    "line_broadcast_channel_has_inflight",
    "claim_line_broadcast_send",
  ] as const,
  ownerSelfObjectsInstalledOnPreview: [
    "line_owner_self_reminder_grants",
    "line_owner_self_reminder_oneshots",
    "line_owner_self_reminder_quota_snapshots",
    "line_owner_self_reminder_runtime_identity",
    "grant_line_owner_self_reminder_test",
    "claim_line_owner_self_reminder_oneshot",
    "arm_line_owner_self_reminder_preview_runtime",
  ] as const,
  phase2d3ObjectsPresentDoNotReplay: [
    "claim_line_appointment_reminder_job",
    "line_appointment_reminder_service_role_call_allowed",
    "line_automation_jobs",
  ] as const,
  readOnlyFindings: {
    host: LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST,
    ownerBind: {
      organizationId: "org-beauty-os-test",
      staffUserId: "staff-001",
      hint: "••••fc8c",
      bindMethod: "webhook_code",
      keyId: "line-cred-v1",
    },
    sharedChannelId: "2009219238",
    enjoyeSharesChannel: true,
    ownerSelfTablesPresent: true,
    ownerSelfRowsEmpty: true,
    runtimeArmed: true,
    persistOpen: true,
    appliedDraftSha256:
      "fde24612e6ab1de1678430f61edc5e40aaeb9a1cb05cebadf3f8ef24c10abffb",
    phase2d3ReplayRequired: false,
    productionUnchanged: true,
  },
} as const;
