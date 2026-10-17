"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LineAutomationPhonePreview } from "@/features/line/automations/LineAutomationPhonePreview";
import { LineAutomationSwitch } from "@/features/line/automations/LineAutomationSwitch";
import {
  LINE_AUTOMATION_EDITOR_WARNING,
  LINE_AUTOMATION_PREVIEW_MODE_LABEL,
  LINE_AUTOMATION_SAVE_CLOSED_LABEL,
  LINE_AUTOMATION_TEMPLATE_LABEL,
  LINE_AUTOMATION_TIMING_LABEL,
} from "@/lib/line/automations/copy";
import { lineAutomationTimingsForDraft } from "@/lib/line/automations/draft";
import type { LineAutomationDefinition, LineAutomationDraft } from "@/lib/line/automations/types";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const timings = lineAutomationTimingsForDraft(definition.timings, draft);

  useEffect(() => {
    const node = dialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node?.querySelector<HTMLElement>("[data-line-automation-editor-close]")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => !item.hasAttribute("disabled") && item.tabIndex !== -1,
      );
      if (items.length === 0) return;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(48,43,43,0.35)] px-3 py-3 sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        data-line-automation-editor
        role="dialog"
        aria-modal="true"
        aria-labelledby="line-automation-editor-title"
        className="flex h-[min(92vh,calc(100dvh-1.5rem))] min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-t-[24px] border border-border bg-[#FFFCFB] shadow-[0_16px_40px_rgba(48,43,43,0.12)] sm:h-[min(84vh,46rem)] sm:rounded-[20px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/70 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id="line-automation-editor-title" className="text-[18px] font-semibold text-text">
              設定{definition.title}
            </h2>
            <p
              data-line-automation-preview-mode
              className="mt-2 inline-flex rounded-full border border-[#E8D0CE] bg-white px-2.5 py-1 text-[12px] font-medium text-primary"
            >
              {LINE_AUTOMATION_PREVIEW_MODE_LABEL}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-secondary-text">
              {LINE_AUTOMATION_EDITOR_WARNING}
            </p>
          </div>
          <button
            type="button"
            data-line-automation-editor-close
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-2xl text-secondary-text hover:bg-primary-light/70"
            aria-label="關閉"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-5">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.9fr)] lg:items-start">
            <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-secondary-text">自動發送</p>
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
              className="min-h-32 w-full rounded-2xl border border-border bg-white px-4 py-3 text-[14px] leading-relaxed text-text outline-none"
            />
          </label>

            </div>
            <div className="min-w-0 lg:sticky lg:top-0">
              <p className="mb-3 text-[13px] font-medium text-text">LINE 訊息預覽</p>
              <LineAutomationPhonePreview
                officialName={officialName}
                templateTitle={definition.previewTitle}
                textBody={draft.template}
                quickReplies={definition.quickReplies}
                selectedId={definition.id}
                compact
              />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-border/70 bg-[#FFFCFB] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row-reverse sm:px-5">
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
