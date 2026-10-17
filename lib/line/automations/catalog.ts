import type {
  LineAutomationDefinition,
  LineAutomationId,
  LineAutomationTab,
  LineAutomationTemplateCard,
} from "./types";

export const LINE_AUTOMATION_TABS: ReadonlyArray<{
  id: LineAutomationTab;
  label: string;
}> = [
  { id: "overview", label: "通知管理" },
  { id: "appointment_reminder", label: "預約提醒" },
  { id: "birthday_greeting", label: "生日祝福" },
  { id: "holiday_greeting", label: "節慶祝福" },
  { id: "satisfaction_survey", label: "滿意度調查" },
  { id: "coupon_expiry", label: "優惠券到期提醒" },
  { id: "history", label: "發送紀錄" },
];

export const LINE_AUTOMATION_CATALOG: readonly LineAutomationDefinition[] = [
  {
    id: "appointment_reminder",
    title: "預約提醒",
    tabLabel: "預約提醒",
    badge: "建置啟用中",
    description: "預約前自動提醒客人到店",
    icon: "calendar",
    timings: [
      { id: "day_before_morning", label: "預約前1天 上午", builtin: true },
      { id: "hours_before_3", label: "預約前3小時", builtin: true },
    ],
    defaultTimingIds: ["day_before_morning", "hours_before_3"],
    addTimingLabel: "+ 新增提醒時間",
    previewTitle: "預約提醒範本",
    demoTemplate: [
      "您好😊",
      "這是 THE ENJOYE 提醒您",
      "您有一個明天的預約😊",
      "",
      "📅預約時間：2026/10/13（星期二）",
      "16:00",
      "📍課程項目：美胸 SPA",
      "THE ENJOYE 台中店",
      "",
      "期待明天見到您！",
      "如需改期或取消，請直接回覆此訊息喔❤️",
    ].join("\n"),
    quickReplies: [
      { id: "reschedule", label: "我要改期" },
      { id: "cancel", label: "我要取消" },
      { id: "contact", label: "聯絡我們" },
    ],
  },
  {
    id: "birthday_greeting",
    title: "生日祝福",
    tabLabel: "生日祝福",
    badge: "提升回訪",
    description: "客人生日當天送上祝福",
    icon: "cake",
    timings: [
      { id: "birthday_morning", label: "生日當天早上 10:00", builtin: true },
      { id: "days_before_3", label: "+ 提前3天提醒", builtin: true },
    ],
    defaultTimingIds: ["birthday_morning"],
    addTimingLabel: "+ 新增提醒時間",
    previewTitle: "生日祝福範本",
    demoTemplate: [
      "🎂 Happy Birthday",
      "親愛的客人，生日快樂！",
      "",
      "THE ENJOYE 為您準備了生日專屬優惠，",
      "歡迎預約回來享受屬於您的放鬆時光。",
      "",
      "祝您天天美麗、心情愉快 💐",
    ].join("\n"),
    quickReplies: [
      { id: "book", label: "我要預約" },
      { id: "thanks", label: "謝謝" },
      { id: "contact", label: "聯絡我們" },
    ],
  },
  {
    id: "holiday_greeting",
    title: "節慶祝福",
    tabLabel: "節慶祝福",
    badge: null,
    description: "重要節日維持品牌溫度",
    icon: "party",
    timings: [
      { id: "cny", label: "春節（農曆新年）", builtin: true },
      { id: "mid_autumn", label: "中秋節", builtin: true },
      { id: "christmas", label: "聖誕節", builtin: true },
    ],
    defaultTimingIds: ["cny", "mid_autumn", "christmas"],
    addTimingLabel: "+ 新增節日",
    previewTitle: "節慶祝福範本",
    demoTemplate: [
      "新年快樂 🧧",
      "",
      "感謝您這一年的支持與信任。",
      "THE ENJOYE 祝您新的一年平安順心、美麗常在。",
      "",
      "期待再與您見面。",
    ].join("\n"),
    quickReplies: [
      { id: "book", label: "我要預約" },
      { id: "thanks", label: "謝謝" },
    ],
  },
  {
    id: "satisfaction_survey",
    title: "滿意度調查",
    tabLabel: "滿意度調查",
    badge: "提升服務品質",
    description: "課程結束後收集客人回饋",
    icon: "message",
    timings: [
      { id: "hours_after_2", label: "完成課程後2小時", builtin: true },
      { id: "days_after_1", label: "完成課程後1天", builtin: true },
    ],
    defaultTimingIds: ["hours_after_2", "days_after_1"],
    addTimingLabel: "+ 新增提醒時間",
    previewTitle: "滿意度調查範本",
    demoTemplate: [
      "感謝您完成今日課程 🤍",
      "",
      "想請您花 30 秒告訴我們這次的體驗如何？",
      "您的回饋能幫助我們把服務做得更好。",
      "",
      "謝謝您 🙏",
    ].join("\n"),
    quickReplies: [
      { id: "good", label: "很滿意" },
      { id: "ok", label: "普通" },
      { id: "contact", label: "聯絡我們" },
    ],
  },
  {
    id: "coupon_expiry",
    title: "優惠券到期提醒",
    tabLabel: "優惠券到期提醒",
    badge: null,
    description: "優惠到期前提醒客人使用",
    icon: "percent",
    timings: [
      { id: "days_before_7", label: "到期前7天", builtin: true },
      { id: "days_before_3", label: "到期前3天", builtin: true },
      { id: "days_before_1", label: "到期前1天", builtin: true },
    ],
    defaultTimingIds: ["days_before_7", "days_before_3", "days_before_1"],
    addTimingLabel: "+ 新增提醒時間",
    previewTitle: "優惠到期提醒範本",
    demoTemplate: [
      "🎁 優惠即將到期提醒",
      "",
      "您有一張優惠即將到期，",
      "記得在期限前預約使用喔。",
      "",
      "如需安排時段，直接回覆此訊息即可。",
    ].join("\n"),
    quickReplies: [
      { id: "book", label: "我要預約" },
      { id: "later", label: "稍後再說" },
      { id: "contact", label: "聯絡我們" },
    ],
  },
];

export const LINE_AUTOMATION_TEMPLATE_CARDS: readonly LineAutomationTemplateCard[] = [
  { id: "birthday_greeting", title: "Happy Birthday", caption: "生日祝福", accent: "#F3C6C4" },
  { id: "holiday_greeting", title: "新年快樂", caption: "節慶祝福", accent: "#E8B4B0" },
  { id: "satisfaction_survey", title: "溫暖評價", caption: "滿意度調查", accent: "#F1D4C8" },
  { id: "coupon_expiry", title: "優惠提醒", caption: "優惠券到期", accent: "#E7C8B8" },
];

export function lineAutomationById(
  id: LineAutomationId,
): LineAutomationDefinition {
  const found = LINE_AUTOMATION_CATALOG.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Unknown LINE automation: ${id}`);
  }
  return found;
}

export function isLineAutomationId(value: string): value is LineAutomationId {
  return LINE_AUTOMATION_CATALOG.some((item) => item.id === value);
}
