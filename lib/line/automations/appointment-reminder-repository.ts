import {
  applyAppointmentReminderPlan,
  newAppointmentReminderJobId,
  newAppointmentReminderRequestId,
  type AppointmentReminderJobStore,
} from "@/lib/line/automations/appointment-reminder-jobs";
import { planAppointmentReminderJobs } from "@/lib/line/automations/appointment-reminder-scheduler";
import type {
  AppointmentReminderAppointment,
  AppointmentReminderDelivery,
  AppointmentReminderDryRunRecord,
  AppointmentReminderJob,
  AppointmentReminderRule,
  CustomerLineBinding,
  NotificationPreference,
} from "@/lib/line/automations/appointment-reminder-types";

export type AppointmentReminderWorkspaceSnapshot = {
  rule: AppointmentReminderRule;
  saved: boolean;
  bindCount: number;
  plannedCount: number;
  deliveries: AppointmentReminderDelivery[];
  dryRuns: AppointmentReminderDryRunRecord[];
};

export type AppointmentReminderRepository = AppointmentReminderJobStore & {
  getRule(organizationId: string): Promise<AppointmentReminderRule | null>;
  saveRule(rule: AppointmentReminderRule, staffUserId: string): Promise<{ persisted: boolean }>;
  getAppointment(
    organizationId: string,
    appointmentId: string,
  ): Promise<AppointmentReminderAppointment | null>;
  getBinding(organizationId: string, customerId: string): Promise<CustomerLineBinding | null>;
  getPreference(organizationId: string, customerId: string): Promise<NotificationPreference | null>;
  readWorkspace(organizationId: string): Promise<AppointmentReminderWorkspaceSnapshot | null>;
  syncAppointment(
    organizationId: string,
    appointment: AppointmentReminderAppointment,
    rule: AppointmentReminderRule,
    nowMs?: number,
  ): Promise<AppointmentReminderJob[]>;
  recordDryRun(row: Omit<AppointmentReminderDryRunRecord, "id" | "createdAt">): Promise<void>;
  listDueJobs(organizationId: string, nowMs: number): Promise<AppointmentReminderJob[]>;
};

export function plannedJobsToInsertPayload(jobs: AppointmentReminderJob[]) {
  return jobs.map((job) => ({
    id: job.id,
    organizationId: job.organizationId,
    appointmentId: job.appointmentId,
    customerId: job.customerId,
    serviceId: job.serviceId,
    timingId: job.timingId,
    fingerprint: job.fingerprint,
    scheduledFor: job.scheduledFor,
    requestId: job.requestId,
  }));
}

export function createJobsFromPlan(
  store: AppointmentReminderJobStore,
  organizationId: string,
  appointment: AppointmentReminderAppointment,
  rule: AppointmentReminderRule,
  nowMs = Date.now(),
  random?: () => string,
): AppointmentReminderJob[] {
  const plan = planAppointmentReminderJobs({
    organizationId,
    appointment,
    rule,
    nowMs,
  });
  const created = applyAppointmentReminderPlan(store, plan, nowMs, random);
  return created.map((job) => ({
    ...job,
    id: job.id || newAppointmentReminderJobId(random),
    requestId: job.requestId || newAppointmentReminderRequestId(random),
  }));
}
