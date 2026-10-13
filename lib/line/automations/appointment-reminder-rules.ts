import { canShowLineAutomations } from "@/lib/line/automations/access";
import {
  APPOINTMENT_REMINDER_TEXT_MAX,
  isAppointmentReminderPersistOpen,
} from "@/lib/line/automations/appointment-reminder-flag";
import {
  isAppointmentReminderTimingId,
  type AppointmentReminderDecision,
  type AppointmentReminderRule,
  type AppointmentReminderSkipReason,
  type AppointmentReminderTimingId,
} from "@/lib/line/automations/appointment-reminder-types";
import type { LineActor } from "@/lib/line/line-command";
import type { LineAutomationDraft } from "@/lib/line/automations/types";
import type { StaffRole } from "@/types/saas";

export const DEFAULT_APPOINTMENT_REMINDER_TEMPLATE = [
  "您好😊",
  "這是 {{organizationName}} 提醒您",
  "您有一個即將到來的預約😊",
  "",
  "📅預約時間：{{appointmentDate}}（{{appointmentWeekday}}）",
  "{{appointmentTime}}",
  "📍課程項目：{{serviceName}}",
  "{{locationName}}",
  "",
  "期待與您見面！",
  "如需改期或取消，請直接回覆此訊息喔❤️",
].join("\n");

export function createDefaultAppointmentReminderRule(
  organizationId: string,
): AppointmentReminderRule {
  return {
    organizationId,
    automationId: "appointment_reminder",
    enabled: false,
    selectedTimingIds: [],
    template: DEFAULT_APPOINTMENT_REMINDER_TEMPLATE,
  };
}

export function sanitizeAppointmentReminderTimingIds(
  timingIds: readonly string[] | null | undefined,
): AppointmentReminderTimingId[] {
  const seen = new Set<AppointmentReminderTimingId>();
  for (const id of timingIds ?? []) {
    if (isAppointmentReminderTimingId(id)) seen.add(id);
  }
  return [...seen];
}

export function ruleFromAppointmentReminderDraft(
  organizationId: string,
  draft: Pick<LineAutomationDraft, "enabled" | "selectedTimingIds" | "template">,
): AppointmentReminderRule {
  const template = draft.template.trim() || DEFAULT_APPOINTMENT_REMINDER_TEMPLATE;
  return {
    organizationId,
    automationId: "appointment_reminder",
    enabled: draft.enabled === true,
    selectedTimingIds: sanitizeAppointmentReminderTimingIds(draft.selectedTimingIds),
    template,
  };
}

function refuse(
  reason: Extract<AppointmentReminderDecision, { ok: false }>["reason"],
  message: string,
  skipReason?: AppointmentReminderSkipReason,
): Extract<AppointmentReminderDecision, { ok: false }> {
  return { ok: false, reason, message, skipReason };
}

export function evaluateAppointmentReminderOwnerAccess(input: {
  organizationId?: string | null;
  actor: Pick<LineActor, "authUserId" | "organizationId" | "role" | "isActive" | "userId">;
}): Extract<AppointmentReminderDecision, { ok: false }> | { ok: true } {
  const organizationId = (input.organizationId ?? "").trim();
  if (!organizationId.startsWith("org-")) {
    return refuse("unauthorized", "缺少店家識別", "cross_org");
  }
  if (!input.actor.authUserId) {
    return refuse("unauthorized", "請先登入後再管理預約提醒");
  }
  if (input.actor.organizationId !== organizationId) {
    return refuse("unauthorized", "不能讀寫其他店家的預約提醒", "cross_org");
  }
  if (
    !canShowLineAutomations({
      role: input.actor.role as StaffRole | null,
      isActive: input.actor.isActive,
    })
  ) {
    return refuse("unauthorized", "只有店長可以管理 LINE 自動推播");
  }
  return { ok: true };
}

export function evaluateAppointmentReminderRuleSave(input: {
  organizationId?: string | null;
  actor: LineActor;
  rule: AppointmentReminderRule;
  persistOpen?: boolean;
}): Extract<AppointmentReminderDecision, { ok: false }> | { ok: true } {
  const access = evaluateAppointmentReminderOwnerAccess(input);
  if (!access.ok) return access;
  if (input.rule.organizationId !== input.organizationId) {
    return refuse("unauthorized", "不能寫入其他店家的預約提醒", "cross_org");
  }
  if (input.rule.automationId !== "appointment_reminder") {
    return refuse("invalid_input", "本階段只能儲存預約提醒規則");
  }
  if (input.rule.template.length > APPOINTMENT_REMINDER_TEXT_MAX) {
    return refuse("invalid_input", `文字最多 ${APPOINTMENT_REMINDER_TEXT_MAX} 字`);
  }
  if (!isAppointmentReminderPersistOpen(input.persistOpen)) {
    return refuse("send_closed", "正式設定寫入尚未開放，規則不會寫入資料庫", "persist_closed");
  }
  return { ok: true };
}
