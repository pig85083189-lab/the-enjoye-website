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
  LINE_AUTOMATION_TEMPLATE_MAX,
  SET_LINE_AUTOMATION_ENABLED_RPC,
  UPSERT_LINE_AUTOMATION_RULE_RPC,
  countEnabledAutomationRules,
  draftFromStoredRule,
  evaluateLineAutomationOwnerAccess,
  mergeStoredAutomationRules,
  validateLineAutomationRuleInput,
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
    const enabled = validateLineAutomationRuleInput({ ...base, enabled: true });
    expect(enabled.ok && enabled.draft.enabled).toBe(true);
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
    expect(sql).toMatch(/user_is_org_owner\(organization_id\)/);
    expect(sql).toMatch(/revoke all on public\.line_automation_rules/);
    expect(sql).toMatch(/upsert_line_automation_rule/);
    expect(sql).toMatch(/set_line_automation_enabled/);
    expect(sql).toMatch(/Do not apply on Production until Owner confirms/);
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
});
