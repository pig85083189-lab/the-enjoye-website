import { evaluateAppointmentReminderAudience } from "@/lib/line/automations/appointment-reminder-bindings";
import { evaluateAppointmentReminderDispatch } from "@/lib/line/automations/appointment-reminder-command";
import { appointmentReminderJobIsDue } from "@/lib/line/automations/appointment-reminder-jobs";
import { appointmentReminderFingerprint } from "@/lib/line/automations/appointment-reminder-scheduler";
import { renderAppointmentReminderTemplate, appointmentReminderTemplateVars } from "@/lib/line/automations/appointment-reminder-templates";
import type {
  AppointmentReminderAppointment,
  AppointmentReminderDryRunRecord,
  AppointmentReminderJob,
  AppointmentReminderRule,
  CustomerLineBinding,
  NotificationPreference,
} from "@/lib/line/automations/appointment-reminder-types";
import { reminderChannelSnapshotAllowsSend } from "@/lib/line/automations/appointment-reminder-dispatcher";
import type { LineQuotaPublic } from "@/lib/line/line-types";

export function evaluateAppointmentReminderDryRun(input: {
  organizationId: string;
  appointment: AppointmentReminderAppointment;
  job: AppointmentReminderJob;
  rule: AppointmentReminderRule;
  binding?: CustomerLineBinding | null;
  preference?: NotificationPreference | null;
  crmLineUserId?: string | null;
  lineQuota?: LineQuotaPublic | null;
  quotaCheckedAt?: string | null;
  channelInflight?: boolean;
  nowMs?: number;
}): Omit<AppointmentReminderDryRunRecord, "id" | "createdAt"> {
  const nowMs = input.nowMs ?? Date.now();
  if (!input.rule.enabled || input.rule.organizationId !== input.organizationId) {
    return {
      organizationId: input.organizationId,
      jobId: input.job.id,
      requestId: input.job.requestId,
      eligible: false,
      skipReason: "rule_disabled",
      message: "規則未啟用，Dry-run 不會發送",
    };
  }
  const textBody = renderAppointmentReminderTemplate(
    input.rule.template,
    appointmentReminderTemplateVars({ appointment: input.appointment }),
  );
  const window = appointmentReminderJobIsDue({ job: input.job, nowMs });
  if (window.expired) {
    return {
      organizationId: input.organizationId,
      jobId: input.job.id,
      requestId: input.job.requestId,
      eligible: false,
      skipReason: "expired_window",
      message: "提醒時間已過，不會補送",
    };
  }
  const fingerprint = appointmentReminderFingerprint({
    appointmentId: input.appointment.id,
    timingId: input.job.timingId,
    startAt: input.appointment.startAt,
    customerId: input.appointment.customerId,
    serviceId: input.appointment.serviceId,
  });
  if (fingerprint !== input.job.fingerprint) {
    return {
      organizationId: input.organizationId,
      jobId: input.job.id,
      requestId: input.job.requestId,
      eligible: false,
      skipReason: "fingerprint_changed",
      message: "預約內容已變更",
    };
  }
  const audience = evaluateAppointmentReminderAudience({
    organizationId: input.organizationId,
    customerId: input.appointment.customerId,
    binding: input.binding,
    preference: input.preference,
    crmLineUserId: input.crmLineUserId,
  });
  if (!audience.ok) {
    return {
      organizationId: input.organizationId,
      jobId: input.job.id,
      requestId: input.job.requestId,
      eligible: false,
      skipReason: audience.skipReason,
      message: audience.message,
    };
  }
  const snapshot = reminderChannelSnapshotAllowsSend({
    quota: input.lineQuota,
    quotaCheckedAt: input.quotaCheckedAt,
    nowMs,
    channelInflight: input.channelInflight,
  });
  if (!snapshot.ok) {
    return {
      organizationId: input.organizationId,
      jobId: input.job.id,
      requestId: input.job.requestId,
      eligible: false,
      skipReason: snapshot.reason === "inflight" ? "inflight" : "quota_exceeded",
      message: snapshot.message,
    };
  }
  const gate = evaluateAppointmentReminderDispatch({
    organizationId: input.organizationId,
    appointment: input.appointment,
    job: input.job,
    textBody,
    binding: input.binding,
    preference: input.preference,
    crmLineUserId: input.crmLineUserId,
    sendOpen: false,
    lineQuota: input.lineQuota,
    channelInflight: input.channelInflight,
    nowMs,
  });
  return {
    organizationId: input.organizationId,
    jobId: input.job.id,
    requestId: input.job.requestId,
    eligible: gate.ok === false && gate.skipReason === "send_closed",
    skipReason: gate.ok ? undefined : gate.skipReason === "send_closed" ? undefined : gate.skipReason,
    message: gate.ok
      ? "Dry-run 通過，正式發送仍關閉"
      : gate.skipReason === "send_closed"
        ? "檢查通過。Dry-run 不會連接 LINE Push"
        : gate.message,
  };
}

export function dryRunEligibleWhenSendClosed(
  result: Omit<AppointmentReminderDryRunRecord, "id" | "createdAt">,
): boolean {
  return result.eligible === true || result.message.includes("不會連接 LINE Push");
}
