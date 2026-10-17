import { LineAutomationIcon } from "@/features/line/automations/LineAutomationIcons";
import { LineAutomationSwitch } from "@/features/line/automations/LineAutomationSwitch";
import {
  LINE_AUTOMATION_LOCAL_ONLY_BADGE,
  LINE_AUTOMATION_SETTINGS_LABEL,
} from "@/lib/line/automations/copy";
import type { LineAutomationDefinition, LineAutomationDraft } from "@/lib/line/automations/types";

export function LineAutomationCard({
  definition,
  onOpenSettings,
}: {
  definition: LineAutomationDefinition;
  draft: LineAutomationDraft;
  selected?: boolean;
  onSelect?: () => void;
  onToggle?: (enabled: boolean) => void;
  onOpenSettings: () => void;
}) {
  return (
    <article
      data-line-automation-card={definition.id}
      className="rounded-[20px] border border-border bg-[#FFFCFB] px-4 py-4 shadow-[0_1px_2px_rgba(48,43,43,0.04)] sm:px-5"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary">
            <LineAutomationIcon icon={definition.icon} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[16px] font-semibold text-text">{definition.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-secondary-text">
              {definition.description}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-secondary-text">{LINE_AUTOMATION_LOCAL_ONLY_BADGE}</span>
            <LineAutomationSwitch
              checked={false}
              disabled
              label={`${definition.title}自動發送`}
              onChange={() => undefined}
            />
          </div>
          <button
            type="button"
            data-line-automation-settings
            onClick={onOpenSettings}
            className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-primary/35 px-4 text-[13px] font-medium text-primary hover:bg-primary-light/70"
          >
            {LINE_AUTOMATION_SETTINGS_LABEL}
          </button>
        </div>
      </div>
    </article>
  );
}
