/**
 * Pure due-date selectors — browser local timezone (no Organization TZ yet).
 */
import {
  formatYmd,
  startOfDay,
} from "@/lib/appointments/domain";
import type { FollowUpTask } from "./domain";

export function localTodayYmd(now: Date = new Date()): string {
  return formatYmd(now);
}

export function dueAtLocalYmd(dueAt: string): string {
  return formatYmd(new Date(dueAt));
}

/** OPEN tasks due on the local calendar day of `now`. */
export function listDueTodayFollowUps(
  tasks: FollowUpTask[],
  now: Date = new Date(),
): FollowUpTask[] {
  const today = localTodayYmd(now);
  return tasks
    .filter((t) => t.status === "OPEN" && dueAtLocalYmd(t.dueAt) === today)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/** OPEN tasks with dueAt before local start of today. */
export function listOverdueFollowUps(
  tasks: FollowUpTask[],
  now: Date = new Date(),
): FollowUpTask[] {
  const boundary = startOfDay(now).getTime();
  return tasks
    .filter(
      (t) => t.status === "OPEN" && new Date(t.dueAt).getTime() < boundary,
    )
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/** OPEN tasks due after today (local calendar). */
export function listUpcomingFollowUps(
  tasks: FollowUpTask[],
  now: Date = new Date(),
): FollowUpTask[] {
  const today = localTodayYmd(now);
  return tasks
    .filter((t) => t.status === "OPEN" && dueAtLocalYmd(t.dueAt) > today)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export function listCompletedFollowUps(tasks: FollowUpTask[]): FollowUpTask[] {
  return tasks
    .filter((t) => t.status === "COMPLETED")
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));
}

export function listOpenFollowUps(tasks: FollowUpTask[]): FollowUpTask[] {
  return tasks
    .filter((t) => t.status === "OPEN")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
