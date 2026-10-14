import {
  addMinutesToIso,
  taipeiLocalToUtcIso,
  utcIsoToTaipeiLocal,
} from "@/lib/persistence/appointment-time";
import {
  isAppointmentReminderActiveStatus,
  type AppointmentReminderAppointment,
  type AppointmentReminderJob,
  type AppointmentReminderRule,
  type AppointmentReminderSkipReason,
  type AppointmentReminderTimingId,
  type PlannedAppointmentReminderJob,
} from "@/lib/line/automations/appointment-reminder-types";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function subtractTaipeiCalendarDays(dateYmd: string, days: number): string {
  const [year, month, day] = dateYmd.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) - days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export function computeAppointmentReminderFireAt(
  timingId: AppointmentReminderTimingId,
  startAt: string,
): string {
  if (timingId === "day_before_morning") {
    const { dateYmd } = utcIsoToTaipeiLocal(startAt);
    return taipeiLocalToUtcIso(subtractTaipeiCalendarDays(dateYmd, 1), "10:00");
  }
  return addMinutesToIso(startAt, -180);
}

export function appointmentReminderFingerprint(input: {
  appointmentId: string;
  timingId: AppointmentReminderTimingId;
  startAt: string;
  customerId: string;
  serviceId: string;
}): string {
  return [
    input.appointmentId,
    input.timingId,
    input.startAt,
    input.customerId,
    input.serviceId,
  ].join("|");
}

export function voidReasonForAppointment(
  appointment: AppointmentReminderAppointment,
): AppointmentReminderSkipReason | null {
  if (appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") {
    return "appointment_cancelled";
  }
  if (appointment.status === "COMPLETED") return "appointment_completed";
  if (!isAppointmentReminderActiveStatus(appointment.status)) {
    return "appointment_inactive";
  }
  return null;
}

export type AppointmentReminderPlan = {
  organizationId: string;
  appointmentId: string;
  toCancel: Array<{ fingerprint?: string; timingId?: AppointmentReminderTimingId; reason: AppointmentReminderSkipReason }>;
  toCreate: PlannedAppointmentReminderJob[];
  skipped: Array<{ timingId: AppointmentReminderTimingId; reason: AppointmentReminderSkipReason; scheduledFor?: string }>;
};

export function planAppointmentReminderJobs(input: {
  organizationId: string;
  appointment: AppointmentReminderAppointment;
  rule: AppointmentReminderRule;
  nowMs?: number;
}): AppointmentReminderPlan {
  const nowMs = input.nowMs ?? Date.now();
  const appointment = input.appointment;
  const skipped: AppointmentReminderPlan["skipped"] = [];
  const toCreate: PlannedAppointmentReminderJob[] = [];

  if (appointment.organizationId !== input.organizationId) {
    return {
      organizationId: input.organizationId,
      appointmentId: appointment.id,
      toCancel: [{ reason: "cross_org" }],
      toCreate: [],
      skipped,
    };
  }

  const voidReason = voidReasonForAppointment(appointment);
  if (voidReason) {
    return {
      organizationId: input.organizationId,
      appointmentId: appointment.id,
      toCancel: [{ reason: voidReason }],
      toCreate: [],
      skipped,
    };
  }

  if (!input.rule.enabled || input.rule.organizationId !== input.organizationId) {
    return {
      organizationId: input.organizationId,
      appointmentId: appointment.id,
      toCancel: [{ reason: input.rule.enabled ? "cross_org" : "rule_disabled" }],
      toCreate: [],
      skipped,
    };
  }

  for (const timingId of input.rule.selectedTimingIds) {
    const scheduledFor = computeAppointmentReminderFireAt(timingId, appointment.startAt);
    if (Date.parse(scheduledFor) <= nowMs) {
      skipped.push({ timingId, reason: "past_due", scheduledFor });
      continue;
    }
    toCreate.push({
      organizationId: input.organizationId,
      appointmentId: appointment.id,
      customerId: appointment.customerId,
      serviceId: appointment.serviceId,
      timingId,
      fingerprint: appointmentReminderFingerprint({
        appointmentId: appointment.id,
        timingId,
        startAt: appointment.startAt,
        customerId: appointment.customerId,
        serviceId: appointment.serviceId,
      }),
      scheduledFor,
    });
  }

  return {
    organizationId: input.organizationId,
    appointmentId: appointment.id,
    toCancel: [{ reason: "fingerprint_changed" }],
    toCreate,
    skipped,
  };
}

export function jobMatchesPlan(
  job: AppointmentReminderJob,
  planned: PlannedAppointmentReminderJob,
): boolean {
  return (
    job.organizationId === planned.organizationId &&
    job.appointmentId === planned.appointmentId &&
    job.timingId === planned.timingId &&
    job.fingerprint === planned.fingerprint &&
    job.scheduledFor === planned.scheduledFor &&
    job.customerId === planned.customerId &&
    job.serviceId === planned.serviceId
  );
}

export function countPlannedAppointmentReminders(
  plans: readonly AppointmentReminderPlan[],
): number {
  return plans.reduce((sum, plan) => sum + plan.toCreate.length, 0);
}
