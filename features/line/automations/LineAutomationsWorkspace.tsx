"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { LineAutomationCard } from "@/features/line/automations/LineAutomationCard";
import { LineAutomationRuleEditor } from "@/features/line/automations/LineAutomationRuleEditor";
import { canShowLineAutomations } from "@/lib/line/automations/access";
import {
  loadLineAutomationRules,
  setLineAutomationEnabled,
} from "@/lib/line/automations/actions";
import { LINE_AUTOMATION_CATALOG, lineAutomationById } from "@/lib/line/automations/catalog";
import {
  LINE_AUTOMATION_ENABLED_COUNT,
  LINE_AUTOMATION_HISTORY_ENTRY,
  LINE_AUTOMATION_LAB_ENTRY,
  LINE_AUTOMATION_NOT_LIVE_HINT,
  LINE_AUTOMATION_OWNER_ONLY,
  LINE_AUTOMATION_PAGE_SUBTITLE,
  LINE_AUTOMATION_PAGE_TITLE,
  LINE_AUTOMATION_SENT_THIS_MONTH,
} from "@/lib/line/automations/copy";
import {
  applyLineAutomationEditor,
  createDefaultLineAutomationDrafts,
  createEmptyLineAutomationStats,
  formatLineAutomationStat,
  resetLineAutomationDraftsOnOrganizationChange,
} from "@/lib/line/automations/draft";
import { countEnabledAutomationRules } from "@/lib/line/automations/rules";
import type { LineAutomationId } from "@/lib/line/automations/types";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

export function LineAutomationsWorkspace() {
  const { organization, membership } = useOrganization();
  const allowed = canShowLineAutomations(membership);
  const [drafts, setDrafts] = useState(createDefaultLineAutomationDrafts);
  const [editingId, setEditingId] = useState<LineAutomationId | null>(null);
  const previousOrganizationId = useRef<string | null>(null);
  const pendingToggle = useRef<LineAutomationId | null>(null);
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
    }
    if (!allowed) return;
    let cancelled = false;
    void loadLineAutomationRules(organization.id).then((result) => {
      if (cancelled) return;
      if (!result.ok || !result.data) return;
      setDrafts(result.data.drafts);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization.id, allowed]);

  if (!allowed) {
    return (
      <Card data-line-automations-denied padding="lg">
        <p className="text-[16px] font-semibold text-text">{LINE_AUTOMATION_OWNER_ONLY}</p>
      </Card>
    );
  }

  const officialName = organization.name.trim() || "THE ENJOYE";

  async function handleToggle(id: LineAutomationId, enabled: boolean) {
    if (pendingToggle.current) return;
    pendingToggle.current = id;
    const result = await setLineAutomationEnabled({
      organizationId: organization.id,
      automationType: id,
      enabled,
    });
    pendingToggle.current = null;
    if (!result.ok) return;
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        enabled: result.data?.enabled === true,
      },
    }));
  }

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
        <Link
          href="/staff/line/automations/history"
          data-line-automation-tab="history"
          className="inline-flex min-h-10 items-center self-start rounded-full border border-primary/35 px-4 text-[13px] font-medium text-primary hover:bg-primary-light/70"
        >
          {LINE_AUTOMATION_HISTORY_ENTRY}
        </Link>
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
            {formatLineAutomationStat(countEnabledAutomationRules(drafts))}
          </p>
        </Card>
      </section>

      <div className="space-y-3" data-line-automation-catalog>
        {LINE_AUTOMATION_CATALOG.map((definition) => (
          <LineAutomationCard
            key={definition.id}
            definition={definition}
            draft={drafts[definition.id]}
            onOpenSettings={() => setEditingId(definition.id)}
            onToggle={(enabled) => {
              void handleToggle(definition.id, enabled);
            }}
          />
        ))}
      </div>

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
          organizationId={organization.id}
          onClose={() => setEditingId(null)}
          onApply={(next) => setDrafts((current) => applyLineAutomationEditor(current, next))}
        />
      ) : null}
    </div>
  );
}
