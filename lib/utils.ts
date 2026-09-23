export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** Format: YYYY年M月D日 星期X */
export function formatTodayLabel(date = new Date()): string {
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = weekdays[date.getDay()];
  return `${year}年${month}月${day}日 星期${weekday}`;
}

/**
 * Greeting by local hour:
 * 05:00–10:59 早安 · 11:00–13:59 午安 · 14:00–17:59 下午好 · 18:00–04:59 晚安
 */
export function getGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "早安";
  if (hour >= 11 && hour < 14) return "午安";
  if (hour >= 14 && hour < 18) return "下午好";
  return "晚安";
}

/** Short scan tags for appointment reminders */
const REMINDER_TAG_MAP: Record<string, string> = {
  右側腋下較緊: "右腋下緊繃",
  外擴需持續追蹤: "外擴追蹤",
  初次來店: "初次來店",
  諮詢表已完成: "諮詢已完成",
  上次有療程照片: "上次有照片",
};

export function formatReminderTag(note: string): string {
  return REMINDER_TAG_MAP[note] ?? note;
}

export const MEMBERSHIP_LABEL: Record<string, string> = {
  vip: "VIP會員",
  regular: "一般會員",
  new: "新客",
};

export const STATUS_LABEL: Record<string, string> = {
  pending: "待服務",
  in_progress: "服務中",
  completed: "已完成",
};
