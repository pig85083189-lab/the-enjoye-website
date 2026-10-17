// @vitest-environment node
import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineCustomerBindingsCard } from "@/features/line/automations/LineCustomerBindingsCard";
import {
  evaluateLineCustomerBindStart,
  isTrustedCustomerBinding,
  mapLineCustomerBindingRows,
  verifiedBindingCustomerIds,
} from "@/lib/line/automations/customer-bindings";
import { LINE_AUTOMATION_SEND_OPEN } from "@/lib/line/automations/production-safe-flags";
import { LINE_CUSTOMER_BINDINGS_MIGRATION_FILE } from "@/lib/persistence/schema-contract";
import type { LineActor } from "@/lib/line/line-command";
import { hashLineUserId } from "@/lib/line/line-bind";
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
  it("starts a bind only for the same-store owner and a customer id", () => {
    expect(
      evaluateLineCustomerBindStart({
        connectionPilotEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        actor: owner(ORG_ENJOYE_ID),
        secretConfigured: true,
        customerId: "cust-1",
      }).ok,
    ).toBe(true);
    expect(
      evaluateLineCustomerBindStart({
        connectionPilotEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        actor: owner(ORG_LUMIERE_ID),
        secretConfigured: true,
        customerId: "cust-1",
      }).ok,
    ).toBe(false);
    expect(
      evaluateLineCustomerBindStart({
        connectionPilotEnabled: true,
        organizationId: ORG_ENJOYE_ID,
        actor: { ...owner(ORG_ENJOYE_ID), role: "STAFF" },
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
        customerId: "  ",
      }).ok,
    ).toBe(false);
  });

  it("treats only active verified webhook bindings as trusted recipients", () => {
    expect(isTrustedCustomerBinding({ verified: true, status: "active" })).toBe(true);
    expect(isTrustedCustomerBinding({ verified: true, status: "unbound" })).toBe(false);
    expect(isTrustedCustomerBinding({ verified: false, status: "active" })).toBe(false);
    expect(isTrustedCustomerBinding(null)).toBe(false);

    const rows = mapLineCustomerBindingRows(ORG_ENJOYE_ID, {
      organization_id: ORG_LUMIERE_ID,
      customers: [
        {
          customer_id: "cust-x",
          binding: { verified: true, status: "active", hint: "••••abcd" },
        },
      ],
    });
    expect(rows).toEqual([]);

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
          },
        },
        {
          customer_id: "cust-2",
          binding: { hint: "••••zzzz", verified: false, status: "unbound" },
        },
      ],
    });
    expect(mapped[0]?.binding?.hint).toBe("••••abcd");
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
    expect(actions).toMatch(/LINE_AUTOMATION_SEND_OPEN !== false/);
    expect(helpers).not.toMatch(/customers\.line_user_id/);
    expect(webhook).toMatch(/hashLineUserId\(candidate\.userId\)/);
    expect(webhook).not.toMatch(/body\.userId|input\.lineUserId/);
    expect(route).toMatch(/CONSUME_LINE_OWNER_BIND_PUBLIC_RPC/);
    expect(route).toMatch(/CONSUME_LINE_CUSTOMER_BIND_PUBLIC_RPC/);
    expect(route).toMatch(/bind\.userIdHash/);
    expect(ui).not.toMatch(/<input[^>]*user id|lineUserId|LINE user id/i);
    expect(ui).not.toMatch(/type="text"[^>]*U[0-9a-f]/i);
    expect(hashLineUserId("U" + "a".repeat(32))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the owner bindings card view-only for verified identity", () => {
    const markup = renderToStaticMarkup(
      createElement(LineCustomerBindingsCard, { organizationId: ORG_ENJOYE_ID }),
    );
    expect(markup).toContain("顧客 LINE 綁定");
    expect(markup).toContain("不能手填 User ID");
    expect(markup).toContain("已驗證的 LINE 識別不可手動修改");
    expect(markup).not.toMatch(/<input/i);
    expect(source("features/line/automations/LineAutomationsWorkspace.tsx")).toMatch(
      /LineCustomerBindingsCard/,
    );
  });

  it("locks send, cron, Broadcast, and Production SQL in the binding migration", () => {
    const sql = executableSql(LINE_CUSTOMER_BINDINGS_MIGRATION_FILE);
    expect(LINE_AUTOMATION_SEND_OPEN).toBe(false);
    expect(source("lib/line/automations/production-safe-flags.ts")).toMatch(
      /LINE_AUTOMATION_SEND_OPEN = false/,
    );
    expect(sql).toMatch(/line_customer_bindings_active_hash_key/);
    expect(sql).toMatch(/line_user_id_cipher like 'v1\.%'/);
    expect(sql).toMatch(/Does not accept a LINE user id/);
    expect(sql).toMatch(/Never stores plaintext LINE user id/);
    expect(sql).not.toMatch(/api\.line\.me|pg_cron|cron\.schedule/);
    expect(sql).not.toMatch(/alter table public\.line_broadcasts/);
    expect(sql).not.toMatch(/drop table public\.line_automation_jobs/i);
    expect(sql).not.toMatch(/customers\.line_user_id/);
    expect(source(LINE_CUSTOMER_BINDINGS_MIGRATION_FILE)).toMatch(
      /Do not apply on Production until Owner confirms/,
    );
    expect(source("lib/line/automations/schedule-actions.ts")).toMatch(
      /READ_LINE_CUSTOMER_BINDINGS_RPC/,
    );
    expect(source("lib/line/automations/schedule-actions.ts")).toMatch(
      /verifiedBindingCustomerIds/,
    );
    expect(source("lib/line/automations/schedule-actions.ts")).not.toMatch(/line_user_id/);
  });
});
