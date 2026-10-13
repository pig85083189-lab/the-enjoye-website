"use server";

import { canShowLineAutomations } from "@/lib/line/automations/access";
import {
  createDefaultAppointmentReminderRule,
  evaluateAppointmentReminderOwnerAccess,
  evaluateAppointmentReminderRuleSave,
  ruleFromAppointmentReminderDraft,
} from "@/lib/line/automations/appointment-reminder-rules";
import { countPlannedAppointmentReminders, planAppointmentReminderJobs } from "@/lib/line/automations/appointment-reminder-scheduler";
import { previewAppointmentReminderTemplate } from "@/lib/line/automations/appointment-reminder-templates";
import type { AppointmentReminderAppointment, AppointmentReminderDelivery, AppointmentReminderRule } from "@/lib/line/automations/appointment-reminder-types";
import { LINE_AUTOMATION_PERSIST_CLOSED_MESSAGE } from "@/lib/line/automations/copy";
import type { LineAutomationDraft } from "@/lib/line/automations/types";
import type { LineActor } from "@/lib/line/line-command";
import type { LineDecisionReason } from "@/lib/line/line-types";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";

export type AppointmentReminderActionResult<T = undefined> =
  | { ok: true; message: string; persisted: false; data?: T }
  | { ok: false; reason: LineDecisionReason; message: string; persisted: false };

export type AppointmentReminderWorkspacePublic = {
  rule: AppointmentReminderRule;
  plannedCount: number | null;
  deliveries: AppointmentReminderDelivery[];
  persistOpen: false;
  sendOpen: false;
};

function actorFromMembership(
  organizationId: string,
  authUserId: string | null,
  membership: Awaited<ReturnType<typeof getAuthenticatedStaffMembership>>,
): LineActor {
  return {
    authUserId,
    role: membership.status === "ok" ? membership.membership.role : null,
    isActive: membership.status === "ok" ? membership.membership.isActive : false,
    organizationId: membership.status === "ok" ? membership.membership.organizationId : null,
    userId: membership.status === "ok" ? membership.membership.userId : null,
  };
}

async function loadReminderActor(organizationId: string): Promise<LineActor> {
  const user = await getServerStaffAuthUser();
  const membership = await getAuthenticatedStaffMembership({ organizationId });
  return actorFromMembership(organizationId, user?.id ?? null, membership);
}

export async function loadAppointmentReminderWorkspaceAction(
  organizationId: string,
): Promise<AppointmentReminderActionResult<AppointmentReminderWorkspacePublic>> {
  const actor = await loadReminderActor(organizationId);
  const access = evaluateAppointmentReminderOwnerAccess({ organizationId, actor });
  if (!access.ok) {
    return { ok: false, reason: access.reason, message: access.message, persisted: false };
  }
  if (!canShowLineAutomations(actor)) {
    return { ok: false, reason: "unauthorized", message: "只有店長可以管理 LINE 自動推播", persisted: false };
  }
  return {
    ok: true,
    message: "預約提醒後端可測試，正式寫入與正式發送仍關閉",
    persisted: false,
    data: {
      rule: createDefaultAppointmentReminderRule(organizationId),
      plannedCount: null,
      deliveries: [],
      persistOpen: false,
      sendOpen: false,
    },
  };
}

export async function saveAppointmentReminderRuleAction(input: {
  organizationId: string;
  draft: Pick<LineAutomationDraft, "enabled" | "selectedTimingIds" | "template">;
}): Promise<AppointmentReminderActionResult<AppointmentReminderRule>> {
  const actor = await loadReminderActor(input.organizationId);
  const rule = ruleFromAppointmentReminderDraft(input.organizationId, input.draft);
  const gate = evaluateAppointmentReminderRuleSave({
    organizationId: input.organizationId,
    actor,
    rule,
  });
  if (!gate.ok) {
    return { ok: false, reason: gate.reason, message: gate.message, persisted: false };
  }
  return {
    ok: false,
    reason: "send_closed",
    message: LINE_AUTOMATION_PERSIST_CLOSED_MESSAGE,
    persisted: false,
  };
}

export async function previewAppointmentReminderAction(input: {
  organizationId: string;
  template: string;
  appointment?: AppointmentReminderAppointment | null;
  organizationName?: string | null;
}): Promise<AppointmentReminderActionResult<{ textBody: string }>> {
  const actor = await loadReminderActor(input.organizationId);
  const access = evaluateAppointmentReminderOwnerAccess({
    organizationId: input.organizationId,
    actor,
  });
  if (!access.ok) {
    return { ok: false, reason: access.reason, message: access.message, persisted: false };
  }
  return {
    ok: true,
    message: "僅預覽，不會發送",
    persisted: false,
    data: {
      textBody: previewAppointmentReminderTemplate({
        template: input.template,
        appointment: input.appointment,
        organizationName: input.organizationName,
      }),
    },
  };
}

export async function estimateAppointmentReminderCountAction(input: {
  organizationId: string;
  draft: Pick<LineAutomationDraft, "enabled" | "selectedTimingIds" | "template">;
  appointments: AppointmentReminderAppointment[];
}): Promise<AppointmentReminderActionResult<{ plannedCount: number }>> {
  const actor = await loadReminderActor(input.organizationId);
  const access = evaluateAppointmentReminderOwnerAccess({
    organizationId: input.organizationId,
    actor,
  });
  if (!access.ok) {
    return { ok: false, reason: access.reason, message: access.message, persisted: false };
  }
  const rule = ruleFromAppointmentReminderDraft(input.organizationId, input.draft);
  const foreign = input.appointments.some((row) => row.organizationId !== input.organizationId);
  if (foreign) {
    return { ok: false, reason: "unauthorized", message: "不能讀取其他店家的預約", persisted: false };
  }
  const plans = input.appointments.map((appointment) =>
    planAppointmentReminderJobs({
      organizationId: input.organizationId,
      appointment,
      rule,
    }),
  );
  return {
    ok: true,
    message: "預計發送數量僅供預覽，不會建立任務",
    persisted: false,
    data: { plannedCount: countPlannedAppointmentReminders(plans) },
  };
}

export async function loadAppointmentReminderDeliveriesAction(
  organizationId: string,
): Promise<AppointmentReminderActionResult<AppointmentReminderDelivery[]>> {
  const actor = await loadReminderActor(organizationId);
  const access = evaluateAppointmentReminderOwnerAccess({ organizationId, actor });
  if (!access.ok) {
    return { ok: false, reason: access.reason, message: access.message, persisted: false };
  }
  return {
    ok: true,
    message: "尚無正式發送紀錄",
    persisted: false,
    data: [],
  };
}
