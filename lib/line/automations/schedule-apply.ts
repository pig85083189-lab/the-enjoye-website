import { LINE_AUTOMATION_SEND_OPEN } from "@/lib/line/automations/production-safe-flags";
import { planLineAutomationSchedule } from "@/lib/line/automations/schedule-engine";
import {
  LINE_AUTOMATION_JOB_MUTABLE_STATUSES,
  LINE_AUTOMATION_JOB_NEVER_RESEND_STATUSES,
  type LineAutomationExistingJob,
  type LineAutomationProposedJob,
  type LineAutomationScheduleMutation,
  type LineAutomationSchedulePlan,
  type LineAutomationScheduleSnapshot,
} from "@/lib/line/automations/schedule-types";

const MUTABLE = new Set<string>(LINE_AUTOMATION_JOB_MUTABLE_STATUSES);
const NEVER_RESEND = new Set<string>(LINE_AUTOMATION_JOB_NEVER_RESEND_STATUSES);

export function proposedJobStatus(job: Pick<LineAutomationProposedJob, "recipientReady">) {
  return job.recipientReady ? "scheduled" : "pending_recipient";
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
    existing.filter((job) => NEVER_RESEND.has(job.status)).map((job) => job.fingerprint),
  );
  const insert: LineAutomationProposedJob[] = [];
  const update: Array<LineAutomationProposedJob & { id: string }> = [];
  const cancel: LineAutomationExistingJob[] = [];
  const unchanged: LineAutomationExistingJob[] = [];

  for (const job of existing) {
    if (!MUTABLE.has(job.status)) {
      unchanged.push(job);
      desired.delete(job.fingerprint);
      continue;
    }
    const next = desired.get(job.fingerprint);
    if (!next) {
      cancel.push(job);
      continue;
    }
    desired.delete(job.fingerprint);
    if (
      job.scheduledFor === next.fireAt &&
      job.messageSnapshot === next.messageSnapshot &&
      job.status === proposedJobStatus(next)
    ) {
      unchanged.push(job);
      continue;
    }
    update.push({ ...next, id: job.id });
  }

  for (const job of desired.values()) {
    if (blocked.has(job.fingerprint)) continue;
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
