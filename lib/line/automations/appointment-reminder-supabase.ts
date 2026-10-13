import {
  INSERT_LINE_APPOINTMENT_REMINDER_JOBS_RPC,
  LIST_DUE_LINE_APPOINTMENT_REMINDER_JOBS_RPC,
  READ_LINE_APPOINTMENT_REMINDER_WORKSPACE_RPC,
  RECORD_LINE_APPOINTMENT_REMINDER_DRY_RUN_RPC,
  SYNC_LINE_APPOINTMENT_REMINDER_JOBS_RPC,
  UPSERT_LINE_APPOINTMENT_REMINDER_RULE_RPC,
} from "@/lib/line/automations/appointment-reminder-rpc";
import {
  createJobsFromPlan,
  plannedJobsToInsertPayload,
  type AppointmentReminderRepository,
  type AppointmentReminderWorkspaceSnapshot,
} from "@/lib/line/automations/appointment-reminder-repository";
import { createDefaultAppointmentReminderRule } from "@/lib/line/automations/appointment-reminder-rules";
import type {
  AppointmentReminderAppointment,
  AppointmentReminderDelivery,
  AppointmentReminderDryRunRecord,
  AppointmentReminderJob,
  AppointmentReminderRule,
} from "@/lib/line/automations/appointment-reminder-types";
import type { AppointmentReminderRpcClient } from "@/lib/line/automations/appointment-reminder-write-hook";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function createAppointmentReminderSupabaseRepository(
  client: AppointmentReminderRpcClient,
): AppointmentReminderRepository {
  return {
    listJobs() {
      return [];
    },
    upsertJob() {},
    getJobByRequestId() {
      return undefined;
    },
    listDeliveries() {
      return [];
    },
    addDelivery() {},
    async getRule(organizationId) {
      const workspace = await this.readWorkspace(organizationId);
      return workspace?.rule ?? null;
    },
    async saveRule(rule, staffUserId) {
      const result = await client.rpc(UPSERT_LINE_APPOINTMENT_REMINDER_RULE_RPC, {
        p_organization_id: rule.organizationId,
        p_enabled: rule.enabled,
        p_timing_ids: rule.selectedTimingIds,
        p_template: rule.template,
        p_updated_by_staff_id: staffUserId,
      });
      if (result.error) return { persisted: false };
      return { persisted: asRecord(result.data).ok === true };
    },
    async getAppointment() {
      return null;
    },
    async getBinding() {
      return null;
    },
    async getPreference() {
      return null;
    },
    async readWorkspace(organizationId): Promise<AppointmentReminderWorkspaceSnapshot | null> {
      const result = await client.rpc(READ_LINE_APPOINTMENT_REMINDER_WORKSPACE_RPC, {
        p_organization_id: organizationId,
      });
      if (result.error) return null;
      const row = asRecord(result.data);
      if (row.ok !== true) return null;
      const timingIds = Array.isArray(row.timing_ids)
        ? row.timing_ids.filter((id): id is "day_before_morning" | "hours_before_3" =>
            id === "day_before_morning" || id === "hours_before_3",
          )
        : [];
      const rule: AppointmentReminderRule = {
        organizationId,
        automationId: "appointment_reminder",
        enabled: row.enabled === true,
        selectedTimingIds: timingIds,
        template: typeof row.template === "string" ? row.template : "",
      };
      return {
        rule: rule.template ? rule : { ...createDefaultAppointmentReminderRule(organizationId), ...rule },
        saved: row.saved === true,
        bindCount: Number(row.bind_count ?? 0),
        consentCount: Number(row.consent_count ?? 0),
        plannedCount: Number(row.planned_count ?? 0),
        deliveries: [],
        dryRuns: [],
      };
    },
    async syncAppointment(organizationId, appointment, rule, nowMs) {
      if (appointment.organizationId !== organizationId) return [];
      await client.rpc(SYNC_LINE_APPOINTMENT_REMINDER_JOBS_RPC, {
        p_organization_id: organizationId,
        p_appointment_app_id: appointment.id,
      });
      const memory = {
        jobs: [] as AppointmentReminderJob[],
        listJobs: (org: string) => memory.jobs.filter((job) => job.organizationId === org),
        upsertJob(job: AppointmentReminderJob) {
          memory.jobs.push(job);
        },
        getJobByRequestId() {
          return undefined;
        },
        listDeliveries() {
          return [] as AppointmentReminderDelivery[];
        },
        addDelivery() {},
      };
      const created = createJobsFromPlan(memory, organizationId, appointment, rule, nowMs);
      if (created.length > 0) {
        await client.rpc(INSERT_LINE_APPOINTMENT_REMINDER_JOBS_RPC, {
          p_organization_id: organizationId,
          p_jobs: plannedJobsToInsertPayload(created),
        });
      }
      return created;
    },
    async recordDryRun(row) {
      await client.rpc(RECORD_LINE_APPOINTMENT_REMINDER_DRY_RUN_RPC, {
        p_organization_id: row.organizationId,
        p_job_id: row.jobId,
        p_request_id: row.requestId,
        p_eligible: row.eligible,
        p_skip_reason: row.skipReason,
        p_message: row.message,
      });
    },
    async listDueJobs(organizationId) {
      const result = await client.rpc(LIST_DUE_LINE_APPOINTMENT_REMINDER_JOBS_RPC, {
        p_organization_id: organizationId,
      });
      if (result.error || !Array.isArray(result.data)) return [];
      return result.data.flatMap((row: unknown) => {
        const item = asRecord(row);
        if (item.organizationId !== organizationId) return [];
        if (typeof item.requestId !== "string" || !item.requestId.startsWith("larq-")) return [];
        return [
          {
            id: String(item.id ?? ""),
            organizationId,
            appointmentId: String(item.appointmentId ?? ""),
            customerId: String(item.customerId ?? ""),
            serviceId: String(item.serviceId ?? ""),
            timingId: item.timingId as AppointmentReminderJob["timingId"],
            fingerprint: String(item.fingerprint ?? ""),
            scheduledFor: String(item.scheduledFor ?? ""),
            status: item.status as AppointmentReminderJob["status"],
            requestId: item.requestId,
            claimedAt: typeof item.claimedAt === "string" ? item.claimedAt : null,
            sendClaimedAt: typeof item.sendClaimedAt === "string" ? item.sendClaimedAt : null,
            createdAt: "",
            updatedAt: "",
          } satisfies AppointmentReminderJob,
        ];
      });
    },
  };
}

export function parseAppointmentReminderDeliveries(
  rows: unknown,
  organizationId: string,
): AppointmentReminderDelivery[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const item = asRecord(row);
    if (item.organization_id !== organizationId) return [];
    if (typeof item.request_id !== "string" || !item.request_id.startsWith("larq-")) return [];
    return [
      {
        id: String(item.id ?? ""),
        organizationId,
        jobId: String(item.job_id ?? ""),
        requestId: item.request_id,
        status: item.status as AppointmentReminderDelivery["status"],
        lineRequestId: typeof item.line_request_id === "string" ? item.line_request_id : null,
        httpStatus: typeof item.http_status === "number" ? item.http_status : null,
        message: typeof item.message === "string" ? item.message : null,
        createdAt: String(item.created_at ?? ""),
      },
    ];
  });
}

export function parseAppointmentReminderDryRuns(
  rows: unknown,
  organizationId: string,
): AppointmentReminderDryRunRecord[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const item = asRecord(row);
    if (item.organization_id !== organizationId) return [];
    return [
      {
        id: String(item.id ?? ""),
        organizationId,
        jobId: typeof item.job_id === "string" ? item.job_id : null,
        requestId: typeof item.request_id === "string" ? item.request_id : null,
        eligible: item.eligible === true,
        skipReason: typeof item.skip_reason === "string" ? (item.skip_reason as never) : null,
        message: String(item.message ?? ""),
        createdAt: String(item.created_at ?? ""),
      },
    ];
  });
}
