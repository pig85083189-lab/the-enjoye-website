// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OWNER_SELF_FORBIDDEN_APPOINTMENT_ID,
  OWNER_SELF_FORBIDDEN_FAKE_CUSTOMER_ID,
  OWNER_SELF_PREVIEW_SUPABASE_HOST,
  OWNER_SELF_PRODUCTION_ORG_ID,
  evaluateOwnerSelfProductionGrant,
  evaluateOwnerSelfProductionIdentity,
  evaluateOwnerSelfProductionOneshot,
  evaluateOwnerSelfProductionRuntime,
  evaluateOwnerSelfProductionSend,
  ownerSelfProductionFlagsClosed,
} from "@/lib/line/automations/appointment-reminder-owner-self-production";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import { unknownLineQuota } from "@/lib/line/line-quota";
import { ORG_BEAUTY_OS_TEST_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";

const ROOT = process.cwd();
function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const enjoyeOwner = {
  organizationId: OWNER_SELF_PRODUCTION_ORG_ID,
  staffUserId: "staff-001",
  role: "OWNER",
  isActive: true,
};

const enjoyeBind = {
  organizationId: OWNER_SELF_PRODUCTION_ORG_ID,
  staffUserId: "staff-001",
  bindMethod: "webhook_code",
  hint: "••••fc8c",
  boundAt: "2026-10-16T00:00:00.000Z",
  keyId: "line-cred-v1",
  webhookVerified: true,
};

describe("Phase 2F-1 Production Owner-self design", () => {
  it("keeps every send and persist flag closed", () => {
    expect(ownerSelfProductionFlagsClosed()).toBe(true);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
  });

  it("refuses Preview runtime identity and Preview host", () => {
    expect(
      evaluateOwnerSelfProductionRuntime({
        supabaseHost: OWNER_SELF_PREVIEW_SUPABASE_HOST,
        runtime: "preview",
        vercelEnv: "preview",
      }).reason,
    ).toBe("send_closed");
    expect(
      evaluateOwnerSelfProductionRuntime({
        supabaseHost: "knccefcxncglgpmvgqlp.supabase.co",
        runtime: "production",
        vercelEnv: "production",
      }).ok,
    ).toBe(true);
  });

  it("isolates THE ENJOYE Owner and refuses Preview TEST or other shops", () => {
    expect(evaluateOwnerSelfProductionIdentity({ actor: enjoyeOwner, bind: enjoyeBind }).ok).toBe(
      true,
    );
    expect(
      evaluateOwnerSelfProductionIdentity({
        actor: { ...enjoyeOwner, organizationId: ORG_BEAUTY_OS_TEST_ID },
        bind: { ...enjoyeBind, organizationId: ORG_BEAUTY_OS_TEST_ID },
      }).reason,
    ).toBe("unauthorized");
    expect(
      evaluateOwnerSelfProductionIdentity({
        actor: { ...enjoyeOwner, organizationId: ORG_LUMIERE_ID },
        bind: { ...enjoyeBind, organizationId: ORG_LUMIERE_ID },
      }).reason,
    ).toBe("unauthorized");
  });

  it("refuses missing independent consent and fake bind or fake appointment", () => {
    expect(
      evaluateOwnerSelfProductionGrant({
        actor: enjoyeOwner,
        bind: enjoyeBind,
        acknowledgedOnceOnly: false,
      }).reason,
    ).toBe("not_consented");
    expect(
      evaluateOwnerSelfProductionGrant({
        actor: enjoyeOwner,
        bind: { ...enjoyeBind, bindMethod: "manual", webhookVerified: false },
        acknowledgedOnceOnly: true,
      }).reason,
    ).toBe("unbound");
    expect(
      evaluateOwnerSelfProductionGrant({
        actor: enjoyeOwner,
        bind: enjoyeBind,
        acknowledgedOnceOnly: true,
        appointmentId: OWNER_SELF_FORBIDDEN_APPOINTMENT_ID,
      }).reason,
    ).toBe("invalid_input");
    expect(
      evaluateOwnerSelfProductionIdentity({
        actor: enjoyeOwner,
        bind: { ...enjoyeBind, staffUserId: OWNER_SELF_FORBIDDEN_FAKE_CUSTOMER_ID },
      }).reason,
    ).toBe("unbound");
  });

  it("refuses cross-shop actor/bind mismatch and duplicate oneshot", () => {
    expect(
      evaluateOwnerSelfProductionIdentity({
        actor: enjoyeOwner,
        bind: { ...enjoyeBind, staffUserId: "staff-999" },
      }).reason,
    ).toBe("unbound");
    expect(
      evaluateOwnerSelfProductionOneshot({
        grantOpen: true,
        grantExpired: false,
        grantRevoked: false,
        bindStillMatches: true,
        existingOpenOneshot: true,
      }).reason,
    ).toBe("duplicate");
  });

  it("refuses unknown quota, keeps Broadcast send closed, and never authorizes LINE", () => {
    const send = evaluateOwnerSelfProductionSend({
      quota: unknownLineQuota(),
      oneshotOpen: true,
      broadcastInflight: false,
    });
    expect(send.reason).toBe("quota_unknown");
    expect(send.authorized).toBe(false);
    const closed = evaluateOwnerSelfProductionSend({
      quota: {
        known: true,
        type: "none",
        limit: null,
        usage: 0,
        remaining: null,
        label: "ok",
      },
      oneshotOpen: true,
      broadcastInflight: false,
    });
    expect(closed.reason).toBe("send_closed");
    expect(closed.authorized).toBe(false);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
  });

  it("does not import Preview persist, arm, or webhook/Broadcast send changes", () => {
    const src = source("lib/line/automations/appointment-reminder-owner-self-production.ts");
    expect(src).toMatch(/OWNER_SELF_PRODUCTION_ORG_ID = ORG_ENJOYE_ID/);
    expect(src).toMatch(/OWNER_SELF_FORBIDDEN_APPOINTMENT_ID/);
    expect(src).not.toMatch(/organizationId === ORG_BEAUTY_OS_TEST_ID|ALLOWED_ORG_ID = ORG_BEAUTY_OS_TEST/);
    expect(src).not.toMatch(/arm_line_owner_self_reminder_preview|GRANT_PERSIST_OPEN = true/);
    expect(src).not.toMatch(/api\.line\.me|executeLineBroadcastHttp|multicast/);
    expect(source("lib/line/line-flag.ts")).toMatch(/LINE_BROADCAST_SEND_OPEN = false/);
    expect(source("app/api/line/webhook/[organizationId]/[publicToken]/route.ts")).toMatch(
      /processLineWebhookBind/,
    );
  });

  it("keeps the unpublished Production SQL draft off migrations and Preview fixtures", () => {
    const sql = source("supabase/drafts/20261016120000_line_owner_self_reminder_grant_production.sql");
    expect(sql).toMatch(/org-the-enjoye/);
    expect(sql).toMatch(/870121/);
    expect(sql).toMatch(/knccefcxncglgpmvgqlp\.supabase\.co/);
    expect(sql).toMatch(/'send_open', false/);
    expect(sql).toMatch(/DRAFT ONLY/);
    expect(sql).not.toMatch(/appointment_id|apt-2e7-owner-self|cust-2d2-fake-bound/);
    expect(sql).not.toMatch(/bfzquejrtgqzzarhkiya\.supabase\.co'\)\s*;/);
    expect(source("supabase/drafts/README.md")).toMatch(/Applied\?[\s\S]*No/);
    expect(source("scripts/line-owner-self-reminder-grant-production-local-pg.sh")).toMatch(
      /unix socket/,
    );
  });
});
