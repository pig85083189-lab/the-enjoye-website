import {
  APPOINTMENT_REMINDER_CLAIM_GRACE_MS,
} from "@/lib/line/automations/appointment-reminder-flag";
import {
  jobMatchesPlan,
  type AppointmentReminderPlan,
} from "@/lib/line/automations/appointment-reminder-scheduler";
import type {
  AppointmentReminderDelivery,
  AppointmentReminderJob,
  AppointmentReminderJobStatus,
  AppointmentReminderSkipReason,
  PlannedAppointmentReminderJob,
} from "@/lib/line/automations/appointment-reminder-types";

export const APPOINTMENT_REMINDER_ACTIVE_JOB_STATUSES = [
  "scheduled",
  "claimed",
] as const satisfies readonly AppointmentReminderJobStatus[];

export function newAppointmentReminderJobId(
  random: () => string = () => crypto.randomUUID(),
): string {
  return `laj-${random().replace(/-/g, "").slice(0, 16)}`;
}

export function newAppointmentReminderRequestId(
  random: () => string = () => crypto.randomUUID(),
): string {
  return `larq-${random().replace(/-/g, "").slice(0, 16)}`;
}

export function newAppointmentReminderDeliveryId(
  random: () => string = () => crypto.randomUUID(),
): string {
  return `lad-${random().replace(/-/g, "").slice(0, 16)}`;
}

export function isActiveAppointmentReminderJob(job: AppointmentReminderJob): boolean {
  return (APPOINTMENT_REMINDER_ACTIVE_JOB_STATUSES as readonly string[]).includes(job.status);
}

export function appointmentReminderJobIsDue(input: {
  job: AppointmentReminderJob;
  nowMs?: number;
  graceMs?: number;
}): { due: boolean; expired: boolean } {
  const now = input.nowMs ?? Date.now();
  const grace = input.graceMs ?? APPOINTMENT_REMINDER_CLAIM_GRACE_MS;
  const scheduled = Date.parse(input.job.scheduledFor);
  if (!Number.isFinite(scheduled)) return { due: false, expired: true };
  if (scheduled > now) return { due: false, expired: false };
  if (now - scheduled > grace) return { due: false, expired: true };
  return { due: true, expired: false };
}

export type AppointmentReminderJobStore = {
  listJobs(organizationId: string): AppointmentReminderJob[];
  upsertJob(job: AppointmentReminderJob): void;
  getJobByRequestId(organizationId: string, requestId: string): AppointmentReminderJob | undefined;
  listDeliveries(organizationId: string): AppointmentReminderDelivery[];
  addDelivery(row: AppointmentReminderDelivery): void;
};

function cancelJob(
  job: AppointmentReminderJob,
  reason: AppointmentReminderSkipReason,
  nowIso: string,
): AppointmentReminderJob {
  return {
    ...job,
    status: reason === "expired_window" ? "expired" : "canceled",
    skipReason: reason,
    updatedAt: nowIso,
  };
}

export function syncAppointmentReminderJobs(input: {
  store: AppointmentReminderJobStore;
  plan: AppointmentReminderPlan;
  nowMs?: number;
  random?: () => string;
}): AppointmentReminderJob[] {
  return applyAppointmentReminderPlan(input.store, input.plan, input.nowMs, input.random);
}

export function applyAppointmentReminderPlan(
  store: AppointmentReminderJobStore,
  plan: AppointmentReminderPlan,
  nowMs = Date.now(),
  random?: () => string,
): AppointmentReminderJob[] {
  const nowIso = new Date(nowMs).toISOString();
  const existing = store
    .listJobs(plan.organizationId)
    .filter((job) => job.appointmentId === plan.appointmentId);

  const created: AppointmentReminderJob[] = [];
  const keepFingerprints = new Set(plan.toCreate.map((row) => row.fingerprint));

  for (const job of existing) {
    if (!isActiveAppointmentReminderJob(job)) continue;
    const stillValid = plan.toCreate.some((planned) => jobMatchesPlan(job, planned));
    if (!stillValid || !keepFingerprints.has(job.fingerprint)) {
      const reason = plan.toCancel[0]?.reason ?? "fingerprint_changed";
      store.upsertJob(cancelJob(job, reason, nowIso));
    }
  }

  for (const planned of plan.toCreate) {
    const match = existing.find(
      (job) => isActiveAppointmentReminderJob(job) && jobMatchesPlan(job, planned),
    );
    if (match) continue;
    const job = createScheduledJob(planned, nowIso, random);
    store.upsertJob(job);
    created.push(job);
  }

  return created;
}

function createScheduledJob(
  planned: PlannedAppointmentReminderJob,
  nowIso: string,
  random?: () => string,
): AppointmentReminderJob {
  return {
    id: newAppointmentReminderJobId(random),
    organizationId: planned.organizationId,
    appointmentId: planned.appointmentId,
    customerId: planned.customerId,
    serviceId: planned.serviceId,
    timingId: planned.timingId,
    fingerprint: planned.fingerprint,
    scheduledFor: planned.scheduledFor,
    status: "scheduled",
    requestId: newAppointmentReminderRequestId(random),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function expireOverdueAppointmentReminderJobs(
  store: AppointmentReminderJobStore,
  organizationId: string,
  nowMs = Date.now(),
): AppointmentReminderJob[] {
  const nowIso = new Date(nowMs).toISOString();
  const expired: AppointmentReminderJob[] = [];
  for (const job of store.listJobs(organizationId)) {
    if (job.status !== "scheduled") continue;
    const window = appointmentReminderJobIsDue({ job, nowMs });
    if (window.expired) {
      const next = cancelJob(job, "expired_window", nowIso);
      store.upsertJob(next);
      expired.push(next);
    }
  }
  return expired;
}

export type AppointmentReminderClaimState = {
  jobs: Record<string, AppointmentReminderJob>;
};

export function applyAppointmentReminderClaimStep(
  state: AppointmentReminderClaimState,
  requestId: string,
  nowMs = Date.now(),
): {
  claimed: boolean;
  reason?: AppointmentReminderSkipReason;
  status: AppointmentReminderJobStatus;
  job?: AppointmentReminderJob;
} {
  const job = state.jobs[requestId];
  if (!job) {
    return { claimed: false, reason: "duplicate", status: "failed" };
  }
  if (job.status === "accepted" || job.sendClaimedAt) {
    return { claimed: false, reason: "duplicate", status: job.status, job };
  }
  if (job.status === "pending_confirmation" || job.status === "claimed") {
    return { claimed: false, reason: "inflight", status: job.status, job };
  }
  if (job.status === "failed" || job.status === "canceled" || job.status === "expired" || job.status === "skipped") {
    return { claimed: false, reason: "duplicate", status: job.status, job };
  }
  const window = appointmentReminderJobIsDue({ job, nowMs });
  if (window.expired) {
    job.status = "expired";
    job.skipReason = "expired_window";
    job.updatedAt = new Date(nowMs).toISOString();
    return { claimed: false, reason: "expired_window", status: "expired", job };
  }
  if (!window.due) {
    return { claimed: false, reason: "past_due", status: job.status, job };
  }
  job.status = "claimed";
  job.claimedAt = new Date(nowMs).toISOString();
  job.sendClaimedAt = job.claimedAt;
  job.updatedAt = job.claimedAt;
  return { claimed: true, status: "claimed", job };
}

export function completeAppointmentReminderJob(
  store: AppointmentReminderJobStore,
  input: {
    organizationId: string;
    requestId: string;
    status: AppointmentReminderJob["status"];
    skipReason?: AppointmentReminderSkipReason | null;
    delivery: Omit<AppointmentReminderDelivery, "id" | "createdAt">;
    nowMs?: number;
  },
): AppointmentReminderJob | undefined {
  const job = store.getJobByRequestId(input.organizationId, input.requestId);
  if (!job) return undefined;
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();
  const next: AppointmentReminderJob = {
    ...job,
    status: input.status,
    skipReason: input.skipReason ?? job.skipReason ?? null,
    updatedAt: nowIso,
  };
  store.upsertJob(next);
  store.addDelivery({
    id: newAppointmentReminderDeliveryId(),
    createdAt: nowIso,
    ...input.delivery,
  });
  return next;
}
