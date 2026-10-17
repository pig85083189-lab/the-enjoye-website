import { LINE_AUTOMATION_CATALOG, isLineAutomationId } from "@/lib/line/automations/catalog";
import {
  createDefaultLineAutomationDraft,
  createDefaultLineAutomationDrafts,
} from "@/lib/line/automations/draft";
import {
  LINE_AUTOMATION_IDS,
  type LineAutomationDraft,
  type LineAutomationId,
  type LineAutomationTiming,
} from "@/lib/line/automations/types";
import { canShowLineAutomations } from "@/lib/line/automations/access";
import type { LineActor, LineDecision } from "@/lib/line/line-command";

export const LINE_AUTOMATION_TEMPLATE_MAX = 5000;
export const UPSERT_LINE_AUTOMATION_RULE_RPC = "upsert_line_automation_rule";
export const SET_LINE_AUTOMATION_ENABLED_RPC = "set_line_automation_enabled";

export type LineAutomationTimingConfig = {
  selectedTimingIds: string[];
  customTimings: LineAutomationTiming[];
};

export type LineAutomationRulePublic = {
  organizationId: string;
  automationType: LineAutomationId;
  enabled: boolean;
  timingConfig: LineAutomationTimingConfig;
  template: string;
};

export type LineAutomationRuleDecision =
  | { ok: true; draft: LineAutomationDraft; timingConfig: LineAutomationTimingConfig }
  | { ok: false; reason: "unauthorized" | "invalid_input"; message: string };

function refuse(
  reason: "unauthorized" | "invalid_input",
  message: string,
): Extract<LineAutomationRuleDecision, { ok: false }> {
  return { ok: false, reason, message };
}

export function evaluateLineAutomationOwnerAccess(input: {
  organizationId?: string | null;
  actor?: LineActor | null;
}): LineDecision {
  const organizationId = (input.organizationId ?? "").trim();
  const actor = input.actor;
  if (!organizationId.startsWith("org-")) {
    return { ok: false, reason: "unauthorized", message: "缺少店家識別" };
  }
  if (!actor?.authUserId) {
    return { ok: false, reason: "unauthorized", message: "請先登入後再管理自動通知" };
  }
  if (actor.organizationId !== organizationId) {
    return { ok: false, reason: "unauthorized", message: "不能管理其他店家的自動通知" };
  }
  if (!canShowLineAutomations(actor)) {
    return { ok: false, reason: "unauthorized", message: "只有店長可以使用 LINE 自動通知" };
  }
  return { ok: true };
}

export function parseLineAutomationTimingConfig(
  value: unknown,
): LineAutomationTimingConfig | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { selectedTimingIds?: unknown; customTimings?: unknown };
  if (!Array.isArray(row.selectedTimingIds)) return null;
  const selectedTimingIds = row.selectedTimingIds.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  const customTimings = Array.isArray(row.customTimings)
    ? row.customTimings.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const timing = item as { id?: unknown; label?: unknown; builtin?: unknown };
        if (typeof timing.id !== "string" || typeof timing.label !== "string") return [];
        return [
          {
            id: timing.id,
            label: timing.label,
            builtin: timing.builtin === true,
          } satisfies LineAutomationTiming,
        ];
      })
    : [];
  return { selectedTimingIds, customTimings };
}

export function timingConfigFromDraft(draft: LineAutomationDraft): LineAutomationTimingConfig {
  return {
    selectedTimingIds: [...draft.selectedTimingIds],
    customTimings: draft.customTimings.map((item) => ({ ...item })),
  };
}

export function validateLineAutomationRuleInput(input: {
  organizationId?: string | null;
  actor?: LineActor | null;
  automationType?: string | null;
  enabled?: boolean;
  template?: string | null;
  selectedTimingIds?: string[] | null;
  customTimings?: LineAutomationTiming[] | null;
}): LineAutomationRuleDecision {
  const access = evaluateLineAutomationOwnerAccess(input);
  if (!access.ok) {
    return refuse("unauthorized", access.message);
  }
  const automationType = (input.automationType ?? "").trim();
  if (!isLineAutomationId(automationType)) {
    return refuse("invalid_input", "通知類型不正確");
  }
  const definition = LINE_AUTOMATION_CATALOG.find((item) => item.id === automationType);
  if (!definition) {
    return refuse("invalid_input", "通知類型不正確");
  }
  const template = (input.template ?? "").trim();
  if (!template) {
    return refuse("invalid_input", "請輸入訊息範本");
  }
  if (template.length > LINE_AUTOMATION_TEMPLATE_MAX) {
    return refuse("invalid_input", "訊息範本超過字數上限");
  }
  const customTimings = (input.customTimings ?? []).filter(
    (item) => item.id.trim() && item.label.trim(),
  );
  const allowedIds = new Set([
    ...definition.timings.map((item) => item.id),
    ...customTimings.map((item) => item.id),
  ]);
  const selectedTimingIds = (input.selectedTimingIds ?? []).filter((id) => allowedIds.has(id));
  if (selectedTimingIds.length === 0) {
    return refuse("invalid_input", "請至少選擇一個發送時間");
  }
  return {
    ok: true,
    draft: {
      id: automationType,
      enabled: input.enabled === true,
      selectedTimingIds,
      customTimings,
      template,
    },
    timingConfig: {
      selectedTimingIds,
      customTimings,
    },
  };
}

export function draftFromStoredRule(
  rule: LineAutomationRulePublic,
): LineAutomationDraft {
  const fallback = createDefaultLineAutomationDraft(rule.automationType);
  const validated = validateLineAutomationRuleInput({
    organizationId: rule.organizationId,
    actor: {
      authUserId: "stored",
      role: "OWNER",
      isActive: true,
      organizationId: rule.organizationId,
      userId: "staff-stored",
    },
    automationType: rule.automationType,
    enabled: rule.enabled,
    template: rule.template,
    selectedTimingIds: rule.timingConfig.selectedTimingIds,
    customTimings: rule.timingConfig.customTimings,
  });
  if (!validated.ok) {
    return { ...fallback, enabled: false };
  }
  return validated.draft;
}

export function mergeStoredAutomationRules(
  rules: readonly LineAutomationRulePublic[],
  organizationId: string,
): Record<LineAutomationId, LineAutomationDraft> {
  const drafts = createDefaultLineAutomationDrafts();
  for (const rule of rules) {
    if (rule.organizationId !== organizationId) continue;
    if (!LINE_AUTOMATION_IDS.includes(rule.automationType)) continue;
    drafts[rule.automationType] = draftFromStoredRule(rule);
  }
  return drafts;
}

export function countEnabledAutomationRules(
  drafts: Record<LineAutomationId, LineAutomationDraft>,
): number {
  return LINE_AUTOMATION_IDS.filter((id) => drafts[id]?.enabled === true).length;
}
