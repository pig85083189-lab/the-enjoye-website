"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { LineAutomationCard } from "@/features/line/automations/LineAutomationCard";
import { LineAutomationRuleEditor } from "@/features/line/automations/LineAutomationRuleEditor";
import { canShowLineAutomations } from "@/lib/line/automations/access";
import { LINE_AUTOMATION_CATALOG, lineAutomationById } from "@/lib/line/automations/catalog";
import {
  LINE_AUTOMATION_EMPTY_STAT,
  LINE_AUTOMATION_ENABLED_COUNT,
  LINE_AUTOMATION_HISTORY_EMPTY,
  LINE_AUTOMATION_HISTORY_ENTRY,
  LINE_AUTOMATION_LAB_ENTRY,
  LINE_AUTOMATION_NOT_LIVE_HINT,
  LINE_AUTOMATION_OWNER_ONLY,
  LINE_AUTOMATION_PAGE_SUBTITLE,
  LINE_AUTOMATION_PAGE_TITLE,
  LINE_AUTOMATION_SENT_THIS_MONTH,
} from "@/lib/line/automations/copy";
import {
  createDefaultLineAutomationDrafts,
  createEmptyLineAutomationStats,
  formatLineAutomationStat,
  resetLineAutomationDraftsOnOrganizationChange,
} from "@/lib/line/automations/draft";
import type { LineAutomationId } from "@/lib/line/automations/types";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

export function LineAutomationsWorkspace() {
  const { organization, membership } = useOrganization();
  const allowed = canShowLineAutomations(membership);
  const [view, setView] = useState<"overview" | "history">("overview");
  const [drafts, setDrafts] = useState(createDefaultLineAutomationDrafts);
  const [editingId, setEditingId] = useState<LineAutomationId | null>(null);
  const previousOrganizationId = useRef<string | null>(null);
  const stats = createEmptyLineAutomationStats();

  useEffect(() => {
    const reset = resetLineAutomationDraftsOnOrganizationChange({
      previousOrganizationId: previousOrganizationId.current,
      nextOrganizationId: organization.id,
      drafts,
    });
    previousOrganizationId.current = organization.id;
    if (reset.reset) {
      setDrafts(reset.drafts);
      setEditingId(null);
      setView("overview");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization.id]);

  if (!allowed) {
    return (
      <Card data-line-automations-denied padding="lg">
        <p className="text-[16px] font-semibold text-text">{LINE_AUTOMATION_OWNER_ONLY}</p>
      </Card>
    );
  }

  const officialName = organization.name.trim() || "THE ENJOYE";

  return (
    <div data-line-automations-page className="space-y-5 overflow-x-hidden">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-text sm:text-[26px]">
            {LINE_AUTOMATION_PAGE_TITLE}
          </h1>
          <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-secondary-text">
            {LINE_AUTOMATION_PAGE_SUBTITLE}
          </p>
        </div>
        <button
          type="button"
          data-line-automation-tab="history"
          onClick={() => setView(view === "history" ? "overview" : "history")}
          className="inline-flex min-h-10 items-center self-start rounded-full border border-primary/35 px-4 text-[13px] font-medium text-primary hover:bg-primary-light/70"
        >
          {view === "history" ? "返回通知管理" : LINE_AUTOMATION_HISTORY_ENTRY}
        </button>
      </header>

      <p className="text-[13px] leading-relaxed text-secondary-text">{LINE_AUTOMATION_NOT_LIVE_HINT}</p>

      <section className="grid grid-cols-2 gap-3" data-line-automation-hero-stats>
        <Card padding="md">
          <p className="text-[12px] text-secondary-text">{LINE_AUTOMATION_SENT_THIS_MONTH}</p>
          <p className="mt-2 text-[28px] font-semibold leading-none text-text">
            {formatLineAutomationStat(stats.sentThisMonth)}
          </p>
        </Card>
        <Card padding="md">
          <p className="text-[12px] text-secondary-text">{LINE_AUTOMATION_ENABLED_COUNT}</p>
          <p className="mt-2 text-[28px] font-semibold leading-none text-text">
            {LINE_AUTOMATION_EMPTY_STAT}
          </p>
        </Card>
      </section>

      {view === "history" ? (
        <Card padding="lg" data-line-automation-history>
          <h2 className="text-[16px] font-semibold text-text">{LINE_AUTOMATION_HISTORY_ENTRY}</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-secondary-text">
            {LINE_AUTOMATION_HISTORY_EMPTY}
          </p>
        </Card>
      ) : (
        <div className="space-y-3" data-line-automation-catalog>
          {LINE_AUTOMATION_CATALOG.map((definition) => (
            <LineAutomationCard
              key={definition.id}
              definition={definition}
              draft={drafts[definition.id]}
              onOpenSettings={() => setEditingId(definition.id)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-secondary-text">
        <Link href="/staff/line" className="text-primary">
          返回 LINE 群發
        </Link>
        <Link href="/staff/line/automations/lab" className="text-secondary-text underline-offset-2 hover:underline">
          {LINE_AUTOMATION_LAB_ENTRY}
        </Link>
      </div>

      {editingId ? (
        <LineAutomationRuleEditor
          definition={lineAutomationById(editingId)}
          draft={drafts[editingId]}
          officialName={officialName}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </div>
  );
}
