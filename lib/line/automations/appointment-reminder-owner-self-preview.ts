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
export const OWNER_SELF_REMINDER_GRANT_PERSIST_OPEN = false;

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
  ownerSelfObjectsMustBeAbsentBeforeApply: [
    "line_owner_self_reminder_grants",
    "line_owner_self_reminder_oneshots",
    "line_owner_self_reminder_quota_snapshots",
    "grant_line_owner_self_reminder_test",
    "claim_line_owner_self_reminder_oneshot",
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
    ownerSelfTablesPresent: false,
    phase2d3ReplayRequired: false,
  },
} as const;
