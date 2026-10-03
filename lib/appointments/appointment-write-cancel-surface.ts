/**
 * Calendar Cancel-surface rules for the Preview Appointment mutate pilot.
 * Mutate ON never falls back to local transitionAppointmentStatus.
 */

import { canTransition, type CanonicalAppointmentStatus } from "@/lib/appointments/domain";
import { isGeneratedAppointmentAppId } from "@/lib/persistence/demo-firewall";

export type CalendarCancelSurface = {
  remoteCancelAvailable: boolean;
  localCancel: boolean;
};

export function resolveCalendarCancelSurface(input: {
  calendarRemoteReadPilot: boolean;
  appointmentRemoteWritePilot: boolean;
  appointmentRemoteMutatePilot: boolean;
  authenticatedOwner: boolean;
}): CalendarCancelSurface {
  if (input.appointmentRemoteMutatePilot) {
    return {
      remoteCancelAvailable: input.authenticatedOwner,
      localCancel: false,
    };
  }
  if (input.calendarRemoteReadPilot || input.appointmentRemoteWritePilot) {
    return { remoteCancelAvailable: false, localCancel: false };
  }
  return { remoteCancelAvailable: false, localCancel: true };
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
  return canTransition(input.status, "CANCELLED");
}

export function resolveCalendarQuickViewActions(input: {
  readOnly: boolean;
  allowRemoteCancel: boolean;
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
  return {
    canEdit:
      !input.readOnly &&
      (input.status === "BOOKED" || input.status === "CONFIRMED"),
    canCancel: input.allowRemoteCancel
      ? canTransition(input.status, "CANCELLED")
      : localCancel,
    canTransition: !input.readOnly,
  };
}
