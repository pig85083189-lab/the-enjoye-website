import { evaluateAppointmentReminderAudience } from "@/lib/line/automations/appointment-reminder-bindings";
import { evaluateAppointmentReminderDispatch, interpretAppointmentReminderApiOutcome } from "@/lib/line/automations/appointment-reminder-command";
import { isAppointmentReminderSendOpen } from "@/lib/line/automations/appointment-reminder-flag";
import {
  applyAppointmentReminderClaimStep,
  completeAppointmentReminderJob,
  type AppointmentReminderJobStore,
} from "@/lib/line/automations/appointment-reminder-jobs";
import type {
  AppointmentReminderAppointment,
  AppointmentReminderJob,
  CustomerLineBinding,
  NotificationPreference,
} from "@/lib/line/automations/appointment-reminder-types";
import { executeCustomerLinePushHttp } from "@/lib/line/automations/customer-line-push-adapter";
import { lineBroadcastQuotaSnapshotAllowsClaim } from "@/lib/line/line-channel-lock";
import { runClaimedLineBroadcastSend } from "@/lib/line/line-send-pipeline";
import type { LineBroadcastHttpResult } from "@/lib/line/line-send-adapter";
import type { LineQuotaPublic } from "@/lib/line/line-types";

export type AppointmentReminderDispatchContext = {
  organizationId: string;
  appointment: AppointmentReminderAppointment;
  job: AppointmentReminderJob;
  textBody: string;
  binding?: CustomerLineBinding | null;
  preference?: NotificationPreference | null;
  crmLineUserId?: string | null;
  ownerRecipientLineUserId?: string | null;
  accessToken?: string;
  sendOpen?: boolean;
  lineQuota?: LineQuotaPublic | null;
  quotaCheckedAt?: string | null;
  channelInflight?: boolean;
  nowMs?: number;
  fetchImpl?: typeof fetch;
};

export function reminderChannelSnapshotAllowsSend(input: {
  quota?: LineQuotaPublic | null;
  quotaCheckedAt?: string | null;
  nowMs?: number;
  channelInflight?: boolean;
}): { ok: true } | { ok: false; reason: "quota_exceeded" | "inflight"; message: string } {
  if (input.channelInflight) {
    return {
      ok: false,
      reason: "inflight",
      message: "同一 LINE Channel 尚有發送進行中，已停止以免超額",
    };
  }
  const snapshot = lineBroadcastQuotaSnapshotAllowsClaim({
    quotaKnown: input.quota?.known === true,
    quotaRemaining:
      input.quota?.known && input.quota.type === "limited" ? input.quota.remaining : null,
    quotaCheckedAt: input.quotaCheckedAt,
    nowMs: input.nowMs,
  });
  if (!snapshot.ok) return snapshot;
  return { ok: true };
}

export async function dispatchAppointmentReminderJob(input: {
  store: AppointmentReminderJobStore;
  context: AppointmentReminderDispatchContext;
}): Promise<{
  ok: boolean;
  status: AppointmentReminderJob["status"];
  message: string;
  skipped?: boolean;
}> {
  const { store, context } = input;
  const nowMs = context.nowMs ?? Date.now();
  const audience = evaluateAppointmentReminderAudience({
    organizationId: context.organizationId,
    customerId: context.appointment.customerId,
    binding: context.binding,
    preference: context.preference,
    crmLineUserId: context.crmLineUserId,
    ownerRecipientLineUserId: context.ownerRecipientLineUserId,
  });

  const gate = evaluateAppointmentReminderDispatch({
    ...context,
    sendOpen: isAppointmentReminderSendOpen(context.sendOpen),
  });
  if (!gate.ok) {
    if (context.job.status === "accepted" || context.job.status === "pending_confirmation") {
      return { ok: false, status: context.job.status, message: gate.message };
    }
    completeAppointmentReminderJob(store, {
      organizationId: context.organizationId,
      requestId: context.job.requestId,
      status: gate.skipReason === "expired_window" ? "expired" : "skipped",
      skipReason: gate.skipReason,
      nowMs,
      delivery: {
        organizationId: context.organizationId,
        jobId: context.job.id,
        requestId: context.job.requestId,
        status: "skipped",
        message: gate.message,
      },
    });
    return { ok: false, status: "skipped", message: gate.message, skipped: true };
  }

  const snapshot = reminderChannelSnapshotAllowsSend({
    quota: context.lineQuota,
    quotaCheckedAt: context.quotaCheckedAt,
    nowMs,
    channelInflight: context.channelInflight,
  });
  if (!snapshot.ok) {
    return { ok: false, status: context.job.status, message: snapshot.message };
  }
  if (!audience.ok) {
    completeAppointmentReminderJob(store, {
      organizationId: context.organizationId,
      requestId: context.job.requestId,
      status: "skipped",
      skipReason: audience.skipReason,
      nowMs,
      delivery: {
        organizationId: context.organizationId,
        jobId: context.job.id,
        requestId: context.job.requestId,
        status: "skipped",
        message: audience.message,
      },
    });
    return { ok: false, status: "skipped", message: audience.message, skipped: true };
  }

  const claimState = {
    jobs: { [context.job.requestId]: { ...context.job } },
  };
  const result = await runClaimedLineBroadcastSend({
    claim: async () => {
      const claimed = applyAppointmentReminderClaimStep(
        claimState,
        context.job.requestId,
        nowMs,
      );
      if (!claimed.claimed || !claimed.job) {
        return {
          ok: false,
          reason: claimed.reason === "inflight" ? "pending_confirmation" : "duplicate",
          message:
            claimed.reason === "inflight"
              ? "發送進行中，請勿重複送出"
              : "這則任務識別已使用過，不會重送",
        };
      }
      store.upsertJob(claimed.job);
      return {
        ok: true,
        broadcastId: claimed.job.id,
        requestId: claimed.job.requestId,
      };
    },
    send: async (): Promise<LineBroadcastHttpResult> =>
      executeCustomerLinePushHttp({
        accessToken: context.accessToken ?? "",
        lineUserId: audience.lineUserId,
        textBody: context.textBody,
        requestId: context.job.requestId,
        sendOpen: context.sendOpen,
        fetchImpl: context.fetchImpl,
      }),
    complete: async (outcome) => {
      const status =
        outcome.status === "accepted" ||
        outcome.status === "pending_confirmation" ||
        outcome.status === "failed"
          ? outcome.status
          : "failed";
      completeAppointmentReminderJob(store, {
        organizationId: context.organizationId,
        requestId: context.job.requestId,
        status,
        nowMs,
        delivery: {
          organizationId: context.organizationId,
          jobId: context.job.id,
          requestId: context.job.requestId,
          status,
          lineRequestId: outcome.lineRequestId,
          httpStatus: outcome.httpStatus,
          errorClass: outcome.errorClass ?? null,
          message: outcome.message,
        },
      });
    },
    interpret: interpretAppointmentReminderApiOutcome,
  });

  const job = store.getJobByRequestId(context.organizationId, context.job.requestId);
  return {
    ok: result.ok,
    status: job?.status ?? "failed",
    message: result.message,
  };
}
