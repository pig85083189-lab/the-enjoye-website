export const LINE_AUTOMATION_IDS = [
  "appointment_reminder",
  "birthday_greeting",
  "holiday_greeting",
  "satisfaction_survey",
  "coupon_expiry",
] as const;

export type LineAutomationId = (typeof LINE_AUTOMATION_IDS)[number];

export type LineAutomationTab = "overview" | LineAutomationId | "history";

export type LineAutomationTiming = {
  id: string;
  label: string;
  builtin: boolean;
};

export type LineAutomationQuickReply = {
  id: string;
  label: string;
};

export type LineAutomationTemplateCard = {
  id: LineAutomationId;
  title: string;
  caption: string;
  accent: string;
};

export type LineAutomationDefinition = {
  id: LineAutomationId;
  title: string;
  tabLabel: string;
  badge: string | null;
  description: string;
  icon: "calendar" | "cake" | "party" | "message" | "percent";
  timings: readonly LineAutomationTiming[];
  defaultTimingIds: readonly string[];
  addTimingLabel: string;
  previewTitle: string;
  demoTemplate: string;
  quickReplies: readonly LineAutomationQuickReply[];
};

export type LineAutomationDraft = {
  id: LineAutomationId;
  enabled: boolean;
  selectedTimingIds: string[];
  customTimings: LineAutomationTiming[];
  template: string;
};

export type LineAutomationStats = {
  sentThisMonth: number | null;
  plannedThisMonth: number | null;
  successRate: number | null;
  pendingTasks: number | null;
};
