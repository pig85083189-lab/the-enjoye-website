"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { LineAppointmentReminderDryRunCard } from "@/features/line/automations/LineAppointmentReminderDryRunCard";
import { LineAppointmentReminderPlanCard } from "@/features/line/automations/LineAppointmentReminderPlanCard";
import { LineDeliveryMockWorkerCard } from "@/features/line/automations/LineDeliveryMockWorkerCard";
import { LineOwnerSelfReminderCard } from "@/features/line/automations/LineOwnerSelfReminderCard";
import { LineTestPushAcceptanceCard } from "@/features/line/automations/LineTestPushAcceptanceCard";
import { LineTestPushPrepCard } from "@/features/line/automations/LineTestPushPrepCard";
import { LineAutomationMonthlyStats } from "@/features/line/automations/LineAutomationStats";
import { canShowLineAutomations } from "@/lib/line/automations/access";
import {
  LINE_AUTOMATION_FLAG_CLOSED,
  LINE_AUTOMATION_FLAG_KILL_LABEL,
  LINE_AUTOMATION_FLAG_OWNER_SELF_LABEL,
  LINE_AUTOMATION_FLAG_SEND_LABEL,
  LINE_AUTOMATION_LAB_HINT,
  LINE_AUTOMATION_LAB_TITLE,
  LINE_AUTOMATION_OWNER_ONLY,
  LINE_AUTOMATION_REMINDER_DEV_HINT,
  LINE_AUTOMATION_REMINDER_DEV_TITLE,
  LINE_AUTOMATION_WRITE_CLOSED_LABEL,
} from "@/lib/line/automations/copy";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import { createDefaultLineAutomationDrafts, createEmptyLineAutomationStats } from "@/lib/line/automations/draft";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

export function LineAutomationLabWorkspace() {
  const { organization, membership } = useOrganization();
  const drafts = createDefaultLineAutomationDrafts();
  const stats = createEmptyLineAutomationStats();

  if (!canShowLineAutomations(membership)) {
    return (
      <Card data-line-automations-denied padding="lg">
        <p className="text-[16px] font-semibold text-text">{LINE_AUTOMATION_OWNER_ONLY}</p>
      </Card>
    );
  }

  return (
    <div data-line-automation-lab className="space-y-5 overflow-x-hidden">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-text sm:text-[26px]">
          {LINE_AUTOMATION_LAB_TITLE}
        </h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-secondary-text">
          {LINE_AUTOMATION_LAB_HINT}
        </p>
      </header>

      <Card padding="lg" data-line-automation-reminder-status>
        <h2 className="text-[16px] font-semibold text-text">{LINE_AUTOMATION_REMINDER_DEV_TITLE}</h2>
        <p className="mt-2 text-[13px] text-secondary-text">{LINE_AUTOMATION_REMINDER_DEV_HINT}</p>
        <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-secondary-text">{LINE_AUTOMATION_WRITE_CLOSED_LABEL}</dt>
            <dd className="font-medium text-text">{LINE_AUTOMATION_FLAG_CLOSED}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">{LINE_AUTOMATION_FLAG_SEND_LABEL}</dt>
            <dd className="font-medium text-text" data-line-automation-flag-send>
              {LINE_AUTOMATION_SEND_OPEN ? "開啟" : LINE_AUTOMATION_FLAG_CLOSED}
            </dd>
          </div>
          <div>
            <dt className="text-secondary-text">{LINE_AUTOMATION_FLAG_OWNER_SELF_LABEL}</dt>
            <dd className="font-medium text-text" data-line-automation-flag-owner-self>
              {LINE_OWNER_SELF_PUSH_OPEN ? "開啟" : LINE_AUTOMATION_FLAG_CLOSED}
            </dd>
          </div>
          <div>
            <dt className="text-secondary-text">{LINE_AUTOMATION_FLAG_KILL_LABEL}</dt>
            <dd className="font-medium text-text" data-line-automation-flag-kill>
              {LINE_AUTOMATION_KILL_SWITCH ? "開啟" : LINE_AUTOMATION_FLAG_CLOSED}
            </dd>
          </div>
        </dl>
      </Card>

      <LineAppointmentReminderPlanCard enabled={drafts.appointment_reminder.enabled} />
      <LineDeliveryMockWorkerCard organizationId={organization.id} />
      <LineAppointmentReminderDryRunCard />
      <LineTestPushPrepCard />
      <LineTestPushAcceptanceCard />
      <LineOwnerSelfReminderCard />
      <LineAutomationMonthlyStats stats={stats} />

      <p className="text-[12px] text-secondary-text">
        <Link href="/staff/line/automations" className="text-primary">
          返回通知管理
        </Link>
      </p>
    </div>
  );
}
