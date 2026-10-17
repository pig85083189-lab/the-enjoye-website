// @vitest-environment node
import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineCustomerBindingsCard } from "@/features/line/automations/LineCustomerBindingsCard";
import {
  evaluateLineAutomationSendRecipient,
  evaluateLineCustomerBindStart,
  isTrustedCustomerBinding,
  mapLineCustomerBindingRows,
  verifiedBindingCustomerIds,
} from "@/lib/line/automations/customer-bindings";
import { LINE_AUTOMATION_SEND_OPEN } from "@/lib/line/automations/production-safe-flags";
import { LINE_CUSTOMER_BINDINGS_MIGRATION_FILE } from "@/lib/persistence/schema-contract";
import type { LineActor } from "@/lib/line/line-command";
import {
  createLineCustomerBindServerProof,
  deriveLineCustomerBindHmacKey,
  hashLineUserId,
} from "@/lib/line/line-bind";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";

const ROOT = process.cwd();

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function executableSql(rel: string): string {
  return source(rel)
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
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

describe("LINE customer bindings", () => {
  it("starts a bind only after owner in-person identity confirmation", () => {
    expect(
      evaluateLineCustomerBindStart({
        connectionPilotEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        actor: owner(ORG_ENJOYE_ID),
        secretConfigured: true,
        customerId: "cust-1",
      }).ok,
    ).toBe(false);
    expect(
      evaluateLineCustomerBindStart({
        connectionPilotEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        actor: owner(ORG_ENJOYE_ID),
        secretConfigured: true,
        customerId: "cust-1",
        identityConfirmed: true,
      }).ok,
    ).toBe(true);
    expect(
      evaluateLineCustomerBindStart({
        connectionPilotEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        actor: owner(ORG_LUMIERE_ID),
        secretConfigured: true,
        customerId: "cust-1",
        identityConfirmed: true,
      }).ok,
    ).toBe(false);
    expect(
      evaluateLineCustomerBindStart({
        connectionPilotEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        actor: { ...owner(ORG_ENJOYE_ID), role: "STAFF" },
        secretConfigured: true,
        customerId: "cust-1",
        identityConfirmed: true,
      }).ok,
    ).toBe(false);
  });

  it("treats only owner-confirmed active bindings as trusted recipients", () => {
    expect(isTrustedCustomerBinding({ verified: true, status: "active" })).toBe(false);
    expect(
      isTrustedCustomerBinding({
        verified: true,
        status: "active",
        confirmedAt: "2026-10-17T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(isTrustedCustomerBinding({ verified: false, status: "pending" })).toBe(false);
    expect(
      evaluateLineAutomationSendRecipient({
        jobStatus: "scheduled",
        binding: { verified: false, status: "pending" },
      }).ok,
    ).toBe(false);
    expect(
      evaluateLineAutomationSendRecipient({
        jobStatus: "scheduled",
        binding: null,
      }).ok,
    ).toBe(false);

    const mapped = mapLineCustomerBindingRows(ORG_ENJOYE_ID, {
      organization_id: ORG_ENJOYE_ID,
      customers: [
        {
          customer_id: "cust-1",
          display_name: "小美",
          binding: {
            hint: "••••abcd",
            verified: true,
            status: "active",
            bound_at: "2026-10-17T00:00:00.000Z",
            confirmed_at: "2026-10-17T00:00:00.000Z",
          },
        },
        {
          customer_id: "cust-2",
          binding: { hint: "••••zzzz", verified: false, status: "pending" },
        },
      ],
    });
    expect(verifiedBindingCustomerIds(mapped)).toEqual(new Set(["cust-1"]));
  });

  it("does not accept a client-supplied LINE user id as verified", () => {
    const actions = source("lib/line/automations/customer-binding-actions.ts");
    const helpers = source("lib/line/automations/customer-bindings.ts");
    const webhook = source("lib/line/line-webhook.ts");
    const route = source("app/api/line/webhook/[organizationId]/[publicToken]/route.ts");
    const ui = source("features/line/automations/LineCustomerBindingsCard.tsx");
    expect(actions).not.toMatch(/lineUserId|p_line_user_id[^_]/);
    expect(actions).toMatch(/不要輸入 User ID/);
    expect(actions).toMatch(/identityConfirmed/);
    expect(actions).toMatch(/createLineCustomerBindServerProof|deriveLineCustomerBindHmacKey/);
    expect(helpers).not.toMatch(/customers\.line_user_id/);
    expect(webhook).toMatch(/hashLineUserId\(candidate\.userId\)/);
    expect(route).toMatch(/createLineCustomerBindServerProof/);
    expect(route).toMatch(/p_proof/);
    expect(route).toMatch(/p_event_id/);
    expect(ui).not.toMatch(/type="text"/i);
    expect(ui).toMatch(/type="checkbox"/);
    const userId = "U" + "a".repeat(32);
    expect(hashLineUserId(userId)).toMatch(/^[0-9a-f]{64}$/);
    const proof = createLineCustomerBindServerProof({
      channelSecret: "channel-secret",
      organizationId: ORG_ENJOYE_ID,
      publicToken: "token-local-token-local-token-local",
      eventId: "evt-1",
      code: "ABCDEF12",
      userIdHash: hashLineUserId(userId),
      cipher: "v1.cipher",
      hint: "••••aaaa",
      keyId: "line-cred-v1",
      issuedAt: new Date("2026-10-17T00:00:00.000Z"),
    });
    expect(proof.proofHex).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveLineCustomerBindHmacKey("channel-secret", ORG_ENJOYE_ID)).not.toBe(
      deriveLineCustomerBindHmacKey("channel-secret", ORG_LUMIERE_ID),
    );
  });

  it("keeps the owner bindings card from editing verified LINE identity", () => {
    const markup = renderToStaticMarkup(
      createElement(LineCustomerBindingsCard, { organizationId: ORG_ENJOYE_ID }),
    );
    expect(markup).toContain("顧客 LINE 綁定");
    expect(markup).toContain("不能手填 User ID");
    expect(markup).toContain("已驗證的 LINE 識別不可手動修改");
    expect(source("features/line/automations/LineCustomerBindingsCard.tsx")).toContain(
      "LINE_CUSTOMER_BIND_IDENTITY",
    );
    expect(source("features/line/automations/LineCustomerBindingsCard.tsx")).toContain(
      "LINE_CUSTOMER_BIND_CANCEL_REBIND",
    );
    expect(markup).not.toMatch(/<input[^>]*type="text"/i);
    expect(source("features/line/automations/LineAutomationsWorkspace.tsx")).toMatch(
      /LineCustomerBindingsCard/,
    );
  });

  it("locks send, cron, Broadcast, and anonymous trusted bind in the binding migration", () => {
    const sql = executableSql(LINE_CUSTOMER_BINDINGS_MIGRATION_FILE);
    expect(LINE_AUTOMATION_SEND_OPEN).toBe(false);
    expect(sql).toMatch(/line_customer_bind_challenge_secrets/);
    expect(sql).toMatch(/line_customer_binding_rebinds/);
    expect(sql).toMatch(/pending_expires_at/);
    expect(sql).toMatch(/cancel_line_customer_rebind/);
    expect(sql).toMatch(/p_identity_confirmed/);
    expect(sql).toMatch(/p_proof/);
    expect(sql).toMatch(/confirm_line_customer_binding/);
    expect(sql).toMatch(/line_automation_send_recipient_allowed/);
    expect(sql).toMatch(/where line_customer_bindings\.status is distinct from 'active'/);
    expect(sql).toMatch(/failed_attempts/);
    expect(sql).toMatch(/interval '2 seconds'/);
    expect(sql).toMatch(/p_line_user_id_cipher \|\| chr\(10\)/);
    expect(sql).toMatch(/revoke all on public\.line_customer_bind_challenge_secrets/);
    expect(sql).not.toMatch(/grant select on public\.line_customer_binding_secrets/);
    expect(sql).not.toMatch(/grant select on public\.line_customer_bind_challenge_secrets/);
    expect(sql).not.toMatch(/grant select on public\.line_customer_binding_rebinds/);
    expect(sql).toMatch(/revoke all on public\.line_customer_binding_rebinds/);
    expect(sql).toMatch(/grant execute on function public\.consume_line_customer_bind_challenge_public/);
    expect(sql).toMatch(/revoke all on function public\.consume_line_customer_bind_challenge_public[\s\S]*from public, authenticated/);
    expect(sql).toMatch(/revoke all on function public\.cancel_line_customer_rebind\(text, text\) from public, anon/);
    expect(sql).toMatch(/line-customer-bind-v1' \|\| chr\(10\)/);
    expect(sql).not.toMatch(/grant select on public\.line_customer_bindings/);
    expect(sql).not.toMatch(/api\.line\.me|pg_cron|cron\.schedule/);
    expect(sql).not.toMatch(/alter table public\.line_broadcasts/);
    expect(sql).not.toMatch(/drop table public\.line_automation_jobs/i);
    expect(sql).not.toMatch(/customers\.line_user_id/);
    expect(source(LINE_CUSTOMER_BINDINGS_MIGRATION_FILE)).toMatch(
      /Do not apply on Production until Owner confirms/,
    );
    expect(source("lib/line/automations/schedule-actions.ts")).not.toMatch(/line_user_id/);
  });
});
