// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineBroadcastConfirmQuota } from "@/features/line/LineBroadcastConfirmQuota";
import { LineBroadcastConnectionStatus } from "@/features/line/LineBroadcastConnectionStatus";
import { LineBroadcastHistoryPanel } from "@/features/line/LineBroadcastHistoryPanel";
import { LineBroadcastPhonePreview } from "@/features/line/LineBroadcastPhonePreview";
import {
  canUseLineBroadcastCenter,
  editorStateForOrganizationChange,
  LINE_BROADCAST_CONFIRM_AUDIENCE_DETAIL,
  LINE_BROADCAST_CONFIRM_AUDIENCE_SHORT,
  lineBroadcastConfirmCopy,
  lineBroadcastHttpResultLabel,
  lineBroadcastMessageSummary,
  lineBroadcastMonthlyQuotaLines,
  lineBroadcastOperatorLabel,
  lineBroadcastSafeErrorSummary,
  lineBroadcastsStayIsolatedWhenChannelsMatch,
  lineBroadcastTaipeiDateTime,
  lineBroadcastUiContainsSecrets,
  lineOfficialAccountConnectionView,
  visibleLineAccountForOrganization,
  visibleLineBroadcastsForOrganization,
} from "@/lib/line/line-broadcast-center-ui";
import { LINE_BROADCAST_SEND_OPEN, LINE_TEST_PUSH_OPEN } from "@/lib/line/line-flag";
import { restoreLineBroadcastEditor } from "@/lib/line/line-quota";
import { isLineBroadcastConfirmSubmitEnabled } from "@/lib/line/line-visibility";
import type { LineBroadcastPublic, LineOfficialAccountPublic } from "@/lib/line/line-types";
import { ORG_BEAUTY_OS_TEST_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const ROOT = process.cwd();

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function account(over: Partial<LineOfficialAccountPublic> = {}): LineOfficialAccountPublic {
  return {
    organizationId: ORG_ENJOYE_ID,
    channelId: "2009219238",
    botDisplayName: "ai",
    botBasicId: "@357gospk",
    tokenHint: "••••lFU=",
    secretConfigured: true,
    tokenConfigured: true,
    broadcastEnabled: false,
    testPushEnabled: false,
    testPushRuntimeOpen: false,
    broadcastTestRuntimeOpen: false,
    lastTestedAt: "2026-10-12T04:00:00.000Z",
    lastTestStatus: "ok",
    lastTestMessage: "ok",
    ...over,
  };
}

function row(over: Partial<LineBroadcastPublic> = {}): LineBroadcastPublic {
  return {
    id: "lbr-draft000000001",
    organizationId: ORG_ENJOYE_ID,
    status: "draft",
    textBody: "週年活動通知，歡迎預約保養。",
    requestId: "lbrq-req00000000001",
    lineRequestId: null,
    apiResult: null,
    errorMessage: null,
    createdAt: "2026-10-12T02:00:00.000Z",
    updatedAt: "2026-10-12T02:00:00.000Z",
    confirmedAt: null,
    createdByStaffId: "staff-001",
    ...over,
  };
}

describe("LINE Phase 2A broadcast center UI helpers", () => {
  it("keeps send flags closed and does not add a second send core", () => {
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_TEST_PUSH_OPEN).toBe(false);
    expect(source("lib/line/line-flag.ts")).toMatch(/LINE_BROADCAST_SEND_OPEN = false/);
    const center = source("features/line/LineBroadcastCenter.tsx");
    expect(center).toMatch(/sendLineBroadcastAction\(\{[\s\S]*textBody,/);
    expect(center).toMatch(/saveLineBroadcastDraftAction/);
    expect(center).toMatch(/restoreLineBroadcastEditor/);
    expect(center).not.toMatch(/executeLineBroadcastHttp|oneshot-authorized-send|line-send-adapter/);
    expect(center).not.toMatch(/line_broadcast_oneshot_permits/);
    expect(source("features/line/LineBroadcastHistoryPanel.tsx")).not.toMatch(
      /executeLineBroadcastHttp|sendLineBroadcastAction/,
    );
  });

  it("edits, previews, and restores drafts without mixing organizations", () => {
    const testDraft = row({
      id: "lbr-test-draft",
      organizationId: ORG_BEAUTY_OS_TEST_ID,
      textBody: "TEST 店草稿",
    });
    const enjoyeDraft = row({
      id: "lbr-enjoye-draft",
      organizationId: ORG_ENJOYE_ID,
      textBody: "THE ENJOYE 草稿",
    });
    const mixed = [testDraft, enjoyeDraft];
    expect(visibleLineBroadcastsForOrganization(mixed, ORG_BEAUTY_OS_TEST_ID)).toEqual([
      testDraft,
    ]);
    expect(visibleLineBroadcastsForOrganization(mixed, ORG_ENJOYE_ID)).toEqual([enjoyeDraft]);

    const restored = restoreLineBroadcastEditor({
      history: visibleLineBroadcastsForOrganization(mixed, ORG_BEAUTY_OS_TEST_ID),
      currentText: "",
      currentRequestId: "lbrq-new",
    });
    expect(restored).toMatchObject({
      restored: true,
      textBody: "TEST 店草稿",
      broadcastId: "lbr-test-draft",
    });

    const switched = editorStateForOrganizationChange({
      previousOrganizationId: ORG_BEAUTY_OS_TEST_ID,
      nextOrganizationId: ORG_ENJOYE_ID,
      currentText: "TEST 店草稿",
      currentRequestId: "lbrq-keep",
      currentBroadcastId: "lbr-test-draft",
    });
    expect(switched.reset).toBe(true);
    expect(switched.textBody).toBe("");
    expect(switched.broadcastId).toBeUndefined();
    expect(switched.requestId.startsWith("lbrq-")).toBe(true);
    expect(switched.requestId).not.toBe("lbrq-keep");
  });

  it("renders phone preview, confirm copy, and history fields from mocks", () => {
    const preview = renderToStaticMarkup(
      createElement(LineBroadcastPhonePreview, {
        officialName: "ai",
        textBody: "【LINE 群發功能測試】\n這是一則系統功能測試訊息，無需回覆，謝謝。",
      }),
    );
    expect(preview).toContain("data-line-phone-preview");
    expect(preview).toContain("手機版訊息預覽");
    expect(preview).toContain("【LINE 群發功能測試】");
    expect(preview).not.toMatch(/channel-secret|access-token/i);

    const confirm = lineBroadcastConfirmCopy({
      organizationName: "Beauty OS TEST",
      officialName: "ai",
      textBody: "全店公休通知",
    });
    expect(confirm.organizationName).toBe("Beauty OS TEST");
    expect(confirm.officialName).toBe("ai");
    expect(confirm.audienceShort).toBe(LINE_BROADCAST_CONFIRM_AUDIENCE_SHORT);
    expect(confirm.audienceDetail).toBe(LINE_BROADCAST_CONFIRM_AUDIENCE_DETAIL);
    expect(confirm.fullText).toBe("全店公休通知");

    const accepted = row({
      id: "lbr-7a17faeae137440d",
      organizationId: ORG_BEAUTY_OS_TEST_ID,
      status: "accepted",
      apiResult: "accepted",
      httpStatus: 200,
      sendClaimedAt: "2026-10-12T04:01:07.792Z",
      confirmedByStaffId: "staff-001",
      textBody: "【LINE 群發功能測試】\n這是一則系統功能測試訊息，無需回覆，謝謝。",
    });
    const history = renderToStaticMarkup(
      createElement(LineBroadcastHistoryPanel, { rows: [accepted], showRequestId: false }),
    );
    expect(history).toContain("建立 2026/10/12 10:00");
    expect(history).toContain("發送 2026/10/12 12:01");
    expect(history).toContain("操作者 店長（staff-001）");
    expect(history).toContain("HTTP 200（LINE API 已接受，不代表已送達）");
    expect(history).toContain("查看訊息全文");
    expect(history).toContain(lineBroadcastMessageSummary(accepted.textBody));
    expect(history).not.toContain("data-line-history-full-text\"");
    const longText = "週年慶活動即將開始，歡迎預約臉部保養與身體舒壓課程，名額有限請盡快來電登記。";
    expect(lineBroadcastMessageSummary(longText).endsWith("…")).toBe(true);
    expect(lineBroadcastMessageSummary(longText).startsWith("週年慶活動即將開始")).toBe(true);
  });

  it("denies non-owners and isolates shared-channel organizations", () => {
    expect(canUseLineBroadcastCenter({ role: "OWNER", isActive: true })).toBe(true);
    for (const role of ["MANAGER", "STAFF", "RECEPTIONIST", "ACCOUNTANT"] as const) {
      expect(canUseLineBroadcastCenter({ role, isActive: true })).toBe(false);
    }
    expect(canUseLineBroadcastCenter({ role: "OWNER", isActive: false })).toBe(false);

    const testAccount = account({ organizationId: ORG_BEAUTY_OS_TEST_ID });
    const enjoyeAccount = account({ organizationId: ORG_ENJOYE_ID });
    expect(visibleLineAccountForOrganization(testAccount, ORG_ENJOYE_ID)).toBeNull();
    expect(visibleLineAccountForOrganization(enjoyeAccount, ORG_ENJOYE_ID)?.organizationId).toBe(
      ORG_ENJOYE_ID,
    );
    expect(
      lineBroadcastsStayIsolatedWhenChannelsMatch({
        leftOrganizationId: ORG_BEAUTY_OS_TEST_ID,
        rightOrganizationId: ORG_ENJOYE_ID,
        leftChannelId: "2009219238",
        rightChannelId: "2009219238",
      }),
    ).toBe(true);

    const connection = renderToStaticMarkup(
      createElement(LineBroadcastConnectionStatus, {
        organizationName: "THE ENJOYE",
        organizationId: ORG_ENJOYE_ID,
        account: enjoyeAccount,
      }),
    );
    expect(connection).toContain("目前店家：THE ENJOYE");
    expect(connection).toContain("已完成連線測試");
    expect(connection).not.toContain("••••lFU=");
    expect(connection).not.toMatch(/secret-value|token-value|U[0-9a-f]{32}/i);
  });

  it("blocks confirm submit when send is closed and hides secrets from error text", () => {
    expect(
      isLineBroadcastConfirmSubmitEnabled({
        sendOpen: false,
        acknowledged: true,
        pending: false,
      }),
    ).toBe(false);
    expect(
      isLineBroadcastConfirmSubmitEnabled({
        sendOpen: true,
        acknowledged: true,
        pending: true,
      }),
    ).toBe(false);
    expect(lineOfficialAccountConnectionView(account({ tokenConfigured: false })).label).toMatch(
      /尚未保存/,
    );
    expect(lineOfficialAccountConnectionView(account({ lastTestStatus: "failed" })).tone).toBe(
      "danger",
    );
    expect(lineBroadcastTaipeiDateTime(null)).toBe("—");
    expect(lineBroadcastOperatorLabel({})).toBe("店長");
    expect(lineBroadcastHttpResultLabel({ httpStatus: null, apiResult: "send_closed" })).toBe(
      "未呼叫 LINE",
    );
    expect(
      lineBroadcastSafeErrorSummary("Bearer token-value and U0123456789abcdef0123456789abcdef"),
    ).toBe("發送失敗（已隱藏敏感細節）");
    expect(lineBroadcastSafeErrorSummary("今日群發次數已達上限")).toBe("今日群發次數已達上限");
    expect(lineBroadcastUiContainsSecrets("Authorization: Bearer access-token")).toBe(true);

    const quota = renderToStaticMarkup(
      createElement(LineBroadcastConfirmQuota, {
        quota: {
          known: true,
          type: "limited",
          limit: 500,
          usage: 12,
          remaining: 488,
          label: "本月額度 500，已使用 12，剩餘 488",
        },
        sendOpen: false,
      }),
    );
    expect(quota).toContain("本月可用額度與用量");
    expect(quota).toContain("上限 500");
    expect(quota).toContain("已使用 12");
    expect(lineBroadcastMonthlyQuotaLines({
      known: false,
      type: null,
      limit: null,
      usage: null,
      remaining: null,
      label: "未知",
    }).limit).toBe("無法確認");
  });

  it("keeps oneshot and confirm source contracts on the formal UI", () => {
    const center = source("features/line/LineBroadcastCenter.tsx");
    expect(center).toMatch(/建立群發/);
    expect(center).toMatch(/發送紀錄/);
    expect(center).toMatch(/確認發送/);
    expect(center).toMatch(/發送對象：全部好友/);
    expect(center).toMatch(/發送給此官方帳號所有符合接收資格的好友/);
    expect(center).toMatch(/const preview = textBody;/);
    expect(center).not.toMatch(/textBody\.trim\(\)/);
    expect(center).toMatch(/oneshotActive \|\| textBody === LINE_BROADCAST_ONESHOT_TEXT/);
    expect(center).toMatch(/data-line-confirm-organization/);
    expect(center).toMatch(/data-line-phone-preview|LineBroadcastPhonePreview/);
    expect(center).toMatch(/LineBroadcastHistoryPanel/);
    expect(center).toMatch(/editorStateForOrganizationChange/);
    const confirmUi = center.slice(
      center.indexOf("data-line-broadcast-confirm"),
      center.indexOf("data-line-broadcast-history"),
    );
    expect(confirmUi).not.toMatch(/群發準備|Runtime|Retry-Key|Request ID|連線狀態|LINE 額度/);
    expect(source("lib/line/actions.ts")).toMatch(/CLAIM_LINE_BROADCAST_SEND_RPC/);
    expect(source("lib/line/line-oneshot.ts")).toMatch(/沒有可用的一次性群發許可/);
  });
});
