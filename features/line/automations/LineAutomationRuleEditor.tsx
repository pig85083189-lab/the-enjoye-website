"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { LineAutomationSwitch } from "@/features/line/automations/LineAutomationSwitch";
import {
  LINE_AUTOMATION_APPLY_LOCAL_LABEL,
  LINE_AUTOMATION_EDITOR_WARNING,
  LINE_AUTOMATION_LOCAL_DRAFT_HINT,
  LINE_AUTOMATION_REMINDER_BACKEND_HINT,
  LINE_AUTOMATION_REMINDER_EDITOR_WARNING,
  LINE_AUTOMATION_SAVE_RULE_LABEL,
} from "@/lib/line/automations/copy";
import {
  addLineAutomationCustomTiming,
  lineAutomationTimingsForDraft,
  toggleLineAutomationTiming,
} from "@/lib/line/automations/draft";
import type { LineAutomationDefinition, LineAutomationDraft } from "@/lib/line/automations/types";
import { cn } from "@/lib/utils";

export function LineAutomationRuleEditor({
  definition,
  draft,
  onClose,
  onApply,
  persistMessage,
}: {
  definition: LineAutomationDefinition;
  draft: LineAutomationDraft;
  onClose: () => void;
  onApply: (next: LineAutomationDraft) => void;
  persistMessage?: string | null;
}) {
  const isReminder = definition.id === "appointment_reminder";
  const [next, setNext] = useState(draft);
  const [customLabel, setCustomLabel] = useState("");
  const timings = lineAutomationTimingsForDraft(definition.timings, next);

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
              設定{definition.title}規則
            </h2>
            <p className="mt-1 text-[13px] text-secondary-text">
              {isReminder ? LINE_AUTOMATION_REMINDER_BACKEND_HINT : LINE_AUTOMATION_LOCAL_DRAFT_HINT}
            </p>
          </div>
          <LineAutomationSwitch
            checked={next.enabled}
            label={`${definition.title}自動發送`}
            onChange={(enabled) => setNext((current) => ({ ...current, enabled }))}
          />
        </div>

        <div className="mt-5 space-y-2">
          <p className="text-[13px] font-medium text-text">發送時機</p>
          <div className="flex flex-wrap gap-2">
            {timings.map((timing) => {
              const selected = next.selectedTimingIds.includes(timing.id);
              return (
                <button
                  key={timing.id}
                  type="button"
                  onClick={() => setNext((current) => toggleLineAutomationTiming(current, timing.id))}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[13px]",
                    selected
                      ? "border-primary bg-primary-light text-primary"
                      : "border-border bg-white text-secondary-text",
                  )}
                >
                  {timing.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={customLabel}
              onChange={(event) => setCustomLabel(event.target.value)}
              placeholder={definition.addTimingLabel.replace(/^\+\s*/, "")}
              className="min-h-11 flex-1 rounded-2xl border border-border bg-white px-4 text-[14px] outline-none"
            />
            <Button
              variant="outline"
              onClick={() => {
                setNext((current) => addLineAutomationCustomTiming(current, customLabel));
                setCustomLabel("");
              }}
            >
              新增時機
            </Button>
          </div>
        </div>

        <label className="mt-5 block space-y-2">
          <span className="text-[13px] font-medium text-text">訊息範本</span>
          <textarea
            data-line-automation-editor-template
            value={next.template}
            onChange={(event) =>
              setNext((current) => ({ ...current, template: event.target.value }))
            }
            className="min-h-48 w-full rounded-2xl border border-border bg-white px-4 py-3 text-[14px] leading-relaxed outline-none"
          />
        </label>

        <p className="mt-3 text-[12px] leading-relaxed text-secondary-text">
          {isReminder ? LINE_AUTOMATION_REMINDER_EDITOR_WARNING : LINE_AUTOMATION_EDITOR_WARNING}
        </p>
        {persistMessage ? (
          <p className="mt-2 text-[12px] text-secondary-text" data-line-automation-persist-message>
            {persistMessage}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            fullWidth
            onClick={() => {
              onApply(next);
              onClose();
            }}
          >
            {isReminder ? LINE_AUTOMATION_SAVE_RULE_LABEL : LINE_AUTOMATION_APPLY_LOCAL_LABEL}
          </Button>
          <Button variant="outline" fullWidth onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
