import { listAppointments } from "@/lib/appointments/store";
import type { AppointmentSummary, ReportQuery } from "./domain";
import { safeRate } from "./date-range";

/**
 * Appointment metrics by startAt in range.
 * DRAFT excluded from denominator.
 * Rates: completed|cancelled|noShow / total (non-DRAFT in range).
 */
export function getAppointmentSummary(query: ReportQuery): AppointmentSummary {
  if (!query.organizationId) throw new Error("organizationId is required");

  const list = listAppointments({
    organizationId: query.organizationId,
    locationId: query.locationId,
    from: query.range.startAt,
    to: query.range.endAt,
  }).filter(
    (a) =>
      a.organizationId === query.organizationId &&
      a.status !== "DRAFT",
  );

  let completed = 0;
  let cancelled = 0;
  let noShow = 0;
  let incomplete = 0;
  for (const a of list) {
    if (a.status === "COMPLETED") completed += 1;
    else if (a.status === "CANCELLED") cancelled += 1;
    else if (a.status === "NO_SHOW") noShow += 1;
    else incomplete += 1;
  }
  const total = list.length;
  return {
    total,
    completed,
    cancelled,
    noShow,
    incomplete,
    completionRate: safeRate(completed, total),
    cancellationRate: safeRate(cancelled, total),
    noShowRate: safeRate(noShow, total),
    incompleteRate: safeRate(incomplete, total),
  };
}
