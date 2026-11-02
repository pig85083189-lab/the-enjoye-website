/**
 * Conservative leave/appointment conflict checks.
 * All times are absolute ISO timestamps. The caller must supply only appointments
 * whose organization, location and staff have been verified server-side.
 */
export type LeaveAppointment = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
};
const NON_BLOCKING = new Set(["CANCELLED", "CANCELED", "NO_SHOW", "REJECTED"]);
export function findLeaveAppointmentConflicts(
  leave: { startAt: string; endAt: string },
  appointments: LeaveAppointment[],
): LeaveAppointment[] {
  const from = Date.parse(leave.startAt);
  const to = Date.parse(leave.endAt);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new Error("INVALID_LEAVE_RANGE");
  }
  return appointments.filter((appointment) => {
    if (!appointment.id || !appointment.status ||
      !Number.isFinite(Date.parse(appointment.starts_at)) ||
      !Number.isFinite(Date.parse(appointment.ends_at))) {
      // Incomplete appointment data must not silently pass an approval check.
      throw new Error("APPOINTMENT_DATA_INCOMPLETE");
    }
    if (NON_BLOCKING.has(appointment.status.toUpperCase())) return false;
    return Date.parse(appointment.starts_at) < to &&
      Date.parse(appointment.ends_at) > from;
  });
}

/** Approval must not proceed until the cross-schema tenant mapping is verified. */
export function assertVerifiedAppointmentScope(input: {
  organizationMapped: boolean;
  locationMapped: boolean;
  staffMapped: boolean;
  completeResultSet: boolean;
}): void {
  if (!input.organizationMapped || !input.locationMapped ||
    !input.staffMapped || !input.completeResultSet) {
    throw new Error("APPOINTMENT_SCOPE_UNVERIFIED");
  }
}
