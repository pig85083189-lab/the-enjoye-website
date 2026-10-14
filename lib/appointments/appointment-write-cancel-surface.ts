/**
 * Calendar Cancel / Reschedule-surface rules for the Preview Appointment
 * mutate pilot. Mutate ON never falls back to local transitionAppointmentStatus
 * or local updateAppointment.
 */

import {
  isAppointmentCancellable,
  type CanonicalAppointmentStatus,
} from "@/lib/appointments/domain";
import { isGeneratedAppointmentAppId } from "@/lib/persistence/demo-firewall";

export type CalendarCancelSurface = {
  remoteCancelAvailable: boolean;
  localCancel: boolean;
};

export type CalendarRescheduleSurface = {
  remoteRescheduleAvailable: boolean;
  localReschedule: boolean;
};

function resolveCalendarMutateAvailability(input: {
  calendarRemoteReadPilot: boolean;
  appointmentRemoteWritePilot: boolean;
  appointmentRemoteMutatePilot: boolean;
  authenticatedOwner: boolean;
}): { remote: boolean; local: boolean } {
  if (input.appointmentRemoteMutatePilot) {
    return { remote: input.authenticatedOwner, local: false };
  }
  if (input.calendarRemoteReadPilot || input.appointmentRemoteWritePilot) {
    return { remote: false, local: false };
  }
  return { remote: false, local: true };
}

export function resolveCalendarCancelSurface(input: {
  calendarRemoteReadPilot: boolean;
  appointmentRemoteWritePilot: boolean;
  appointmentRemoteMutatePilot: boolean;
  authenticatedOwner: boolean;
}): CalendarCancelSurface {
  const availability = resolveCalendarMutateAvailability(input);
  return {
    remoteCancelAvailable: availability.remote,
    localCancel: availability.local,
  };
}

export function resolveCalendarRescheduleSurface(input: {
  calendarRemoteReadPilot: boolean;
  appointmentRemoteWritePilot: boolean;
  appointmentRemoteMutatePilot: boolean;
  authenticatedOwner: boolean;
}): CalendarRescheduleSurface {
  const availability = resolveCalendarMutateAvailability(input);
  return {
    remoteRescheduleAvailable: availability.remote,
    localReschedule: availability.local,
  };
}

export function isCalendarRemoteRescheduleEligible(input: {
  remoteRescheduleAvailable: boolean;
  appointmentId: string;
  status: CanonicalAppointmentStatus;
  updatedAt?: string;
}): boolean {
  if (!input.remoteRescheduleAvailable) return false;
  if (!isGeneratedAppointmentAppId(input.appointmentId)) return false;
  if (!input.updatedAt?.trim()) return false;
  return input.status === "BOOKED" || input.status === "CONFIRMED";
}

export function isCalendarRemoteCancelEligible(input: {
  remoteCancelAvailable: boolean;
  appointmentId: string;
  status: CanonicalAppointmentStatus;
  updatedAt?: string;
}): boolean {
  if (!input.remoteCancelAvailable) return false;
  if (!isGeneratedAppointmentAppId(input.appointmentId)) return false;
  if (!input.updatedAt?.trim()) return false;
  return isAppointmentCancellable(input.status);
}

export function resolveCalendarQuickViewActions(input: {
  readOnly: boolean;
  allowRemoteCancel: boolean;
  allowRemoteReschedule?: boolean;
  status: CanonicalAppointmentStatus;
}): {
  canEdit: boolean;
  canCancel: boolean;
  canTransition: boolean;
} {
  const localCancel =
    !input.readOnly &&
    (input.status === "BOOKED" ||
      input.status === "CONFIRMED" ||
      input.status === "ARRIVED");
  const localEdit =
    !input.readOnly &&
    (input.status === "BOOKED" || input.status === "CONFIRMED");
  return {
    canEdit: input.allowRemoteReschedule
      ? input.status === "BOOKED" || input.status === "CONFIRMED"
      : localEdit,
    canCancel: input.allowRemoteCancel
      ? isAppointmentCancellable(input.status)
      : localCancel,
    canTransition: !input.readOnly,
  };
}
