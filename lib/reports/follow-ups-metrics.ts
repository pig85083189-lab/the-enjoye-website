import {
  listOverdueFollowUps,
  listOpenFollowUps,
} from "@/lib/follow-ups/selectors";
import { listFollowUpTasks } from "@/lib/follow-ups/store";
import type { FollowUpSummary, ReportQuery } from "./domain";
import { isInstantInRange, safeRate } from "./date-range";

/**
 * Follow-up snapshot for reports.
 * Open / overdue = current open state (not historical as-of).
 * Completed in range = completedAt within report window.
 * Rate denominator = openNotOverdue + overdue + completedInRange.
 */
export function getFollowUpSummary(
  query: ReportQuery,
  now: Date = new Date(),
): FollowUpSummary {
  if (!query.organizationId) throw new Error("organizationId is required");

  let tasks = listFollowUpTasks(query.organizationId).filter(
    (t) => t.organizationId === query.organizationId,
  );
  if (query.locationId) {
    tasks = tasks.filter(
      (t) => !t.locationId || t.locationId === query.locationId,
    );
  }

  const open = listOpenFollowUps(tasks);
  const overdue = listOverdueFollowUps(tasks, now);
  const overdueIds = new Set(overdue.map((o) => o.id));
  const openNotOverdue = open.filter((t) => !overdueIds.has(t.id));
  const completedInRange = tasks.filter(
    (t) =>
      t.status === "COMPLETED" &&
      t.completedAt &&
      isInstantInRange(t.completedAt, query.range),
  );

  const openCount = openNotOverdue.length;
  const overdueCount = overdue.length;
  const completedInRangeCount = completedInRange.length;
  const denom = openCount + overdueCount + completedInRangeCount;

  return {
    openCount,
    overdueCount,
    completedInRangeCount,
    completionRate: safeRate(completedInRangeCount, denom),
  };
}
