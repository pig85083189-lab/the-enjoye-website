// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineAutomationCard } from "@/features/line/automations/LineAutomationCard";
import { LineAutomationRuleEditor } from "@/features/line/automations/LineAutomationRuleEditor";
import { LINE_AUTOMATION_CATALOG } from "@/lib/line/automations/catalog";
import { LINE_AUTOMATION_SAVE_LABEL } from "@/lib/line/automations/copy";
import { createDefaultLineAutomationDraft, createDefaultLineAutomationDrafts } from "@/lib/line/automations/draft";
import { LINE_AUTOMATION_SEND_OPEN } from "@/lib/line/automations/production-safe-flags";
import {
  LINE_AUTOMATION_MISSING_RULE_CODE,
  LINE_AUTOMATION_MISSING_RULE_MESSAGE,
  LINE_AUTOMATION_TEMPLATE_MAX,
  SET_LINE_AUTOMATION_ENABLED_RPC,
  UPSERT_LINE_AUTOMATION_RULE_RPC,
  countEnabledAutomationRules,
  draftFromStoredRule,
  evaluateLineAutomationOwnerAccess,
  isMissingLineAutomationRuleError,
  mergeStoredAutomationRules,
  shouldApplyLineAutomationClientResult,
  shouldCreateDefaultRuleOnEnableError,
  validateLineAutomationRuleInput,
  validateLineAutomationTimingConfig,
  verifiedDraftFromStoredRule,
} from "@/lib/line/automations/rules";
import { LINE_AUTOMATION_RULES_MIGRATION_FILE } from "@/lib/persistence/schema-contract";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";
import type { LineActor } from "@/lib/line/line-command";

const ROOT = process.cwd();

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function owner(organizationId: string): LineActor {
  return {
    authUserId: "auth-owner",
    role: "OWNER",
    isActive: true,
    organizationId,
    userId: "staff-owner",
  };
}

describe("LINE automation rule persistence", () => {
  it("requires a logged-in owner of the same organization", () => {
    expect(evaluateLineAutomationOwnerAccess({ organizationId: ORG_ENJOYE_ID }).ok).toBe(false);
    expect(
      evaluateLineAutomationOwnerAccess({
        organizationId: ORG_ENJOYE_ID,
        actor: { ...owner(ORG_ENJOYE_ID), authUserId: null },
      }).ok,
    ).toBe(false);
    const crossOrg = evaluateLineAutomationOwnerAccess({
      organizationId: ORG_ENJOYE_ID,
      actor: owner(ORG_LUMIERE_ID),
    });
    expect(crossOrg.ok).toBe(false);
    if (!crossOrg.ok) expect(crossOrg.message).toMatch(/其他店家/);
    expect(
      evaluateLineAutomationOwnerAccess({
        organizationId: ORG_ENJOYE_ID,
        actor: { ...owner(ORG_ENJOYE_ID), role: "STAFF" },
      }).ok,
    ).toBe(false);
    expect(
      evaluateLineAutomationOwnerAccess({
        organizationId: ORG_ENJOYE_ID,
        actor: owner(ORG_ENJOYE_ID),
      }).ok,
    ).toBe(true);
  });

  it("validates type, template length, and at least one timing", () => {
    const base = {
      organizationId: ORG_ENJOYE_ID,
      actor: owner(ORG_ENJOYE_ID),
      automationType: "appointment_reminder",
      enabled: false,
      template: "預約提醒測試",
      selectedTimingIds: ["day_before_morning"],
      customTimings: [],
    };
    expect(validateLineAutomationRuleInput(base).ok).toBe(true);
    expect(validateLineAutomationRuleInput({ ...base, automationType: "unknown" }).ok).toBe(false);
    expect(validateLineAutomationRuleInput({ ...base, template: "   " }).ok).toBe(false);
    expect(
      validateLineAutomationRuleInput({
        ...base,
        template: "x".repeat(LINE_AUTOMATION_TEMPLATE_MAX + 1),
      }).ok,
    ).toBe(false);
    expect(validateLineAutomationRuleInput({ ...base, selectedTimingIds: [] }).ok).toBe(false);
    expect(
      validateLineAutomationRuleInput({
        ...base,
        selectedTimingIds: ["not_a_catalog_timing"],
      }).ok,
    ).toBe(false);
    expect(
      validateLineAutomationRuleInput({
        ...base,
        selectedTimingIds: ["day_before_morning", "birthday_morning"],
      }).ok,
    ).toBe(false);
    expect(
      validateLineAutomationRuleInput({
        ...base,
        selectedTimingIds: ["day_before_morning", "day_before_morning"],
      }).ok,
    ).toBe(false);
    const enabled = validateLineAutomationRuleInput({ ...base, enabled: true });
    expect(enabled.ok && enabled.draft.enabled).toBe(true);
  });

  it("rejects invalid, duplicate, or foreign timing settings", () => {
    const validCustom = { id: "custom_1_night", label: "前一晚", builtin: false as const };
    expect(
      validateLineAutomationTimingConfig({
        automationType: "appointment_reminder",
        selectedTimingIds: ["day_before_morning"],
        customTimings: [],
      }).ok,
    ).toBe(true);
    expect(
      validateLineAutomationTimingConfig({
        automationType: "appointment_reminder",
        selectedTimingIds: ["day_before_morning", validCustom.id],
        customTimings: [validCustom],
      }).ok,
    ).toBe(true);
    expect(
      validateLineAutomationTimingConfig({
        automationType: "appointment_reminder",
        selectedTimingIds: "day_before_morning",
        customTimings: [],
      }).ok,
    ).toBe(false);
    expect(
      validateLineAutomationTimingConfig({
        automationType: "appointment_reminder",
        selectedTimingIds: ["day_before_morning"],
        customTimings: { id: "custom_1_night" },
      }).ok,
    ).toBe(false);
    expect(
      validateLineAutomationTimingConfig({
        automationType: "appointment_reminder",
        selectedTimingIds: ["birthday_morning"],
        customTimings: [],
      }).ok,
    ).toBe(false);
    expect(
      validateLineAutomationTimingConfig({
        automationType: "appointment_reminder",
        selectedTimingIds: ["hours_before_3", "hours_before_3"],
        customTimings: [],
      }).ok,
    ).toBe(false);
    expect(
      validateLineAutomationTimingConfig({
        automationType: "appointment_reminder",
        selectedTimingIds: ["day_before_morning"],
        customTimings: [{ id: "custom_1_night", label: "前一晚", builtin: true }],
      }).ok,
    ).toBe(false);
    expect(
      validateLineAutomationTimingConfig({
        automationType: "appointment_reminder",
        selectedTimingIds: ["day_before_morning"],
        customTimings: [{ id: "hours_before_3", label: "覆寫內建", builtin: false }],
      }).ok,
    ).toBe(false);
    expect(
      validateLineAutomationTimingConfig({
        automationType: "appointment_reminder",
        selectedTimingIds: ["custom_1_night"],
        customTimings: [
          validCustom,
          { id: "custom_1_night", label: "重複", builtin: false },
        ],
      }).ok,
    ).toBe(false);
    expect(
      validateLineAutomationTimingConfig({
        automationType: "appointment_reminder",
        selectedTimingIds: ["day_before_morning"],
        customTimings: [
          { id: "custom_1", label: "一", builtin: false },
          { id: "custom_2", label: "二", builtin: false },
          { id: "custom_3", label: "三", builtin: false },
          { id: "custom_4", label: "四", builtin: false },
        ],
      }).ok,
    ).toBe(false);
  });

  it("only treats a confirmed missing rule as create-default, and keeps stored drafts intact", () => {
    expect(
      isMissingLineAutomationRuleError({
        code: LINE_AUTOMATION_MISSING_RULE_CODE,
        message: LINE_AUTOMATION_MISSING_RULE_MESSAGE,
      }),
    ).toBe(true);
    expect(shouldCreateDefaultRuleOnEnableError({ code: "P0002", message: "missing rule" })).toBe(
      true,
    );
    expect(shouldCreateDefaultRuleOnEnableError({ code: "42501", message: "unauthorized" })).toBe(
      false,
    );
    expect(shouldCreateDefaultRuleOnEnableError({ code: "22023", message: "invalid timing" })).toBe(
      false,
    );
    expect(shouldCreateDefaultRuleOnEnableError({ message: "Failed to fetch" })).toBe(false);
    expect(shouldCreateDefaultRuleOnEnableError({ code: "42P01", message: "missing rule" })).toBe(
      false,
    );
    expect(shouldCreateDefaultRuleOnEnableError(null)).toBe(false);

    const stored = verifiedDraftFromStoredRule({
      organizationId: ORG_ENJOYE_ID,
      automationType: "appointment_reminder",
      enabled: true,
      timingConfig: {
        selectedTimingIds: ["hours_before_3"],
        customTimings: [],
      },
      template: "已儲存的預約提醒",
    });
    expect(stored).toEqual({
      id: "appointment_reminder",
      enabled: true,
      selectedTimingIds: ["hours_before_3"],
      customTimings: [],
      template: "已儲存的預約提醒",
    });
    expect(
      verifiedDraftFromStoredRule({
        organizationId: ORG_ENJOYE_ID,
        automationType: "appointment_reminder",
        enabled: true,
        timingConfig: { selectedTimingIds: ["birthday_morning"], customTimings: [] },
        template: "錯誤時間",
      }),
    ).toBeNull();
  });

  it("ignores stale client results after the organization changes", () => {
    expect(
      shouldApplyLineAutomationClientResult({
        requestOrganizationId: ORG_ENJOYE_ID,
        activeOrganizationId: ORG_ENJOYE_ID,
      }),
    ).toBe(true);
    expect(
      shouldApplyLineAutomationClientResult({
        requestOrganizationId: ORG_ENJOYE_ID,
        activeOrganizationId: ORG_LUMIERE_ID,
      }),
    ).toBe(false);
    expect(
      shouldApplyLineAutomationClientResult({
        requestOrganizationId: ORG_LUMIERE_ID,
        activeOrganizationId: ORG_ENJOYE_ID,
      }),
    ).toBe(false);
    expect(
      shouldApplyLineAutomationClientResult({
        requestOrganizationId: "",
        activeOrganizationId: ORG_ENJOYE_ID,
      }),
    ).toBe(false);
  });

  it("keeps organizations isolated and defaults invalid stored rows off", () => {
    const enjoye = mergeStoredAutomationRules(
      [
        {
          organizationId: ORG_ENJOYE_ID,
          automationType: "birthday_greeting",
          enabled: true,
          timingConfig: {
            selectedTimingIds: ["birthday_morning"],
            customTimings: [],
          },
          template: "生日快樂",
        },
        {
          organizationId: ORG_LUMIERE_ID,
          automationType: "coupon_expiry",
          enabled: true,
          timingConfig: {
            selectedTimingIds: ["days_before_7"],
            customTimings: [],
          },
          template: "不應出現在享悅",
        },
      ],
      ORG_ENJOYE_ID,
    );
    expect(enjoye.birthday_greeting.enabled).toBe(true);
    expect(enjoye.birthday_greeting.template).toBe("生日快樂");
    expect(enjoye.coupon_expiry.enabled).toBe(false);
    expect(enjoye.coupon_expiry.template).not.toBe("不應出現在享悅");
    expect(countEnabledAutomationRules(enjoye)).toBe(1);

    const invalid = draftFromStoredRule({
      organizationId: ORG_ENJOYE_ID,
      automationType: "holiday_greeting",
      enabled: true,
      timingConfig: { selectedTimingIds: [], customTimings: [] },
      template: "",
    });
    expect(invalid.enabled).toBe(false);
    expect(invalid.template).toBe(createDefaultLineAutomationDraft("holiday_greeting").template);
  });

  it("wires the existing editor and cards without opening send", () => {
    expect(LINE_AUTOMATION_SEND_OPEN).toBe(false);
    expect(UPSERT_LINE_AUTOMATION_RULE_RPC).toBe("upsert_line_automation_rule");
    expect(SET_LINE_AUTOMATION_ENABLED_RPC).toBe("set_line_automation_enabled");
    expect(createDefaultLineAutomationDrafts().appointment_reminder.enabled).toBe(false);

    const definition = LINE_AUTOMATION_CATALOG[0]!;
    const draft = createDefaultLineAutomationDraft(definition.id);
    const editor = renderToStaticMarkup(
      createElement(LineAutomationRuleEditor, {
        definition,
        draft,
        organizationId: ORG_ENJOYE_ID,
        onClose: () => undefined,
      }),
    );
    expect(editor).toContain(LINE_AUTOMATION_SAVE_LABEL);
    expect(editor).toContain(draft.template);
    expect(editor).toContain("data-line-automation-editor-template");
    expect(editor).not.toContain("readOnly");
    expect(editor).not.toMatch(/api\.line\.me|multicast|cron/i);

    const enabledCard = renderToStaticMarkup(
      createElement(LineAutomationCard, {
        definition,
        draft: { ...draft, enabled: true },
        onOpenSettings: () => undefined,
        onToggle: () => undefined,
      }),
    );
    expect(enabledCard).toContain('data-checked="true"');
    expect(enabledCard).not.toMatch(
      /<button[^>]*data-line-automation-switch="true"[^>]*\sdisabled[\s>]|<button[^>]*\sdisabled[\s>][^>]*data-line-automation-switch/,
    );
  });

  it("adds an owner-only settings table and never touches Broadcast or send", () => {
    const sql = source(LINE_AUTOMATION_RULES_MIGRATION_FILE);
    const actions = source("lib/line/automations/actions.ts");
    const flags = source("lib/line/automations/production-safe-flags.ts");
    expect(sql).toMatch(/create table if not exists public\.line_automation_rules/);
    expect(sql).toMatch(/unique \(organization_id, automation_type\)/);
    expect(sql).toMatch(/enabled boolean not null default false/);
    expect(sql).toMatch(/automation_id/);
    expect(sql).toMatch(/timing_ids/);
    expect(sql).toMatch(/updated_by_staff_id/);
    expect(sql).toMatch(/add column id text/);
    expect(sql).toMatch(/add column automation_type text/);
    expect(sql).toMatch(/add column timing_config jsonb/);
    expect(sql).toMatch(/add column message_template text/);
    expect(sql).toMatch(/line_automation_rules_sync_legacy_columns/);
    expect(sql).toMatch(/set automation_type = automation_id/);
    expect(sql).toMatch(/set message_template = coalesce\(template, ''\)/);
    expect(sql).not.toMatch(/drop table public\.line_automation_rules/i);
    expect(sql).not.toMatch(/\btruncate\s+table\b/i);
    expect(sql).not.toMatch(/delete from public\.line_automation_rules/i);
    expect(sql).not.toMatch(/create or replace function public\.upsert_line_appointment_reminder_rule/i);
    expect(sql).not.toMatch(/create or replace function public\.read_line_appointment_reminder_workspace/i);
    expect(sql).not.toMatch(/drop function(?: if exists)? public\.upsert_line_appointment_reminder_rule/i);
    expect(sql).not.toMatch(/drop function(?: if exists)? public\.read_line_appointment_reminder_workspace/i);
    expect(sql).toMatch(/user_is_org_owner\(organization_id\)/);
    expect(sql).toMatch(/revoke all on public\.line_automation_rules/);
    expect(sql).toMatch(/upsert_line_automation_rule/);
    expect(sql).toMatch(/set_line_automation_enabled/);
    expect(sql).toMatch(/line_automation_timing_config_valid/);
    expect(sql).toMatch(/day_before_morning/);
    expect(sql).toMatch(/birthday_morning/);
    expect(sql).toMatch(/jsonb_array_length\(v_custom\) > 3/);
    expect(sql).toMatch(/message_template/);
    expect(sql).toMatch(/Do not apply on Production until Owner confirms/);
    expect(actions).toMatch(/shouldCreateDefaultRuleOnEnableError/);
    expect(actions).toMatch(/draftFromRpcPayload|verifiedDraftFromStoredRule/);
    expect(source("features/line/automations/LineAutomationsWorkspace.tsx")).toMatch(
      /shouldApplyLineAutomationClientResult/,
    );
    expect(source("features/line/automations/LineAutomationRuleEditor.tsx")).toMatch(
      /shouldApplyLineAutomationClientResult/,
    );
    expect(sql).not.toMatch(/line_broadcasts|line_official_account_secrets|api\.line\.me/);
    expect(sql).not.toMatch(/alter table public\.line_broadcasts|create table public\.line_broadcasts/);
    expect(actions).toMatch(/loadLineAutomationRules/);
    expect(actions).toMatch(/saveLineAutomationRule/);
    expect(actions).toMatch(/setLineAutomationEnabled/);
    expect(actions).toMatch(/LINE_AUTOMATION_SEND_OPEN !== false/);
    expect(actions).not.toMatch(/sendLineBroadcastAction|sendLineTestPushAction|api\.line\.me/);
    expect(actions).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY|channel_secret/);
    expect(flags).toMatch(/LINE_AUTOMATION_SEND_OPEN = false/);
  });

  it("upgrades the Phase 2B Preview table without dropping legacy columns or RPCs", () => {
    const sql = source(LINE_AUTOMATION_RULES_MIGRATION_FILE);
    expect(sql).toMatch(/Compatible with Preview Phase 2B table shape/);
    expect(sql).toMatch(/20261013120000_line_appointment_reminder_automation\.sql/);
    expect(sql).toMatch(/Does not DROP TABLE, DROP COLUMN, TRUNCATE, or DELETE existing rows/);
    expect(sql).toMatch(/add column id text/);
    expect(sql).toMatch(/add column automation_type text/);
    expect(sql).toMatch(/add column timing_config jsonb/);
    expect(sql).toMatch(/add column message_template text/);
    expect(sql).toMatch(/add column updated_by text/);
    expect(sql).toMatch(/where automation_type is null/);
    expect(sql).toMatch(/where message_template is null/);
    expect(sql).toMatch(/set automation_type = automation_id/);
    expect(sql).toMatch(/set message_template = coalesce\(template, ''\)/);
    expect(sql).toMatch(/to_jsonb\(coalesce\(timing_ids/);
    expect(sql).toMatch(/set updated_by = updated_by_staff_id/);
    expect(sql).toMatch(/drop constraint if exists line_automation_rules_id_check/);
    expect(sql).toMatch(/drop constraint if exists line_automation_rules_timing_check/);
    expect(sql).toMatch(/automation_id is null\s+or automation_id in \(/);
    expect(sql).toMatch(
      /timing_ids <@ array\['day_before_morning', 'hours_before_3'\]::text\[\]/,
    );
    expect(sql).toMatch(/is distinct from 'appointment_reminder'/);
    expect(sql).toMatch(/where t in \('day_before_morning', 'hours_before_3'\)/);
    expect(sql).toMatch(/comment on function public\.upsert_line_automation_rule\(text, text, boolean, jsonb, text\)/);
    expect(sql).toMatch(/comment on function public\.set_line_automation_enabled\(text, text, boolean\)/);
    expect(sql).toMatch(/comment on function public\.line_automation_timing_config_valid\(text, jsonb\)/);
    expect(sql).toMatch(/upsert_line_appointment_reminder_rule\(text, boolean, text\[\], text, text\)/);
    expect(sql).toMatch(/read_line_appointment_reminder_workspace\(text\)/);
    expect(sql).toMatch(/automation_id = p_automation_type/);
    expect(sql).toMatch(/timing_ids = excluded\.timing_ids/);
    expect(sql).toMatch(/template = excluded\.template/);
    expect(sql).toMatch(/updated_by_staff_id = excluded\.updated_by_staff_id/);
    expect(sql).toMatch(/or automation_id = p_automation_type/);
    expect(sql).toMatch(/and automation_id = v_row\.automation_id/);
    expect(sql).toMatch(/to_regclass\('public\.line_automation_jobs'\)/);
    expect(sql).not.toMatch(/drop table public\.line_automation_rules/i);
    expect(sql).not.toMatch(/drop column/i);
    expect(sql).not.toMatch(/create or replace function public\.upsert_line_appointment_reminder_rule/i);
    expect(sql).not.toMatch(/create or replace function public\.read_line_appointment_reminder_workspace/i);
    expect(sql).not.toMatch(/create or replace function public\.sync_line_appointment_reminder_jobs/i);
    expect(sql).not.toMatch(/drop function(?: if exists)? public\.upsert_line_appointment_reminder_rule/i);
    expect(sql).not.toMatch(/drop function(?: if exists)? public\.read_line_appointment_reminder_workspace/i);
  });
});
