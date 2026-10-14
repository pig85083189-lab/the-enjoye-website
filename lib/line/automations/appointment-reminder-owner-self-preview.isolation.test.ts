// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LINE_APPOINTMENT_REMINDER_OWNER_SELF_PUSH_OPEN,
  OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
  OWNER_SELF_REMINDER_KILL_SWITCH_OPEN,
  OWNER_SELF_REMINDER_SQL_DRAFT,
  evaluateOwnerSelfTrustedQuota,
} from "@/lib/line/automations/appointment-reminder-owner-self-push";
import {
  OWNER_SELF_REMINDER_GRANT_PERSIST_OPEN,
  OWNER_SELF_REMINDER_PREVIEW_COMPAT,
  OWNER_SELF_REMINDER_PRODUCTION_SUPABASE_REF,
  OWNER_SELF_REMINDER_PREVIEW_SUPABASE_REF,
  evaluateOwnerSelfPreviewRuntime,
} from "@/lib/line/automations/appointment-reminder-owner-self-preview";
import {
  OWNER_SELF_REMINDER_QUOTA_ADAPTER,
  OWNER_SELF_REMINDER_QUOTA_SNAPSHOT_MAX_AGE_MS,
  loadOwnerSelfReminderOfficialQuota,
  prepareOwnerSelfReminderQuotaSnapshot,
  verifyOwnerSelfReminderQuotaChannel,
} from "@/lib/line/automations/appointment-reminder-owner-self-quota";
import { LINE_APPOINTMENT_REMINDER_SEND_OPEN } from "@/lib/line/automations/appointment-reminder-flag";
import {
  LINE_BROADCAST_FORMAL_PRODUCTION_SUPABASE_HOST,
  LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST,
  LINE_BROADCAST_SEND_OPEN,
} from "@/lib/line/line-flag";
import { describeLineQuota, unknownLineQuota } from "@/lib/line/line-quota";

const ROOT = process.cwd();
const NOW = Date.parse("2026-10-14T11:40:00.000Z");

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("Phase 2E-10A Preview structure install record", () => {
  it("records Preview-only structure install without arming or persisting rows", () => {
    expect(OWNER_SELF_REMINDER_PREVIEW_SUPABASE_REF).toBe("bfzquejrtgqzzarhkiya");
    expect(OWNER_SELF_REMINDER_PRODUCTION_SUPABASE_REF).toBe("knccefcxncglgpmvgqlp");
    expect(OWNER_SELF_REMINDER_PREVIEW_COMPAT.previewHost).toBe(
      LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST,
    );
    expect(OWNER_SELF_REMINDER_PREVIEW_COMPAT.productionHost).toBe(
      LINE_BROADCAST_FORMAL_PRODUCTION_SUPABASE_HOST,
    );
    expect(OWNER_SELF_REMINDER_PREVIEW_COMPAT.readOnlyFindings.ownerSelfTablesPresent).toBe(true);
    expect(OWNER_SELF_REMINDER_PREVIEW_COMPAT.readOnlyFindings.ownerSelfRowsEmpty).toBe(true);
    expect(OWNER_SELF_REMINDER_PREVIEW_COMPAT.readOnlyFindings.runtimeArmed).toBe(false);
    expect(OWNER_SELF_REMINDER_PREVIEW_COMPAT.readOnlyFindings.persistOpen).toBe(false);
    expect(OWNER_SELF_REMINDER_PREVIEW_COMPAT.readOnlyFindings.appliedDraftSha256).toBe(
      "fde24612e6ab1de1678430f61edc5e40aaeb9a1cb05cebadf3f8ef24c10abffb",
    );
    expect(OWNER_SELF_REMINDER_PREVIEW_COMPAT.readOnlyFindings.productionUnchanged).toBe(true);
    expect(OWNER_SELF_REMINDER_PREVIEW_COMPAT.readOnlyFindings.phase2d3ReplayRequired).toBe(false);
    expect(OWNER_SELF_REMINDER_PREVIEW_COMPAT.readOnlyFindings.sharedChannelId).toBe("2009219238");
    expect(OWNER_SELF_REMINDER_PREVIEW_COMPAT.readOnlyFindings.enjoyeSharesChannel).toBe(true);
    expect(OWNER_SELF_REMINDER_PREVIEW_COMPAT.readOnlyFindings.ownerBind).toEqual({
      organizationId: "org-beauty-os-test",
      staffUserId: "staff-001",
      hint: "••••fc8c",
      bindMethod: "webhook_code",
      keyId: "line-cred-v1",
    });
    expect(OWNER_SELF_REMINDER_GRANT_PERSIST_OPEN).toBe(false);
  });

  it("fails closed unless the app server can prove Preview", () => {
    expect(
      evaluateOwnerSelfPreviewRuntime({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: `https://${LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST}`,
      }).ok,
    ).toBe(true);
    expect(
      evaluateOwnerSelfPreviewRuntime({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: `https://${LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST}`,
      }),
    ).toMatchObject({ ok: false, reason: "send_closed" });
    expect(
      evaluateOwnerSelfPreviewRuntime({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: `https://${LINE_BROADCAST_FORMAL_PRODUCTION_SUPABASE_HOST}`,
      }),
    ).toMatchObject({ ok: false, reason: "send_closed" });
    expect(evaluateOwnerSelfPreviewRuntime({})).toMatchObject({ ok: false, reason: "send_closed" });
  });

  it("designs official quota snapshots and never accepts client values", () => {
    expect(OWNER_SELF_REMINDER_QUOTA_SNAPSHOT_MAX_AGE_MS).toBe(30_000);
    expect(OWNER_SELF_REMINDER_QUOTA_ADAPTER.thisPhaseCallsLine).toBe(false);
    expect(OWNER_SELF_REMINDER_QUOTA_ADAPTER.clientQuotaAccepted).toBe(false);
    expect(OWNER_SELF_REMINDER_QUOTA_ADAPTER.testConstantsForbidden).toBe(true);
    expect(OWNER_SELF_REMINDER_QUOTA_ADAPTER.tokenSource).toBe("server_official_account_secret");
    expect(OWNER_SELF_REMINDER_QUOTA_ADAPTER.officialQuotaPath).toBe("/v2/bot/message/quota");
    expect(OWNER_SELF_REMINDER_QUOTA_ADAPTER.officialBotInfoPath).toBe("/v2/bot/info");
    expect(
      verifyOwnerSelfReminderQuotaChannel({
        channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
        botBasicId: "@357gospk",
        botDisplayName: "ai",
      }).ok,
    ).toBe(true);
    expect(
      verifyOwnerSelfReminderQuotaChannel({
        channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
        botBasicId: "@other",
      }).ok,
    ).toBe(false);
    expect(
      prepareOwnerSelfReminderQuotaSnapshot({
        channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
        quota: describeLineQuota({ type: "none", usage: 1 }),
        checkedAt: new Date(NOW).toISOString(),
        nowMs: NOW,
      }).ok,
    ).toBe(true);
    expect(
      prepareOwnerSelfReminderQuotaSnapshot({
        channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
        quota: describeLineQuota({ type: "none", usage: 1 }),
        checkedAt: new Date(NOW).toISOString(),
        clientQuota: describeLineQuota({ type: "none", usage: 1 }),
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/不能信任呼叫端自填的 LINE 額度/) });
    expect(
      prepareOwnerSelfReminderQuotaSnapshot({
        channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
        quota: unknownLineQuota("本階段不查詢 LINE 額度"),
        checkedAt: new Date(NOW).toISOString(),
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "quota_exceeded" });
    expect(
      evaluateOwnerSelfTrustedQuota({
        snapshot: null,
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "quota_exceeded" });
  });

  it("does not call LINE from the live path and keeps send closed", async () => {
    await expect(
      loadOwnerSelfReminderOfficialQuota({
        channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
      }),
    ).resolves.toMatchObject({ known: false });
    await expect(
      loadOwnerSelfReminderOfficialQuota({
        channelId: OWNER_SELF_REMINDER_ALLOWED_CHANNEL_ID,
        accessToken: "dummy-must-not-call-line",
      }),
    ).resolves.toMatchObject({ known: false });
    expect(source("lib/line/automations/appointment-reminder-owner-self-quota.ts")).not.toMatch(
      /fetchLineMessageQuota|api\.line\.me/,
    );
    const actions = source("lib/line/automations/appointment-reminder-actions.ts");
    expect(actions).toMatch(/LINE_OWNER_SELF_PERSIST_CLOSED/);
    expect(actions).toMatch(/persisted: false/);
    expect(actions).not.toMatch(
      /fetchLineMessageQuota|loadOwnerSelfReminderOfficialQuota|arm_line_owner_self_reminder_preview_runtime|grant_line_owner_self_reminder_test|claim_line_owner_self_reminder_oneshot/,
    );
    expect(source("features/line/automations/LineOwnerSelfReminderCard.tsx")).toMatch(
      /LINE_OWNER_SELF_FLOW_HINT/,
    );
    expect(source("features/line/automations/LineOwnerSelfReminderCard.tsx")).toMatch(
      /prepareOwnerSelfReminderGrantAction/,
    );
    expect(LINE_APPOINTMENT_REMINDER_SEND_OPEN).toBe(false);
    expect(LINE_APPOINTMENT_REMINDER_OWNER_SELF_PUSH_OPEN).toBe(false);
    expect(OWNER_SELF_REMINDER_KILL_SWITCH_OPEN).toBe(false);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
  });

  it("hardens the unpublished SQL draft for Preview identity and local privilege review", () => {
    const sql = source(OWNER_SELF_REMINDER_SQL_DRAFT);
    expect(sql).toMatch(/line_owner_self_reminder_runtime_identity/);
    expect(sql).toMatch(/bfzquejrtgqzzarhkiya\.supabase\.co/);
    expect(sql).toMatch(/arm_line_owner_self_reminder_preview_runtime/);
    expect(sql).toMatch(/PostgreSQL cannot discover the live project ref/);
    expect(sql).toMatch(/line_owner_self_reminder_environment_block/);
    expect(sql).not.toMatch(
      /insert into public\.line_owner_self_reminder_runtime_identity[\s\S]*values\s*\(\s*'runtime',\s*'bfzquejrtgqzzarhkiya/i,
    );
    expect(source("scripts/line-owner-self-reminder-grant-local-pg.sh")).toMatch(
      /Never connect to Preview \/ Production/,
    );
    expect(source("lib/persistence/fresh-migration-chain.isolation.test.ts")).not.toMatch(
      /20261014180000_line_owner_self_reminder_grant/,
    );
  });
});
