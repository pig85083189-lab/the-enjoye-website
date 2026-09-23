import type { Appointment } from "@/types";

/** Next actionable guest: earliest non-completed by time */
export function getNextAppointment(
  appointments: Appointment[],
): Appointment | undefined {
  return [...appointments]
    .filter((item) => item.status !== "completed")
    .sort((a, b) => a.time.localeCompare(b.time))[0];
}

export function sortAppointmentsByTime(appointments: Appointment[]): Appointment[] {
  return [...appointments].sort((a, b) => a.time.localeCompare(b.time));
}
