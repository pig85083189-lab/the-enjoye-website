import { isLineUserId } from "@/lib/line/line-bind";
import type {
  AppointmentReminderSkipReason,
  CustomerLineBinding,
  NotificationPreference,
} from "@/lib/line/automations/appointment-reminder-types";

export type AppointmentReminderAudienceDecision =
  | { ok: true; lineUserId: string }
  | { ok: false; skipReason: AppointmentReminderSkipReason; message: string };

/**
 * CRM plaintext `customers.line_user_id` is never a send-safe bind.
 * Owner LINE recipients must not be reused as customer audience.
 */
export function evaluateAppointmentReminderAudience(input: {
  organizationId: string;
  customerId: string;
  binding?: CustomerLineBinding | null;
  preference?: NotificationPreference | null;
  crmLineUserId?: string | null;
  ownerRecipientLineUserId?: string | null;
}): AppointmentReminderAudienceDecision {
  const binding = input.binding;
  if (!binding) {
    return {
      ok: false,
      skipReason: input.crmLineUserId ? "plaintext_line_id_refused" : "unbound",
      message: input.crmLineUserId
        ? "客戶 CRM LINE ID 不是已驗證綁定，系統不會發送"
        : "客人尚未完成已驗證的 LINE 綁定，系統不會發送",
    };
  }
  if (binding.organizationId !== input.organizationId || binding.customerId !== input.customerId) {
    return {
      ok: false,
      skipReason: "cross_org",
      message: "不能使用其他店家或客人的 LINE 綁定",
    };
  }
  if (binding.unboundAt) {
    return { ok: false, skipReason: "unbound", message: "客人已解除 LINE 綁定，系統不會發送" };
  }
  if (binding.blockedAt) {
    return { ok: false, skipReason: "blocked", message: "客人已封鎖官方帳號，系統不會發送" };
  }
  if (!binding.verified || !isLineUserId(binding.lineUserId)) {
    return {
      ok: false,
      skipReason: "unbound",
      message: "LINE 綁定尚未驗證，系統不會發送",
    };
  }
  if (
    input.ownerRecipientLineUserId &&
    binding.lineUserId === input.ownerRecipientLineUserId
  ) {
    return {
      ok: false,
      skipReason: "invalid_recipient",
      message: "店長 LINE 綁定不能當作客人收件者",
    };
  }

  const preference = input.preference;
  if (!preference || preference.organizationId !== input.organizationId) {
    return { ok: false, skipReason: "not_consented", message: "客人尚未同意預約提醒通知" };
  }
  if (preference.customerId !== input.customerId) {
    return { ok: false, skipReason: "cross_org", message: "不能使用其他客人的通知設定" };
  }
  if (preference.unsubscribedAt) {
    return { ok: false, skipReason: "unsubscribed", message: "客人已退訂預約提醒，系統不會發送" };
  }
  if (!preference.appointmentReminderOptIn) {
    return { ok: false, skipReason: "not_consented", message: "客人尚未同意預約提醒通知" };
  }

  return { ok: true, lineUserId: binding.lineUserId };
}

export function refusePlaintextCustomerLineId(lineUserId?: string | null): boolean {
  return Boolean(lineUserId && isLineUserId(lineUserId));
}
