/**
 * Customer 360 appointment-create surface.
 * Calendar `?create=1&customer=` is the only create flow.
 * Remote-read without Appointment WRITE stays disabled.
 * Appointment WRITE re-enables the same canonical href with the current cust-*.
 */

import { customerCreateAppointmentHref } from "./customer-360";

export const CUSTOMER_360_APPOINTMENT_CREATE_UNAVAILABLE_REASON =
  "遠端預約建立尚未開放";

export type Customer360AppointmentCreateSurface =
  | { mode: "local-create"; href: string; disabled: false }
  | { mode: "remote-create"; href: string; disabled: false }
  | {
      mode: "remote-read-only";
      href: null;
      disabled: true;
      reason: typeof CUSTOMER_360_APPOINTMENT_CREATE_UNAVAILABLE_REASON;
    };

export function resolveCustomer360AppointmentCreateSurface(input: {
  customerId: string;
  customerRemoteReadPilot: boolean;
  appointmentRemoteReadPilot: boolean;
  appointmentRemoteWritePilot?: boolean;
}): Customer360AppointmentCreateSurface {
  const href = customerCreateAppointmentHref(input.customerId);
  if (input.appointmentRemoteWritePilot) {
    return { mode: "remote-create", href, disabled: false };
  }
  if (input.customerRemoteReadPilot || input.appointmentRemoteReadPilot) {
    return {
      mode: "remote-read-only",
      href: null,
      disabled: true,
      reason: CUSTOMER_360_APPOINTMENT_CREATE_UNAVAILABLE_REASON,
    };
  }
  return { mode: "local-create", href, disabled: false };
}
