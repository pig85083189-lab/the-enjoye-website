/**
 * Calendar create-surface rules for the Preview Appointment write pilot.
 * Write ON never falls back to local createAppointment.
 */

export type CalendarCreateSurface = {
  createEnabled: boolean;
  remoteCreate: boolean;
  localCreate: boolean;
};

export function resolveCalendarCreateSurface(input: {
  calendarRemoteReadPilot: boolean;
  appointmentRemoteWritePilot: boolean;
  canCreateAppointment: boolean;
}): CalendarCreateSurface {
  if (input.appointmentRemoteWritePilot) {
    const remoteCreate = input.canCreateAppointment;
    return {
      createEnabled: remoteCreate,
      remoteCreate,
      localCreate: false,
    };
  }
  if (input.calendarRemoteReadPilot) {
    return { createEnabled: false, remoteCreate: false, localCreate: false };
  }
  return { createEnabled: true, remoteCreate: false, localCreate: true };
}
