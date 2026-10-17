/**
 * Phase 3A inventory and official-site test-mode policy.
 * Test LINE first. Does not send, deploy, or apply Production SQL.
 */
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_GRANT_PERSIST_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";

export type LineFeatureMaturity = "done" | "partial" | "ui_only" | "not_started";

export type LineFeatureInventoryRow = {
  id: string;
  title: string;
  maturity: LineFeatureMaturity;
  reuse: string;
  gap: string;
};

export const TEST_LINE_CHANNEL_ID = "2009219238";
export const PHASE_3A_TEST_MODE = "official_site_ui_isolated" as const;

export function phase3AFlagsClosed(): boolean {
  return (
    LINE_BROADCAST_SEND_OPEN === false &&
    LINE_AUTOMATION_SEND_OPEN === false &&
    LINE_OWNER_SELF_PUSH_OPEN === false &&
    LINE_AUTOMATION_KILL_SWITCH === false &&
    LINE_OWNER_SELF_GRANT_PERSIST_OPEN === false
  );
}

export function lineFeatureInventory(): LineFeatureInventoryRow[] {
  return [
    {
      id: "broadcast",
      title: "群發訊息",
      maturity: "partial",
      reuse: "正式網站群發中心、Channel lock、額度檢查、oneshot 許可路徑",
      gap: "全域 SEND 關閉；不要改既有 Broadcast 程式",
    },
    {
      id: "bind",
      title: "LINE 綁定",
      maturity: "partial",
      reuse: "webhook_code 8 碼綁定、簽章驗證、店長解除綁定 RPC",
      gap: "Webhook 不管 follow / unfollow / 封鎖；TEST 綁定不得對應正式營業 Owner",
    },
    {
      id: "appointment_reminder",
      title: "預約提醒",
      maturity: "partial",
      reuse: "自動推播頁、規則編輯、line_automation_jobs、本機排程引擎",
      gap: "已可建立待發送排程；尚未接真實發送與 Cron",
    },
    {
      id: "later_automations",
      title: "生日／節慶／滿意度／優惠券",
      maturity: "partial",
      reuse: "同一套目錄、開關、範本與 line_automation_jobs",
      gap: "節慶缺正式日曆；優惠券缺正式目錄，僅能沿用已有套票到期日；尚未發送",
    },
    {
      id: "logs_quota",
      title: "發送紀錄與額度限制",
      maturity: "partial",
      reuse: "群發歷史與 LINE 額度快照",
      gap: "自動推播紀錄仍是空狀態；額度尚未接到提醒排程",
    },
    {
      id: "optout_schedule",
      title: "取消訂閱、封鎖與排程",
      maturity: "not_started",
      reuse: "無",
      gap: "Webhook 不處理封鎖；沒有自動推播 cron",
    },
  ];
}

export function officialSiteTestModeRules(): string[] {
  return [
    "正式網站可顯示 LINE 管理 UI，但預設只是本機預覽",
    "不得從正式顧客資料自動建立測試發送對象",
    "不得把 Preview 測試綁定複製到 Production",
    "Channel 2009219238 是測試 LINE，不是 THE ENJOYE 正式營業帳號",
    "不得直接啟用自動 LINE 發送",
    "TEST webhook_code 綁定不得錯誤對應正式 Owner",
    "正式與 Preview 資料庫不共用、不互拷",
  ];
}

export function canAutoEnrollProductionCustomers(): boolean {
  return false;
}

export function canCopyPreviewBindToProduction(): boolean {
  return false;
}

export function treatTestChannelAsBusinessLine(): boolean {
  return false;
}

export function canEnableAutomaticLineSend(): boolean {
  return false;
}

export function laterAutomationModuleOrder(): string[] {
  return ["birthday_greeting", "holiday_greeting", "satisfaction_survey", "coupon_expiry"];
}

export function laterAutomationModuleRequirements(): string[] {
  return [
    "個別開關",
    "訊息模板",
    "發送時機",
    "發送對象",
    "去重",
    "發送紀錄",
    "停用及撤回",
    "失敗處理",
  ];
}

export function phase3ADevelopmentOrder(): string[] {
  return [
    "盤點與測試模式隔離（本階段）",
    "預約提醒本機資料模型、排程、管理介面（本階段）",
    "預約提醒本機驗收：取消／改期失效、去重、額度、對象隔離",
    "其餘自動推播依生日、節慶、滿意度、優惠券順序補齊",
    "測試 LINE 真實發送另一次核准後才開",
    "正式營業 LINE 最後才串接",
  ];
}
