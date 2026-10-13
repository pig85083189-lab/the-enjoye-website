import {
  isAppointmentReminderCronDispatchOpen,
  LINE_APPOINTMENT_REMINDER_CRON_SECRET_ENV,
} from "@/lib/line/automations/appointment-reminder-flag";
import { dispatchAppointmentReminderJob } from "@/lib/line/automations/appointment-reminder-dispatcher";
import {
  appointmentReminderJobIsDue,
  expireOverdueAppointmentReminderJobs,
  type AppointmentReminderJobStore,
} from "@/lib/line/automations/appointment-reminder-jobs";
import { renderAppointmentReminderTemplate, appointmentReminderTemplateVars } from "@/lib/line/automations/appointment-reminder-templates";
import type { AppointmentReminderMemoryState } from "@/lib/line/automations/appointment-reminder-store";
import type { LineQuotaPublic } from "@/lib/line/line-types";

export function authorizeAppointmentReminderCron(input: {
  authorization?: string | null;
  vercelCron?: string | null;
  env?: NodeJS.Dict<string>;
}): { ok: true } | { ok: false; status: number; message: string } {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  const secret = (env[LINE_APPOINTMENT_REMINDER_CRON_SECRET_ENV] ?? "").trim();
  const header = (input.authorization ?? "").trim();
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header;
  if (secret && token && token === secret) return { ok: true };
  if (input.vercelCron === "1" && (env.VERCEL_ENV ?? "").trim()) return { ok: true };
  return { ok: false, status: 401, message: "Cron 驗證失敗" };
}

export async function runAppointmentReminderCronTick(input: {
  store: AppointmentReminderJobStore & {
    state?: AppointmentReminderMemoryState;
    getAppointment?(organizationId: string, appointmentId: string): { organizationId: string; id: string } | undefined;
    getBinding?(organizationId: string, customerId: string): unknown;
    getPreference?(organizationId: string, customerId: string): unknown;
    getRule?(organizationId: string): { template: string; organizationId: string } | undefined;
  };
  organizationIds: string[];
  nowMs?: number;
  dispatchOpen?: boolean;
  sendOpen?: boolean;
  lineQuota?: LineQuotaPublic | null;
  quotaCheckedAt?: string | null;
  channelInflight?: boolean;
  accessToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  skipped: boolean;
  reason?: string;
  expired: number;
  attempted: number;
  accepted: number;
}> {
  if (!isAppointmentReminderCronDispatchOpen(input.dispatchOpen)) {
    return { skipped: true, reason: "send_closed", expired: 0, attempted: 0, accepted: 0 };
  }

  const nowMs = input.nowMs ?? Date.now();
  let expired = 0;
  let attempted = 0;
  let accepted = 0;

  for (const organizationId of input.organizationIds) {
    if (!organizationId.startsWith("org-")) continue;
    expired += expireOverdueAppointmentReminderJobs(input.store, organizationId, nowMs).length;
    const due = input.store
      .listJobs(organizationId)
      .filter((job) => job.status === "scheduled" && appointmentReminderJobIsDue({ job, nowMs }).due);

    for (const job of due) {
      const appointment = input.store.state?.appointments.find(
        (row) => row.organizationId === organizationId && row.id === job.appointmentId,
      );
      const rule = input.store.getRule?.(organizationId);
      if (!appointment || !rule) continue;
      attempted += 1;
      const textBody = renderAppointmentReminderTemplate(
        rule.template,
        appointmentReminderTemplateVars({ appointment }),
      );
      const result = await dispatchAppointmentReminderJob({
        store: input.store,
        context: {
          organizationId,
          appointment,
          job,
          textBody,
          binding: input.store.state?.bindings.find(
            (row) => row.organizationId === organizationId && row.customerId === appointment.customerId,
          ),
          preference: input.store.state?.preferences.find(
            (row) => row.organizationId === organizationId && row.customerId === appointment.customerId,
          ),
          crmLineUserId: input.store.state?.crmLineUserIds[`${organizationId}:${appointment.customerId}`],
          sendOpen: input.sendOpen,
          lineQuota: input.lineQuota,
          quotaCheckedAt: input.quotaCheckedAt,
          channelInflight: input.channelInflight,
          accessToken: input.accessToken,
          fetchImpl: input.fetchImpl,
          nowMs,
        },
      });
      if (result.status === "accepted") accepted += 1;
    }
  }

  return { skipped: false, expired, attempted, accepted };
}
