import { LINE_AUTOMATION_SEND_OPEN } from "@/lib/line/automations/production-safe-flags";
import { planLineAutomationSchedule } from "@/lib/line/automations/schedule-engine";
import {
  applyStatusForRecipient,
  canInsertAutomationJob,
  canMutateAutomationJob,
  isInFlightAutomationJobStatus,
  isNeverResendAutomationJobStatus,
} from "@/lib/line/automations/schedule-validate";
import type {
  LineAutomationExistingJob,
  LineAutomationProposedJob,
  LineAutomationScheduleMutation,
  LineAutomationSchedulePlan,
  LineAutomationScheduleSnapshot,
} from "@/lib/line/automations/schedule-types";

export function proposedJobStatus(job: Pick<LineAutomationProposedJob, "recipientReady">) {
  return applyStatusForRecipient(job.recipientReady);
}

function shouldCancelExistingJob(input: {
  job: LineAutomationExistingJob;
  desired: Map<string, LineAutomationProposedJob>;
  plan: LineAutomationSchedulePlan;
}): boolean {
  if (!input.plan.cancelPolicy.allowCancel) return false;
  if (!canMutateAutomationJob(input.job.status)) return false;
  if (input.desired.has(input.job.fingerprint)) return false;
  if (input.plan.cancelPolicy.disabledTypes.includes(input.job.automationType)) return true;
  return input.plan.cancelPolicy.scannedEvents.some(
    (event) =>
      event.automationType === input.job.automationType && event.eventId === input.job.eventId,
  );
}

export function diffLineAutomationSchedule(input: {
  organizationId: string;
  plan: LineAutomationSchedulePlan;
  existingJobs: readonly LineAutomationExistingJob[];
}): LineAutomationScheduleMutation {
  if (LINE_AUTOMATION_SEND_OPEN !== false) {
    return { insert: [], update: [], cancel: [], unchanged: [] };
  }
  const existing = input.existingJobs.filter(
    (job) => job.organizationId === input.organizationId,
  );
  const desired = new Map(
    input.plan.proposed
      .filter((job) => job.organizationId === input.organizationId)
      .map((job) => [job.fingerprint, job]),
  );
  const blocked = new Set(
    existing
      .filter(
        (job) =>
          isNeverResendAutomationJobStatus(job.status) || isInFlightAutomationJobStatus(job.status),
      )
      .map((job) => job.fingerprint),
  );
  // An existing legacy birthday job and a new annual fingerprint represent
  // the same customer/timing occurrence. Never silently cancel + reinsert
  // during cutover: the SQL cancel guard deliberately rejects cancellation
  // while that birthday remains eligible. Require an explicit migration.
  const birthdayOccurrenceYear = (scheduledFor: string, timingId: string): number | null => {
    const timestamp = Date.parse(scheduledFor);
    if (!Number.isFinite(timestamp)) return null;
    const advanceDays = timingId === "days_before_3" ? 3 : 0;
    // Taiwan is UTC+8 without DST. Use the birthday date, not the send date.
    return new Date(timestamp + (8 * 60 * 60 * 1000) + advanceDays * 86_400_000).getUTCFullYear();
  };
  const isAnnualBirthdayCollision = (job: LineAutomationProposedJob): boolean => {
    if (job.automationType !== "birthday_greeting") return false;
    const legacyPrefix = [job.organizationId, "birthday_greeting", job.eventId, job.timingId].join("|");
    const annualYear = job.fingerprint.startsWith(legacyPrefix + "|")
      ? Number(job.fingerprint.slice(legacyPrefix.length + 1))
      : NaN;
    if (!Number.isInteger(annualYear) || annualYear < 1) return false;
    return existing.some((row) =>
      row.automationType === "birthday_greeting" &&
      row.fingerprint === legacyPrefix &&
      row.eventId === job.eventId &&
      row.customerId === job.customerId &&
      row.timingId === job.timingId &&
      // Unknown dates must fail closed, not silently permit a duplicate.
      (birthdayOccurrenceYear(row.scheduledFor, row.timingId) ?? annualYear) === annualYear
    );
  };
  const insert: LineAutomationProposedJob[] = [];
  const update: Array<LineAutomationProposedJob & { id: string }> = [];
  const cancel: LineAutomationExistingJob[] = [];
  const unchanged: LineAutomationExistingJob[] = [];

  for (const job of existing) {
    if (!canMutateAutomationJob(job.status)) {
      unchanged.push(job);
      desired.delete(job.fingerprint);
      continue;
    }
    const next = desired.get(job.fingerprint);
    if (!next) {
      if (job.automationType === "birthday_greeting" &&
          [...desired.values()].some((candidate) =>
            candidate.automationType === "birthday_greeting" &&
            candidate.eventId === job.eventId &&
            candidate.customerId === job.customerId &&
            candidate.timingId === job.timingId &&
            isAnnualBirthdayCollision(candidate))) {
        unchanged.push(job);
        continue;
      }
      if (shouldCancelExistingJob({ job, desired, plan: input.plan })) {
        cancel.push(job);
      } else {
        unchanged.push(job);
      }
      continue;
    }
    desired.delete(job.fingerprint);
    const nextStatus = proposedJobStatus(next);
    const statusUnchanged =
      job.status === nextStatus ||
      (job.status === "scheduled" && nextStatus === "pending_recipient");
    if (
      job.scheduledFor === next.fireAt &&
      job.messageSnapshot === next.messageSnapshot &&
      statusUnchanged
    ) {
      unchanged.push(job);
      continue;
    }
    update.push({ ...next, id: job.id });
  }

  for (const job of desired.values()) {
    if (isAnnualBirthdayCollision(job)) continue;
    const existingStatus = existing.find((row) => row.fingerprint === job.fingerprint)?.status;
    if (blocked.has(job.fingerprint) || !canInsertAutomationJob(existingStatus)) continue;
    insert.push(job);
  }

  return { insert, update, cancel, unchanged };
}

export function simulateLineAutomationSchedule(snapshot: LineAutomationScheduleSnapshot): {
  plan: LineAutomationSchedulePlan;
  mutation: LineAutomationScheduleMutation;
  sentLine: false;
} {
  const plan = planLineAutomationSchedule(snapshot);
  return {
    plan,
    mutation: diffLineAutomationSchedule({
      organizationId: snapshot.organizationId,
      plan,
      existingJobs: snapshot.existingJobs ?? [],
    }),
    sentLine: false,
  };
}

export function mergeScheduleMutations(
  first: LineAutomationScheduleMutation,
  second: LineAutomationScheduleMutation,
): LineAutomationScheduleMutation {
  const seen = new Set(first.insert.map((job) => job.fingerprint));
  return {
    insert: [
      ...first.insert,
      ...second.insert.filter((job) => {
        if (seen.has(job.fingerprint)) return false;
        seen.add(job.fingerprint);
        return true;
      }),
    ],
    update: [...first.update, ...second.update],
    cancel: [...first.cancel, ...second.cancel],
    unchanged: [...first.unchanged, ...second.unchanged],
  };
}
