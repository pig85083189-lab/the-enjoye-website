import type { Appointment } from "@/types";

/**
 * Next actionable guest for the briefing panel.
 * Prefer in-progress service; else earliest non-completed by time.
 */
export function getNextAppointment(
  appointments: Appointment[],
): Appointment | undefined {
  const actionable = appointments.filter(
    (item) => item.status !== "completed",
  );
  const inProgress = actionable.find((item) => item.status === "in_progress");
  if (inProgress) return inProgress;
  return [...actionable].sort((a, b) => a.time.localeCompare(b.time))[0];
}

export function sortAppointmentsByTime(
  appointments: Appointment[],
): Appointment[] {
  return [...appointments].sort((a, b) => a.time.localeCompare(b.time));
}
