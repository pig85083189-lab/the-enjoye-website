// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineEnjoyeOwnerBindPrepCard } from "@/features/line/LineEnjoyeOwnerBindPrepCard";
import {
  ENJOYE_OWNER_BIND_ISSUE_LABEL,
  ENJOYE_OWNER_BIND_ISSUE_OPEN,
  ENJOYE_OWNER_BIND_MATCH_UNAVAILABLE,
  ENJOYE_OWNER_BIND_TITLE,
  ENJOYE_OWNER_BIND_WEBHOOK_READY,
  ENJOYE_OWNER_BIND_WEBHOOK_WARNING,
  canShowEnjoyeOwnerBindPrep,
  enjoyeOwnerBindPrepFlagsClosed,
  evaluateEnjoyeOwnerBindIdentity,
  evaluateEnjoyeOwnerBindIssue,
  enjoyeOwnerBindMatchLabel,
  maskLineChannelId,
} from "@/lib/line/enjoye-owner-bind-prep";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import { ORG_BEAUTY_OS_TEST_ID, ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";

const ROOT = process.cwd();
function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const enjoyeOwner = {
  organizationId: ORG_ENJOYE_ID,
  staffUserId: "staff-001",
  role: "OWNER",
  isActive: true,
};

describe("Phase 2F-4 Enjoye Owner bind-start preparation", () => {
  it("shows the prep card only for THE ENJOYE Owner and keeps issue closed", () => {
    expect(canShowEnjoyeOwnerBindPrep(enjoyeOwner)).toBe(true);
    expect(
      canShowEnjoyeOwnerBindPrep({ ...enjoyeOwner, organizationId: ORG_BEAUTY_OS_TEST_ID }),
    ).toBe(false);
    expect(canShowEnjoyeOwnerBindPrep({ ...enjoyeOwner, organizationId: ORG_LUMIERE_ID })).toBe(
      false,
    );
    expect(canShowEnjoyeOwnerBindPrep({ ...enjoyeOwner, role: "STAFF" })).toBe(false);
    expect(enjoyeOwnerBindPrepFlagsClosed()).toBe(true);
    expect(ENJOYE_OWNER_BIND_WEBHOOK_READY).toBe(false);
    expect(ENJOYE_OWNER_BIND_ISSUE_OPEN).toBe(false);
    expect(evaluateEnjoyeOwnerBindIssue({ actor: enjoyeOwner }).reason).toBe("send_closed");
    expect(evaluateEnjoyeOwnerBindIssue({ actor: enjoyeOwner }).message).toMatch(
      /正式 Webhook 尚未切換，不能產生驗證碼/,
    );
  });

  it("refuses Preview TEST or fake bind data and does not treat a row as self", () => {
    expect(
      evaluateEnjoyeOwnerBindIssue({
        actor: enjoyeOwner,
        bind: { organizationId: ORG_BEAUTY_OS_TEST_ID, staffUserId: "staff-001" },
      }).reason,
    ).toBe("unbound");
    expect(
      evaluateEnjoyeOwnerBindIdentity({
        actor: enjoyeOwner,
        bind: {
          organizationId: ORG_ENJOYE_ID,
          staffUserId: "cust-2d2-fake-bound",
          bindMethod: "webhook_code",
          hint: "••••fc8c",
          boundAt: "2026-10-16T00:00:00.000Z",
          keyId: "line-cred-v1",
          webhookVerified: true,
        },
      }).reason,
    ).toBe("unbound");
    expect(enjoyeOwnerBindMatchLabel({ actor: enjoyeOwner, bind: null })).toBe(
      ENJOYE_OWNER_BIND_MATCH_UNAVAILABLE,
    );
    expect(maskLineChannelId("2009219238")).toBe("••••9238");
  });

  it("renders disabled issue controls and webhook warning without calling bind RPCs", () => {
    const html = renderToStaticMarkup(
      createElement(LineEnjoyeOwnerBindPrepCard, {
        actor: enjoyeOwner,
        channelId: "2009219238",
      }),
    );
    expect(html).toContain(ENJOYE_OWNER_BIND_TITLE);
    expect(html).toContain(ENJOYE_OWNER_BIND_WEBHOOK_WARNING);
    expect(html).toContain(ENJOYE_OWNER_BIND_ISSUE_LABEL);
    expect(html).toContain("••••9238");
    expect(html).toContain("staff-001");
    expect(html).toMatch(/data-line-enjoye-bind-issue-open="false"/);
    expect(html).toMatch(/disabled[^>]*data-line-enjoye-bind-issue|data-line-enjoye-bind-issue[^>]*disabled/);
    expect(html).not.toContain("startLineOwnerBindAction");
    expect(source("features/line/LineEnjoyeOwnerBindPrepCard.tsx")).not.toMatch(
      /onClick|startLineOwnerBindAction|ensureLineWebhookPublicUrlAction|unbindLineOwnerRecipientAction/,
    );
  });

  it("does not change Broadcast send or TEST engineer bind, and hides tokens", () => {
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    const settings = source("features/line/LineOfficialAccountSettings.tsx");
    expect(settings).toMatch(/LineEnjoyeOwnerBindPrepCard/);
    expect(settings).toMatch(/canShowLineEngineerDiagnostics/);
    expect(settings).toMatch(/startLineOwnerBindAction/);
    const enjoyeStart = settings.indexOf("LineEnjoyeOwnerBindPrepCard");
    const engineerStart = settings.indexOf("data-line-owner-bind");
    expect(enjoyeStart).toBeGreaterThan(-1);
    expect(engineerStart).toBeGreaterThan(enjoyeStart);
    expect(settings.slice(enjoyeStart, engineerStart)).not.toMatch(/startLineOwnerBindAction/);
    expect(source("features/line/LineBroadcastCenter.tsx")).toMatch(/確認發送/);
    expect(source("lib/line/line-channel-lock.ts")).toMatch(/LINE_BROADCAST_CHANNEL_LOCK_NAMESPACE = 870121/);
    const prep = source("lib/line/enjoye-owner-bind-prep.ts");
    expect(prep).not.toMatch(/api\.line\.me|executeLineBroadcastHttp|multicast/);
    expect(prep).not.toMatch(/bfzquejrtgqzzarhkiya|cust-2d2-fake-bound|apt-2e7-owner-self/);
    expect(source("features/line/LineEnjoyeOwnerBindPrepCard.tsx")).not.toMatch(
      /webhook\.url|publicToken|channelSecret|channelAccessToken/,
    );
  });
});
