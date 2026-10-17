"use client";

import { Button } from "@/components/ui/Button";
import { LineAutomationPhonePreview } from "@/features/line/automations/LineAutomationPhonePreview";
import { LineAutomationSwitch } from "@/features/line/automations/LineAutomationSwitch";
import {
  LINE_AUTOMATION_EDITOR_WARNING,
  LINE_AUTOMATION_SAVE_CLOSED_LABEL,
  LINE_AUTOMATION_TEMPLATE_LABEL,
  LINE_AUTOMATION_TIMING_LABEL,
} from "@/lib/line/automations/copy";
import { lineAutomationTimingsForDraft } from "@/lib/line/automations/draft";
import type { LineAutomationDefinition, LineAutomationDraft } from "@/lib/line/automations/types";

export function LineAutomationRuleEditor({
  definition,
  draft,
  officialName = "THE ENJOYE",
  onClose,
}: {
  definition: LineAutomationDefinition;
  draft: LineAutomationDraft;
  officialName?: string;
  onClose: () => void;
  onApply?: (next: LineAutomationDraft) => void;
}) {
  const timings = lineAutomationTimingsForDraft(definition.timings, draft);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(48,43,43,0.35)] px-4 py-4 sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <div
        data-line-automation-editor
        role="dialog"
        aria-modal="true"
        aria-labelledby="line-automation-editor-title"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[20px] border border-border bg-[#FFFCFB] p-5 shadow-[0_16px_40px_rgba(48,43,43,0.12)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="line-automation-editor-title" className="text-[18px] font-semibold text-text">
              設定{definition.title}
            </h2>
            <p className="mt-1 text-[13px] text-secondary-text">{LINE_AUTOMATION_EDITOR_WARNING}</p>
          </div>
          <LineAutomationSwitch
            checked={false}
            disabled
            label={`${definition.title}自動發送`}
            onChange={() => undefined}
          />
        </div>

        <div className="mt-5 space-y-2">
          <p className="text-[13px] font-medium text-text">{LINE_AUTOMATION_TIMING_LABEL}</p>
          <div className="flex flex-wrap gap-2">
            {timings.map((timing) => (
              <span
                key={timing.id}
                className="rounded-full border border-[#E8D0CE] bg-white px-3 py-1.5 text-[13px] text-secondary-text"
              >
                {timing.label}
              </span>
            ))}
          </div>
        </div>

        <label className="mt-5 block space-y-2">
          <span className="text-[13px] font-medium text-text">{LINE_AUTOMATION_TEMPLATE_LABEL}</span>
          <textarea
            data-line-automation-editor-template
            value={draft.template}
            readOnly
            className="min-h-36 w-full rounded-2xl border border-border bg-white px-4 py-3 text-[14px] leading-relaxed text-text outline-none"
          />
        </label>

        <div className="mt-5">
          <LineAutomationPhonePreview
            officialName={officialName}
            templateTitle={definition.previewTitle}
            textBody={draft.template}
            quickReplies={definition.quickReplies}
            selectedId={definition.id}
            compact
          />
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <Button fullWidth disabled data-line-automation-save>
            {LINE_AUTOMATION_SAVE_CLOSED_LABEL}
          </Button>
          <Button variant="outline" fullWidth onClick={onClose}>
            關閉
          </Button>
        </div>
      </div>
    </div>
  );
}
