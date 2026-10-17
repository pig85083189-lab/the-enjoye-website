"use server";

import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import {
  countEnabledAutomationRules,
  evaluateLineAutomationOwnerAccess,
  mergeStoredAutomationRules,
  parseLineAutomationTimingConfig,
  SET_LINE_AUTOMATION_ENABLED_RPC,
  UPSERT_LINE_AUTOMATION_RULE_RPC,
  validateLineAutomationRuleInput,
  type LineAutomationRulePublic,
} from "@/lib/line/automations/rules";
import { createDefaultLineAutomationDraft } from "@/lib/line/automations/draft";
import { isLineAutomationId } from "@/lib/line/automations/catalog";
import type { LineAutomationDraft, LineAutomationId } from "@/lib/line/automations/types";
import {
  resolveVerifiedLineOrganizationId,
  type LineActor,
} from "@/lib/line/line-command";
import { LINE_AUTOMATION_SEND_OPEN } from "@/lib/line/automations/production-safe-flags";
import type { LineDecisionReason } from "@/lib/line/line-types";
import { createClient } from "@/lib/supabase/server";

export type LineAutomationActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; reason: LineDecisionReason | "invalid_input"; message: string };

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

async function loadVerifiedAutomationOrganization(requestedOrganizationId?: string | null) {
  const user = await getServerStaffAuthUser();
  const resolved = await getAuthenticatedStaffMembership({
    organizationId: requestedOrganizationId ?? undefined,
  });
  const actor = actorFromResolved(resolved, user?.id ?? null);
  const verified = resolveVerifiedLineOrganizationId({
    requestedOrganizationId,
    actor,
  });
  if (!verified.ok) return verified;
  const access = evaluateLineAutomationOwnerAccess({
    organizationId: verified.organizationId,
    actor,
  });
  if (!access.ok) return access;
  return { ok: true as const, actor, organizationId: verified.organizationId };
}

function asPublicRule(
  row: Record<string, unknown>,
  organizationId: string,
): LineAutomationRulePublic | null {
  const automationType = typeof row.automation_type === "string" ? row.automation_type : "";
  if (!isLineAutomationId(automationType)) return null;
  if (row.organization_id !== organizationId) return null;
  const timingConfig = parseLineAutomationTimingConfig(row.timing_config);
  if (!timingConfig) return null;
  const template = typeof row.message_template === "string" ? row.message_template : "";
  return {
    organizationId,
    automationType,
    enabled: row.enabled === true,
    timingConfig,
    template,
  };
}

function sendClosedGuard(): LineAutomationActionResult<never> | null {
  if (LINE_AUTOMATION_SEND_OPEN !== false) {
    return { ok: false, reason: "send_closed", message: "自動通知發送開關異常，已停止寫入" };
  }
  return null;
}

export async function loadLineAutomationRules(organizationId: string): Promise<
  LineAutomationActionResult<{
    drafts: Record<LineAutomationId, LineAutomationDraft>;
    enabledCount: number;
  }>
> {
  try {
    const closed = sendClosedGuard();
    if (closed) return closed;
    const verified = await loadVerifiedAutomationOrganization(organizationId);
    if (!verified.ok) return verified;
    const supabase = await createClient();
    const read = await supabase
      .from("line_automation_rules")
      .select("organization_id,automation_type,enabled,timing_config,message_template")
      .eq("organization_id", verified.organizationId);
    if (read.error) {
      return { ok: false, reason: "error", message: "無法讀取自動通知設定" };
    }
    const rules = (read.data ?? [])
      .map((row) => asPublicRule(row as Record<string, unknown>, verified.organizationId))
      .filter((row): row is LineAutomationRulePublic => Boolean(row));
    const drafts = mergeStoredAutomationRules(rules, verified.organizationId);
    return {
      ok: true,
      message: "ok",
      data: {
        drafts,
        enabledCount: countEnabledAutomationRules(drafts),
      },
    };
  } catch {
    return { ok: false, reason: "error", message: "無法讀取自動通知設定" };
  }
}

export async function saveLineAutomationRule(input: {
  organizationId: string;
  automationType: string;
  enabled: boolean;
  template: string;
  selectedTimingIds: string[];
  customTimings?: LineAutomationDraft["customTimings"];
}): Promise<LineAutomationActionResult<LineAutomationDraft>> {
  try {
    const closed = sendClosedGuard();
    if (closed) return closed;
    const verified = await loadVerifiedAutomationOrganization(input.organizationId);
    if (!verified.ok) return verified;
    const validated = validateLineAutomationRuleInput({
      organizationId: verified.organizationId,
      actor: verified.actor,
      automationType: input.automationType,
      enabled: input.enabled,
      template: input.template,
      selectedTimingIds: input.selectedTimingIds,
      customTimings: input.customTimings ?? [],
    });
    if (!validated.ok) return validated;
    const supabase = await createClient();
    const saved = await supabase.rpc(UPSERT_LINE_AUTOMATION_RULE_RPC, {
      p_organization_id: verified.organizationId,
      p_automation_type: validated.draft.id,
      p_enabled: validated.draft.enabled,
      p_timing_config: validated.timingConfig,
      p_message_template: validated.draft.template,
    });
    if (saved.error) {
      return { ok: false, reason: "error", message: "自動通知設定儲存失敗" };
    }
    return {
      ok: true,
      message: "設定已儲存。尚未發送 LINE。",
      data: validated.draft,
    };
  } catch {
    return { ok: false, reason: "error", message: "自動通知設定儲存失敗" };
  }
}

export async function setLineAutomationEnabled(input: {
  organizationId: string;
  automationType: string;
  enabled: boolean;
}): Promise<LineAutomationActionResult<LineAutomationDraft>> {
  try {
    const closed = sendClosedGuard();
    if (closed) return closed;
    const verified = await loadVerifiedAutomationOrganization(input.organizationId);
    if (!verified.ok) return verified;
    if (!isLineAutomationId(input.automationType)) {
      return { ok: false, reason: "invalid_input", message: "通知類型不正確" };
    }
    const supabase = await createClient();
    const updated = await supabase.rpc(SET_LINE_AUTOMATION_ENABLED_RPC, {
      p_organization_id: verified.organizationId,
      p_automation_type: input.automationType,
      p_enabled: input.enabled === true,
    });
    if (updated.error) {
      const fallback = createDefaultLineAutomationDraft(input.automationType);
      const created = await saveLineAutomationRule({
        organizationId: verified.organizationId,
        automationType: input.automationType,
        enabled: input.enabled === true,
        template: fallback.template,
        selectedTimingIds: fallback.selectedTimingIds,
        customTimings: fallback.customTimings,
      });
      return created;
    }
    const payload = updated.data && typeof updated.data === "object" ? updated.data : {};
    const row = payload as { enabled?: unknown; automation_type?: unknown };
    return {
      ok: true,
      message: input.enabled ? "已標記為啟用。尚未發送 LINE。" : "已停用此通知。",
      data: {
        ...createDefaultLineAutomationDraft(input.automationType),
        enabled: row.enabled === true,
        id: isLineAutomationId(String(row.automation_type))
          ? (row.automation_type as LineAutomationId)
          : input.automationType,
      },
    };
  } catch {
    return { ok: false, reason: "error", message: "無法更新啟用狀態" };
  }
}
