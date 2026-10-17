import {
  LINE_AUTOMATION_CATALOG,
  isLineAutomationId,
  lineAutomationBuiltinTimingIds,
} from "@/lib/line/automations/catalog";
import {
  LINE_AUTOMATION_MAX_CUSTOM_TIMINGS,
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
export const LINE_AUTOMATION_MISSING_RULE_CODE = "P0002";
export const LINE_AUTOMATION_MISSING_RULE_MESSAGE = "missing rule";

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

export type LineAutomationTimingDecision =
  | { ok: true; timingConfig: LineAutomationTimingConfig }
  | { ok: false; message: string };

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

function uniqueStrings(values: string[]): boolean {
  return new Set(values).size === values.length;
}

export function validateLineAutomationTimingConfig(input: {
  automationType?: string | null;
  selectedTimingIds?: unknown;
  customTimings?: unknown;
}): LineAutomationTimingDecision {
  const automationType = (input.automationType ?? "").trim();
  const builtinIds = lineAutomationBuiltinTimingIds(automationType);
  if (!builtinIds) {
    return { ok: false, message: "通知類型不正確" };
  }
  if (!Array.isArray(input.selectedTimingIds)) {
    return { ok: false, message: "發送時間設定不正確" };
  }
  if (input.customTimings != null && !Array.isArray(input.customTimings)) {
    return { ok: false, message: "自訂時間設定不正確" };
  }
  const customSource = input.customTimings ?? [];
  if (customSource.length > LINE_AUTOMATION_MAX_CUSTOM_TIMINGS) {
    return { ok: false, message: "自訂時間超過上限" };
  }
  const customTimings: LineAutomationTiming[] = [];
  for (const item of customSource) {
    if (!item || typeof item !== "object") {
      return { ok: false, message: "自訂時間設定不正確" };
    }
    const timing = item as { id?: unknown; label?: unknown; builtin?: unknown };
    if (typeof timing.id !== "string" || typeof timing.label !== "string") {
      return { ok: false, message: "自訂時間設定不正確" };
    }
    const id = timing.id.trim();
    const label = timing.label.trim();
    if (!id || !label || id !== timing.id || label !== timing.label) {
      return { ok: false, message: "自訂時間設定不正確" };
    }
    if (timing.builtin === true) {
      return { ok: false, message: "自訂時間不得標記為內建" };
    }
    if (builtinIds.includes(id)) {
      return { ok: false, message: "自訂時間不得使用內建選項" };
    }
    customTimings.push({ id, label, builtin: false });
  }
  if (!uniqueStrings(customTimings.map((item) => item.id))) {
    return { ok: false, message: "自訂時間不可重複" };
  }
  if (!uniqueStrings(customTimings.map((item) => item.label))) {
    return { ok: false, message: "自訂時間不可重複" };
  }
  const selectedTimingIds: string[] = [];
  for (const item of input.selectedTimingIds) {
    if (typeof item !== "string") {
      return { ok: false, message: "發送時間設定不正確" };
    }
    const id = item.trim();
    if (!id || id !== item) {
      return { ok: false, message: "發送時間設定不正確" };
    }
    selectedTimingIds.push(id);
  }
  if (selectedTimingIds.length === 0) {
    return { ok: false, message: "請至少選擇一個發送時間" };
  }
  if (!uniqueStrings(selectedTimingIds)) {
    return { ok: false, message: "發送時間不可重複" };
  }
  const allowed = new Set([...builtinIds, ...customTimings.map((item) => item.id)]);
  if (selectedTimingIds.some((id) => !allowed.has(id))) {
    return { ok: false, message: "發送時間不屬於此通知" };
  }
  return { ok: true, timingConfig: { selectedTimingIds, customTimings } };
}

export function parseLineAutomationTimingConfig(
  value: unknown,
): LineAutomationTimingConfig | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { selectedTimingIds?: unknown; customTimings?: unknown };
  if (!Array.isArray(row.selectedTimingIds)) return null;
  if (row.customTimings != null && !Array.isArray(row.customTimings)) return null;
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
  selectedTimingIds?: unknown;
  customTimings?: unknown;
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
  const timing = validateLineAutomationTimingConfig({
    automationType,
    selectedTimingIds: input.selectedTimingIds,
    customTimings: input.customTimings,
  });
  if (!timing.ok) {
    return refuse("invalid_input", timing.message);
  }
  return {
    ok: true,
    draft: {
      id: automationType,
      enabled: input.enabled === true,
      selectedTimingIds: timing.timingConfig.selectedTimingIds,
      customTimings: timing.timingConfig.customTimings,
      template,
    },
    timingConfig: timing.timingConfig,
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

export function verifiedDraftFromStoredRule(
  rule: LineAutomationRulePublic,
): LineAutomationDraft | null {
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
  return validated.ok ? validated.draft : null;
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

export function isMissingLineAutomationRuleError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof row.code === "string" ? row.code.trim() : "";
  const message = typeof row.message === "string" ? row.message : "";
  const details = typeof row.details === "string" ? row.details : "";
  if (code && code !== LINE_AUTOMATION_MISSING_RULE_CODE) return false;
  return (
    code === LINE_AUTOMATION_MISSING_RULE_CODE ||
    message === LINE_AUTOMATION_MISSING_RULE_MESSAGE ||
    details === LINE_AUTOMATION_MISSING_RULE_MESSAGE
  );
}

export function shouldCreateDefaultRuleOnEnableError(error: unknown): boolean {
  return isMissingLineAutomationRuleError(error);
}

export function shouldApplyLineAutomationClientResult(input: {
  requestOrganizationId?: string | null;
  activeOrganizationId?: string | null;
}): boolean {
  const requestOrganizationId = (input.requestOrganizationId ?? "").trim();
  const activeOrganizationId = (input.activeOrganizationId ?? "").trim();
  return (
    requestOrganizationId.startsWith("org-") &&
    requestOrganizationId === activeOrganizationId
  );
}
