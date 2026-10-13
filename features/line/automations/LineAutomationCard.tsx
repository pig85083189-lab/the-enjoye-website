import { Badge } from "@/components/ui/Badge";
import { LineAutomationCardMetrics } from "@/features/line/automations/LineAutomationStats";
import { LineAutomationIcon } from "@/features/line/automations/LineAutomationIcons";
import { LineAutomationSwitch } from "@/features/line/automations/LineAutomationSwitch";
import {
  LINE_AUTOMATION_LOCAL_ONLY_BADGE,
  LINE_AUTOMATION_LOCAL_PREVIEW_BADGE,
  LINE_AUTOMATION_SAVED_BADGE,
  LINE_AUTOMATION_SETTINGS_LABEL,
} from "@/lib/line/automations/copy";
import { lineAutomationTimingsForDraft } from "@/lib/line/automations/draft";
import type { LineAutomationDefinition, LineAutomationDraft } from "@/lib/line/automations/types";
import { cn } from "@/lib/utils";

export function LineAutomationCard({
  definition,
  draft,
  selected,
  saved,
  plannedCount,
  bindCount,
  onSelect,
  onToggle,
  onOpenSettings,
}: {
  definition: LineAutomationDefinition;
  draft: LineAutomationDraft;
  selected?: boolean;
  saved?: boolean;
  plannedCount?: number | null;
  bindCount?: number | null;
  onSelect?: () => void;
  onToggle: (enabled: boolean) => void;
  onOpenSettings: () => void;
}) {
  const timings = lineAutomationTimingsForDraft(definition.timings, draft);

  return (
    <article
      data-line-automation-card={definition.id}
      className={cn(
        "rounded-[20px] border bg-[#FFFCFB] px-4 py-4 shadow-[0_1px_2px_rgba(48,43,43,0.04)] sm:px-5",
        selected ? "border-primary/50" : "border-border",
      )}
    >
      <div className="flex flex-col gap-4 min-[900px]:flex-row min-[900px]:items-start">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onSelect}
        >
          <div className="flex gap-3">
            <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary">
              <LineAutomationIcon icon={definition.icon} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[16px] font-semibold text-text">{definition.title}</h3>
                {definition.badge ? <Badge tone="primary">{definition.badge}</Badge> : null}
                <Badge tone={saved ? "primary" : draft.enabled ? "warning" : "neutral"}>
                  {saved
                    ? LINE_AUTOMATION_SAVED_BADGE
                    : draft.enabled
                      ? LINE_AUTOMATION_LOCAL_PREVIEW_BADGE
                      : LINE_AUTOMATION_LOCAL_ONLY_BADGE}
                </Badge>
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-secondary-text">
                {definition.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {timings.map((timing) => {
                  const selectedTiming = draft.selectedTimingIds.includes(timing.id);
                  return (
                    <span
                      key={timing.id}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[12px]",
                        selectedTiming
                          ? "border-[#E8D0CE] bg-white text-primary"
                          : "border-dashed border-[#E8D0CE] bg-transparent text-secondary-text",
                      )}
                    >
                      {timing.label}
                    </span>
                  );
                })}
                <span className="rounded-full border border-dashed border-[#E8D0CE] px-3 py-1 text-[12px] text-secondary-text">
                  {definition.addTimingLabel}
                </span>
              </div>
            </div>
          </div>
        </button>

        <div className="flex flex-wrap items-center justify-between gap-4 min-[900px]:flex-col min-[900px]:items-end">
          <div className="flex items-center gap-3">
            <LineAutomationSwitch
              checked={draft.enabled}
              label={`${definition.title}自動發送`}
              onChange={onToggle}
            />
            <button
              type="button"
              data-line-automation-settings
              onClick={onOpenSettings}
              className="inline-flex min-h-9 items-center rounded-full border border-primary/35 px-4 text-[13px] font-medium text-primary hover:bg-primary-light/70"
            >
              {LINE_AUTOMATION_SETTINGS_LABEL}
            </button>
          </div>
          <LineAutomationCardMetrics
            plannedCount={definition.id === "appointment_reminder" ? plannedCount : null}
            bindCount={definition.id === "appointment_reminder" ? bindCount : null}
          />
        </div>
      </div>
    </article>
  );
}
