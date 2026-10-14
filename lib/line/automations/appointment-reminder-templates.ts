import { utcIsoToTaipeiLocal } from "@/lib/persistence/appointment-time";
import type { AppointmentReminderAppointment } from "@/lib/line/automations/appointment-reminder-types";
import { DEFAULT_APPOINTMENT_REMINDER_TEMPLATE } from "@/lib/line/automations/appointment-reminder-rules";
import { APPOINTMENT_REMINDER_TEXT_MAX } from "@/lib/line/automations/appointment-reminder-flag";

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;

export type AppointmentReminderTemplateVars = {
  organizationName: string;
  customerName: string;
  appointmentDate: string;
  appointmentWeekday: string;
  appointmentTime: string;
  serviceName: string;
  locationName: string;
};

export function appointmentReminderTemplateVars(input: {
  appointment: AppointmentReminderAppointment;
  organizationName?: string | null;
}): AppointmentReminderTemplateVars {
  const local = utcIsoToTaipeiLocal(input.appointment.startAt);
  const [year, month, day] = local.dateYmd.split("-");
  const utc = new Date(`${local.dateYmd}T00:00:00.000Z`);
  return {
    organizationName: (input.organizationName ?? "").trim() || "THE ENJOYE",
    customerName: input.appointment.customerName.trim() || "客人",
    appointmentDate: `${year}/${month}/${day}`,
    appointmentWeekday: WEEKDAYS[utc.getUTCDay()] ?? "",
    appointmentTime: local.hm,
    serviceName: input.appointment.serviceName.trim() || "課程",
    locationName: (input.appointment.locationName ?? "").trim() || "",
  };
}

export function renderAppointmentReminderTemplate(
  template: string,
  vars: AppointmentReminderTemplateVars,
): string {
  const source = template.trim() || DEFAULT_APPOINTMENT_REMINDER_TEMPLATE;
  const rendered = source.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key as keyof AppointmentReminderTemplateVars];
    return value ?? "";
  });
  return rendered.slice(0, APPOINTMENT_REMINDER_TEXT_MAX);
}

export function previewAppointmentReminderTemplate(input: {
  template: string;
  appointment?: AppointmentReminderAppointment | null;
  organizationName?: string | null;
}): string {
  const appointment = input.appointment ?? {
    id: "apt-preview",
    organizationId: "org-preview",
    customerId: "cust-preview",
    customerName: "客人",
    serviceId: "svc-preview",
    serviceName: "美胸 SPA",
    locationName: "THE ENJOYE 台中店",
    startAt: "2026-10-13T08:00:00.000Z",
    endAt: "2026-10-13T09:00:00.000Z",
    status: "BOOKED",
  };
  return renderAppointmentReminderTemplate(
    input.template,
    appointmentReminderTemplateVars({
      appointment,
      organizationName: input.organizationName,
    }),
  );
}
