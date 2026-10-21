"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { LineDeliveryRecordsCard } from "@/features/line/automations/LineDeliveryRecordsCard";
import { canShowLineAutomations } from "@/lib/line/automations/access";
import {
  LINE_AUTOMATION_BACK_TO_MANAGE,
  LINE_AUTOMATION_HISTORY_ENTRY,
  LINE_AUTOMATION_HISTORY_SUBTITLE,
  LINE_AUTOMATION_LAB_ENTRY,
  LINE_AUTOMATION_NOT_LIVE_HINT,
  LINE_AUTOMATION_OWNER_ONLY,
} from "@/lib/line/automations/copy";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

export function LineAutomationHistoryWorkspace() {
  const { organization, membership } = useOrganization();

  if (!canShowLineAutomations(membership)) {
    return (
      <Card data-line-automations-denied padding="lg">
        <p className="text-[16px] font-semibold text-text">{LINE_AUTOMATION_OWNER_ONLY}</p>
      </Card>
    );
  }

  return (
    <div data-line-automation-history-page className="space-y-5 overflow-x-hidden">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-text sm:text-[26px]">
            {LINE_AUTOMATION_HISTORY_ENTRY}
          </h1>
          <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-secondary-text">
            {LINE_AUTOMATION_HISTORY_SUBTITLE}
          </p>
        </div>
        <Link
          href="/staff/line/automations"
          data-line-automation-tab="overview"
          className="inline-flex min-h-10 items-center self-start rounded-full border border-primary/35 px-4 text-[13px] font-medium text-primary hover:bg-primary-light/70"
        >
          {LINE_AUTOMATION_BACK_TO_MANAGE}
        </Link>
      </header>

      <p className="text-[13px] leading-relaxed text-secondary-text">{LINE_AUTOMATION_NOT_LIVE_HINT}</p>

      <LineDeliveryRecordsCard organizationId={organization.id} />

      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-secondary-text">
        <Link href="/staff/line/automations" className="text-primary">
          {LINE_AUTOMATION_BACK_TO_MANAGE}
        </Link>
        <Link href="/staff/line/automations/lab" className="text-secondary-text underline-offset-2 hover:underline">
          {LINE_AUTOMATION_LAB_ENTRY}
        </Link>
      </div>
    </div>
  );
}
