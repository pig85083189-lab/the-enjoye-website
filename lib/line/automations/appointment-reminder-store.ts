import type {
  AppointmentReminderAppointment,
  AppointmentReminderDelivery,
  AppointmentReminderJob,
  AppointmentReminderRule,
  CustomerLineBinding,
  NotificationPreference,
} from "@/lib/line/automations/appointment-reminder-types";
import type { AppointmentReminderJobStore } from "@/lib/line/automations/appointment-reminder-jobs";

export type AppointmentReminderMemoryState = {
  rules: AppointmentReminderRule[];
  jobs: AppointmentReminderJob[];
  deliveries: AppointmentReminderDelivery[];
  bindings: CustomerLineBinding[];
  preferences: NotificationPreference[];
  appointments: AppointmentReminderAppointment[];
  crmLineUserIds: Record<string, string>;
};

export function createAppointmentReminderMemoryState(): AppointmentReminderMemoryState {
  return {
    rules: [],
    jobs: [],
    deliveries: [],
    bindings: [],
    preferences: [],
    appointments: [],
    crmLineUserIds: {},
  };
}

export function createAppointmentReminderMemoryStore(
  state: AppointmentReminderMemoryState = createAppointmentReminderMemoryState(),
): AppointmentReminderJobStore & {
  state: AppointmentReminderMemoryState;
  getRule(organizationId: string): AppointmentReminderRule | undefined;
  putRule(rule: AppointmentReminderRule): void;
  getAppointment(organizationId: string, appointmentId: string): AppointmentReminderAppointment | undefined;
  putAppointment(appointment: AppointmentReminderAppointment): void;
  getBinding(organizationId: string, customerId: string): CustomerLineBinding | undefined;
  putBinding(binding: CustomerLineBinding): void;
  getPreference(organizationId: string, customerId: string): NotificationPreference | undefined;
  putPreference(preference: NotificationPreference): void;
} {
  return {
    state,
    listJobs(organizationId) {
      if (!organizationId.startsWith("org-")) return [];
      return state.jobs.filter((job) => job.organizationId === organizationId);
    },
    upsertJob(job) {
      if (!job.organizationId.startsWith("org-")) return;
      const index = state.jobs.findIndex(
        (row) => row.organizationId === job.organizationId && row.id === job.id,
      );
      if (index >= 0) state.jobs[index] = job;
      else state.jobs.push(job);
    },
    getJobByRequestId(organizationId, requestId) {
      return state.jobs.find(
        (job) => job.organizationId === organizationId && job.requestId === requestId,
      );
    },
    listDeliveries(organizationId) {
      return state.deliveries.filter((row) => row.organizationId === organizationId);
    },
    addDelivery(row) {
      if (state.deliveries.some((item) => item.requestId === row.requestId)) return;
      state.deliveries.push(row);
    },
    getRule(organizationId) {
      return state.rules.find((row) => row.organizationId === organizationId);
    },
    putRule(rule) {
      const index = state.rules.findIndex((row) => row.organizationId === rule.organizationId);
      if (index >= 0) state.rules[index] = rule;
      else state.rules.push(rule);
    },
    getAppointment(organizationId, appointmentId) {
      return state.appointments.find(
        (row) => row.organizationId === organizationId && row.id === appointmentId,
      );
    },
    putAppointment(appointment) {
      const index = state.appointments.findIndex(
        (row) => row.organizationId === appointment.organizationId && row.id === appointment.id,
      );
      if (index >= 0) state.appointments[index] = appointment;
      else state.appointments.push(appointment);
    },
    getBinding(organizationId, customerId) {
      return state.bindings.find(
        (row) => row.organizationId === organizationId && row.customerId === customerId,
      );
    },
    putBinding(binding) {
      const index = state.bindings.findIndex(
        (row) => row.organizationId === binding.organizationId && row.customerId === binding.customerId,
      );
      if (index >= 0) state.bindings[index] = binding;
      else state.bindings.push(binding);
    },
    getPreference(organizationId, customerId) {
      return state.preferences.find(
        (row) => row.organizationId === organizationId && row.customerId === customerId,
      );
    },
    putPreference(preference) {
      const index = state.preferences.findIndex(
        (row) =>
          row.organizationId === preference.organizationId &&
          row.customerId === preference.customerId,
      );
      if (index >= 0) state.preferences[index] = preference;
      else state.preferences.push(preference);
    },
  };
}
