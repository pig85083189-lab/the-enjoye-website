// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineAutomationCard } from "@/features/line/automations/LineAutomationCard";
import { LineAutomationPhonePreview } from "@/features/line/automations/LineAutomationPhonePreview";
import { LineAutomationMonthlyStats } from "@/features/line/automations/LineAutomationStats";
import { canShowLineAutomations, LINE_AUTOMATION_ROLES } from "@/lib/line/automations/access";
import { LINE_AUTOMATION_CATALOG, LINE_AUTOMATION_TABS } from "@/lib/line/automations/catalog";
import {
  LINE_AUTOMATION_EMPTY_STAT,
  LINE_AUTOMATION_LOCAL_ONLY_BADGE,
  LINE_AUTOMATION_NOT_LIVE_HINT,
  LINE_AUTOMATION_STATS_EMPTY_HINT,
} from "@/lib/line/automations/copy";
import {
  addLineAutomationCustomTiming,
  allLineAutomationsDefaultOff,
  applyLineAutomationEditor,
  createDefaultLineAutomationDrafts,
  createEmptyLineAutomationStats,
  formatLineAutomationStat,
  resetLineAutomationDraftsOnOrganizationChange,
  setLineAutomationEnabled,
} from "@/lib/line/automations/draft";
import { STAFF_LINE_ROLES } from "@/lib/staff/staff-role-page-access";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";

const ROOT = process.cwd();

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const AUTOMATION_FILES = [
  "app/staff/(app)/line/automations/page.tsx",
  "app/staff/(app)/line/layout.tsx",
  "features/line/automations/LineAutomationsWorkspace.tsx",
  "features/line/automations/LineAutomationCard.tsx",
  "features/line/automations/LineAutomationRuleEditor.tsx",
  "features/line/automations/LineAutomationPhonePreview.tsx",
  "features/line/automations/LineAutomationStats.tsx",
  "features/line/automations/LineAutomationSwitch.tsx",
  "lib/line/automations/access.ts",
  "lib/line/automations/catalog.ts",
  "lib/line/automations/copy.ts",
  "lib/line/automations/draft.ts",
  "lib/line/automations/types.ts",
] as const;

describe("LINE automation catalog and draft defaults", () => {
  it("defines five automations and keeps every send switch off", () => {
    expect(LINE_AUTOMATION_CATALOG.map((item) => item.id)).toEqual([
      "appointment_reminder",
      "birthday_greeting",
      "holiday_greeting",
      "satisfaction_survey",
      "coupon_expiry",
    ]);
    const drafts = createDefaultLineAutomationDrafts();
    expect(allLineAutomationsDefaultOff(drafts)).toBe(true);
    expect(Object.values(drafts).every((row) => row.enabled === false)).toBe(true);
  });

  it("resets local drafts when the organization changes", () => {
    const enabled = setLineAutomationEnabled(
      createDefaultLineAutomationDrafts(),
      "appointment_reminder",
      true,
    );
    expect(enabled.appointment_reminder.enabled).toBe(true);
    const sameOrg = resetLineAutomationDraftsOnOrganizationChange({
      previousOrganizationId: ORG_ENJOYE_ID,
      nextOrganizationId: ORG_ENJOYE_ID,
      drafts: enabled,
    });
    expect(sameOrg.reset).toBe(false);
    expect(sameOrg.drafts.appointment_reminder.enabled).toBe(true);
    const switched = resetLineAutomationDraftsOnOrganizationChange({
      previousOrganizationId: ORG_ENJOYE_ID,
      nextOrganizationId: ORG_LUMIERE_ID,
      drafts: enabled,
    });
    expect(switched.reset).toBe(true);
    expect(allLineAutomationsDefaultOff(switched.drafts)).toBe(true);
  });

  it("keeps custom timings local and never invents monthly stats", () => {
    const drafts = createDefaultLineAutomationDrafts();
    const withCustom = addLineAutomationCustomTiming(
      drafts.appointment_reminder,
      "預約前6小時",
    );
    const applied = applyLineAutomationEditor(drafts, {
      ...withCustom,
      template: "本機預覽文字",
    });
    expect(applied.appointment_reminder.customTimings).toHaveLength(1);
    expect(applied.appointment_reminder.template).toBe("本機預覽文字");
    const stats = createEmptyLineAutomationStats();
    expect(stats).toEqual({
      sentThisMonth: null,
      plannedThisMonth: null,
      successRate: null,
      pendingTasks: null,
    });
    expect(formatLineAutomationStat(null)).toBe(LINE_AUTOMATION_EMPTY_STAT);
  });
});

describe("LINE automation access and page wiring", () => {
  it("is Owner-only and reuses the staff role page gate", () => {
    expect(LINE_AUTOMATION_ROLES).toEqual(["OWNER"]);
    expect(STAFF_LINE_ROLES).toEqual(["OWNER"]);
    expect(canShowLineAutomations({ role: "OWNER", isActive: true })).toBe(true);
    for (const role of ["MANAGER", "STAFF", "RECEPTIONIST", "ACCOUNTANT"] as const) {
      expect(canShowLineAutomations({ role, isActive: true })).toBe(false);
    }
    expect(canShowLineAutomations({ role: "OWNER", isActive: false })).toBe(false);
    expect(source("app/staff/(app)/line/layout.tsx")).toMatch(/STAFF_LINE_ROLES/);
    expect(source("app/staff/(app)/line/automations/page.tsx")).toMatch(
      /LineAutomationsWorkspace/,
    );
  });

  it("renders default-off cards, empty stats, and a phone preview", () => {
    const definition = LINE_AUTOMATION_CATALOG[0];
    const draft = createDefaultLineAutomationDrafts()[definition.id];
    const card = renderToStaticMarkup(
      createElement(LineAutomationCard, {
        definition,
        draft,
        onToggle: () => undefined,
        onOpenSettings: () => undefined,
      }),
    );
    expect(card).toContain(definition.title);
    expect(card).toContain(LINE_AUTOMATION_LOCAL_ONLY_BADGE);
    expect(card).toContain('data-checked="false"');
    expect(card).not.toMatch(/>28<|>12<|>51</);

    const preview = renderToStaticMarkup(
      createElement(LineAutomationPhonePreview, {
        officialName: "THE ENJOYE",
        templateTitle: definition.previewTitle,
        textBody: definition.demoTemplate,
        quickReplies: definition.quickReplies,
        selectedId: definition.id,
      }),
    );
    expect(preview).toContain("訊息範本預覽");
    expect(preview).toContain("我要改期");

    const stats = renderToStaticMarkup(
      createElement(LineAutomationMonthlyStats, {
        stats: createEmptyLineAutomationStats(),
      }),
    );
    expect(stats).toContain(LINE_AUTOMATION_STATS_EMPTY_HINT);
    expect(stats).toContain(LINE_AUTOMATION_EMPTY_STAT);
    expect(stats).not.toContain("+35%");
    expect(LINE_AUTOMATION_TABS.map((tab) => tab.id)).toContain("history");
  });
});

describe("LINE automation safety", () => {
  it("does not call LINE send APIs, persist drafts, or add migrations", () => {
    const joined = AUTOMATION_FILES.map((file) => source(file)).join("\n");
    expect(joined).toMatch(/尚未正式啟用|不會發送 LINE 訊息/);
    expect(joined).toContain(LINE_AUTOMATION_NOT_LIVE_HINT);
    expect(joined).not.toMatch(/api\.line\.me|\/v2\/bot\/message/);
    expect(joined).not.toMatch(/sendLineBroadcastAction|sendLineTestPushAction/);
    expect(joined).not.toMatch(/multicast|LINE_BROADCAST_SEND_OPEN|LINE_TEST_PUSH_OPEN/);
    expect(joined).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(joined).not.toMatch(/localStorage|indexedDB/);
    expect(source("features/line/automations/LineAutomationsWorkspace.tsx")).not.toMatch(
      /loadLineOfficialAccountAction|loadLineBroadcastPrepareAction/,
    );
  });
});
