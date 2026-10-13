import {
  APPOINTMENT_REMINDER_TEXT_MAX,
  isAppointmentReminderSendOpen,
} from "@/lib/line/automations/appointment-reminder-flag";
import { evaluateAppointmentReminderAudience } from "@/lib/line/automations/appointment-reminder-bindings";
import { appointmentReminderJobIsDue } from "@/lib/line/automations/appointment-reminder-jobs";
import { appointmentReminderFingerprint } from "@/lib/line/automations/appointment-reminder-scheduler";
import { isAppointmentReminderActiveStatus } from "@/lib/line/automations/appointment-reminder-types";
import type {
  AppointmentReminderAppointment,
  AppointmentReminderDecision,
  AppointmentReminderJob,
  AppointmentReminderSkipReason,
  CustomerLineBinding,
  NotificationPreference,
} from "@/lib/line/automations/appointment-reminder-types";
import {
  classifyLineHttpError,
  isLineHttpErrorClass,
  isLineUnknownHttpOutcome,
} from "@/lib/line/line-http-error";
import {
  lineOfficialQuotaBlockMessage,
  lineQuotaBlocksSend,
} from "@/lib/line/line-quota";
import type {
  LineApiResult,
  LineBroadcastStatus,
  LineDecisionReason,
  LineHttpErrorClass,
  LineQuotaPublic,
} from "@/lib/line/line-types";

function refuse(
  reason: LineDecisionReason,
  message: string,
  skipReason?: AppointmentReminderSkipReason,
): Extract<AppointmentReminderDecision, { ok: false }> {
  return { ok: false, reason, message, skipReason };
}

export function evaluateAppointmentReminderDispatch(input: {
  organizationId: string;
  actorOrganizationId?: string | null;
  appointment: AppointmentReminderAppointment;
  job: AppointmentReminderJob;
  textBody: string;
  binding?: CustomerLineBinding | null;
  preference?: NotificationPreference | null;
  crmLineUserId?: string | null;
  ownerRecipientLineUserId?: string | null;
  sendOpen?: boolean;
  lineQuota?: LineQuotaPublic | null;
  channelInflight?: boolean;
  nowMs?: number;
}): AppointmentReminderDecision {
  if (input.appointment.organizationId !== input.organizationId) {
    return refuse("unauthorized", "不能發送其他店家的預約提醒", "cross_org");
  }
  if (input.job.organizationId !== input.organizationId) {
    return refuse("unauthorized", "不能領取其他店家的預約提醒任務", "cross_org");
  }
  if (
    input.actorOrganizationId &&
    input.actorOrganizationId !== input.organizationId
  ) {
    return refuse("unauthorized", "不能操作其他店家的預約提醒", "cross_org");
  }
  if (input.job.appointmentId !== input.appointment.id) {
    return refuse("invalid_input", "任務與預約不一致");
  }
  if (!input.job.requestId.startsWith("larq-")) {
    return refuse("invalid_input", "缺少可追蹤的預約提醒發送識別");
  }
  const text = input.textBody ?? "";
  if (!text.trim() || text.length > APPOINTMENT_REMINDER_TEXT_MAX) {
    return refuse("invalid_input", "預約提醒文字不合法");
  }
  if (input.job.status === "accepted") {
    return refuse("duplicate", "這則預約提醒已經被 LINE API 接受，不會重送", "duplicate");
  }
  if (input.job.status === "pending_confirmation") {
    return refuse("pending_confirmation", "上一則發送結果待確認，系統不會自動重送", "inflight");
  }
  if (input.job.status === "failed" || input.job.status === "canceled" || input.job.status === "expired") {
    return refuse("duplicate", "這則任務識別已使用過，不會重送", "duplicate");
  }
  if (!isAppointmentReminderActiveStatus(input.appointment.status)) {
    const skip =
      input.appointment.status === "CANCELLED" || input.appointment.status === "NO_SHOW"
        ? "appointment_cancelled"
        : input.appointment.status === "COMPLETED"
          ? "appointment_completed"
          : "appointment_inactive";
    return refuse("send_closed", "預約狀態已變更，系統不會發送過期提醒", skip);
  }
  const fingerprint = appointmentReminderFingerprint({
    appointmentId: input.appointment.id,
    timingId: input.job.timingId,
    startAt: input.appointment.startAt,
    customerId: input.appointment.customerId,
    serviceId: input.appointment.serviceId,
  });
  if (fingerprint !== input.job.fingerprint) {
    return refuse("send_closed", "預約內容已變更，舊提醒不會發送", "fingerprint_changed");
  }
  const window = appointmentReminderJobIsDue({ job: input.job, nowMs: input.nowMs });
  if (window.expired) {
    return refuse("send_closed", "提醒時間已過，系統不會補送", "expired_window");
  }
  if (!window.due && input.job.status === "scheduled") {
    return refuse("send_closed", "提醒時間尚未到達", "past_due");
  }

  const audience = evaluateAppointmentReminderAudience({
    organizationId: input.organizationId,
    customerId: input.appointment.customerId,
    binding: input.binding,
    preference: input.preference,
    crmLineUserId: input.crmLineUserId,
    ownerRecipientLineUserId: input.ownerRecipientLineUserId,
  });
  if (!audience.ok) {
    return refuse("not_configured", audience.message, audience.skipReason);
  }

  if (input.channelInflight) {
    return refuse("pending_confirmation", "同一 LINE Channel 尚有發送進行中，已停止以免超額", "inflight");
  }
  if (lineQuotaBlocksSend(input.lineQuota)) {
    return refuse(
      "quota_exceeded",
      lineOfficialQuotaBlockMessage(input.lineQuota),
      input.lineQuota?.known ? "quota_exceeded" : "quota_unknown",
    );
  }
  if (!isAppointmentReminderSendOpen(input.sendOpen)) {
    return refuse("send_closed", "預約提醒正式發送尚未開放", "send_closed");
  }
  return { ok: true, requestId: input.job.requestId };
}

export function appointmentReminderFailureMessage(errorClass: LineHttpErrorClass): string {
  switch (errorClass) {
    case "invalid_request":
      return "LINE API 拒絕這則預約提醒（請求不合法）。系統不會自動重送。";
    case "invalid_recipient":
      return "收件者識別不合法，系統沒有呼叫 LINE，也不會自動重送。";
    case "invalid_message":
      return "預約提醒文字不合法，系統沒有呼叫 LINE，也不會自動重送。";
    case "invalid_retry_key":
      return "Retry Key 格式不合法，系統沒有呼叫 LINE，也不會自動重送。";
    case "unauthorized":
      return "LINE API 拒絕這則預約提醒（未授權）。系統不會自動重送。";
    case "forbidden":
      return "LINE API 拒絕這則預約提醒（禁止存取）。系統不會自動重送。";
    case "quota_exceeded":
      return "LINE 訊息額度不足，已停止發送";
    case "timeout":
      return "LINE API 逾時，系統已標記待確認，不會自動重送";
    case "unknown":
      return "LINE API 回傳未知結果，系統已標記待確認，不會自動重送";
  }
}

export function interpretAppointmentReminderApiOutcome(input: {
  timedOut: boolean;
  httpOk: boolean;
  httpStatus?: number | null;
  lineRequestId?: string | null;
  localErrorClass?: LineHttpErrorClass | null;
  unknownDelivery?: boolean;
}): {
  apiResult: LineApiResult;
  status: LineBroadcastStatus;
  message: string;
  errorClass: LineHttpErrorClass | null;
} {
  if (input.timedOut || input.unknownDelivery) {
    return {
      apiResult: "pending_confirmation",
      status: "pending_confirmation",
      message: appointmentReminderFailureMessage(input.timedOut ? "timeout" : "unknown"),
      errorClass: input.timedOut ? "timeout" : "unknown",
    };
  }
  if (input.httpOk) {
    return {
      apiResult: "accepted",
      status: "accepted",
      message: "LINE API 已接受個人 Push。不代表客人已讀取。",
      errorClass: null,
    };
  }
  if (isLineUnknownHttpOutcome(input.httpStatus)) {
    return {
      apiResult: "pending_confirmation",
      status: "pending_confirmation",
      message: appointmentReminderFailureMessage("unknown"),
      errorClass: "unknown",
    };
  }
  if (input.localErrorClass && isLineHttpErrorClass(input.localErrorClass)) {
    return {
      apiResult: "failed",
      status: "failed",
      message: appointmentReminderFailureMessage(input.localErrorClass),
      errorClass: input.localErrorClass,
    };
  }
  const errorClass = classifyLineHttpError({
    timedOut: false,
    httpStatus: input.httpStatus,
  });
  return {
    apiResult: "failed",
    status: "failed",
    message: appointmentReminderFailureMessage(errorClass),
    errorClass,
  };
}
