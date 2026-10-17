"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LineAutomationPhonePreview } from "@/features/line/automations/LineAutomationPhonePreview";
import { LineAutomationSwitch } from "@/features/line/automations/LineAutomationSwitch";
import { saveLineAutomationRule } from "@/lib/line/automations/actions";
import {
  LINE_AUTOMATION_EDITOR_WARNING,
  LINE_AUTOMATION_PREVIEW_MODE_LABEL,
  LINE_AUTOMATION_SAVE_LABEL,
  LINE_AUTOMATION_TEMPLATE_LABEL,
  LINE_AUTOMATION_TIMING_LABEL,
} from "@/lib/line/automations/copy";
import { lineAutomationTimingsForDraft, toggleLineAutomationTiming } from "@/lib/line/automations/draft";
import { LINE_AUTOMATION_TEMPLATE_MAX } from "@/lib/line/automations/rules";
import type { LineAutomationDefinition, LineAutomationDraft } from "@/lib/line/automations/types";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function LineAutomationRuleEditor({
  definition,
  draft,
  officialName = "THE ENJOYE",
  organizationId,
  onClose,
  onApply,
}: {
  definition: LineAutomationDefinition;
  draft: LineAutomationDraft;
  officialName?: string;
  organizationId?: string;
  onClose: () => void;
  onApply?: (next: LineAutomationDraft) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [localDraft, setLocalDraft] = useState(draft);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const timings = lineAutomationTimingsForDraft(definition.timings, localDraft);
  const canSave =
    Boolean(organizationId) &&
    localDraft.template.trim().length > 0 &&
    localDraft.template.length <= LINE_AUTOMATION_TEMPLATE_MAX &&
    localDraft.selectedTimingIds.length > 0 &&
    !saving;

  useEffect(() => {
    setLocalDraft(draft);
  }, [draft]);

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

  async function handleSave() {
    if (!organizationId || saving) return;
    setSaving(true);
    const result = await saveLineAutomationRule({
      organizationId,
      automationType: localDraft.id,
      enabled: localDraft.enabled,
      template: localDraft.template,
      selectedTimingIds: localDraft.selectedTimingIds,
      customTimings: localDraft.customTimings,
    });
    setSaving(false);
    if (!result.ok) {
      setStatusMessage(result.message);
      return;
    }
    if (result.data) {
      setLocalDraft(result.data);
      onApply?.(result.data);
    }
    setStatusMessage(result.message);
  }

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
              {statusMessage ?? LINE_AUTOMATION_EDITOR_WARNING}
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
              checked={localDraft.enabled}
              label={`${definition.title}自動發送`}
              onChange={(enabled) => setLocalDraft((current) => ({ ...current, enabled }))}
            />
          </div>

          <div className="mt-5 space-y-2">
            <p className="text-[13px] font-medium text-text">{LINE_AUTOMATION_TIMING_LABEL}</p>
            <div className="flex flex-wrap gap-2">
              {timings.map((timing) => {
                const selected = localDraft.selectedTimingIds.includes(timing.id);
                return (
                  <button
                    key={timing.id}
                    type="button"
                    data-line-automation-timing={timing.id}
                    data-selected={selected ? "true" : "false"}
                    aria-pressed={selected}
                    onClick={() =>
                      setLocalDraft((current) => {
                        const next = toggleLineAutomationTiming(current, timing.id);
                        return next.selectedTimingIds.length === 0 ? current : next;
                      })
                    }
                    className={
                      selected
                        ? "rounded-full border border-primary/35 bg-primary-light/70 px-3 py-1.5 text-[13px] font-medium text-primary"
                        : "rounded-full border border-[#E8D0CE] bg-white px-3 py-1.5 text-[13px] text-secondary-text"
                    }
                  >
                    {timing.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="mt-5 block space-y-2">
            <span className="text-[13px] font-medium text-text">{LINE_AUTOMATION_TEMPLATE_LABEL}</span>
            <textarea
              data-line-automation-editor-template
              value={localDraft.template}
              maxLength={LINE_AUTOMATION_TEMPLATE_MAX}
              onChange={(event) =>
                setLocalDraft((current) => ({ ...current, template: event.target.value }))
              }
              className="min-h-32 w-full rounded-2xl border border-border bg-white px-4 py-3 text-[14px] leading-relaxed text-text outline-none"
            />
          </label>

            </div>
            <div className="min-w-0 lg:sticky lg:top-0">
              <p className="mb-3 text-[13px] font-medium text-text">LINE 訊息預覽</p>
              <LineAutomationPhonePreview
                officialName={officialName}
                templateTitle={definition.previewTitle}
                textBody={localDraft.template}
                quickReplies={definition.quickReplies}
                selectedId={definition.id}
                compact
              />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-border/70 bg-[#FFFCFB] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row-reverse sm:px-5">
          <Button fullWidth disabled={!canSave} data-line-automation-save onClick={handleSave}>
            {LINE_AUTOMATION_SAVE_LABEL}
          </Button>
          <Button variant="outline" fullWidth onClick={onClose}>
            關閉
          </Button>
        </div>
      </div>
    </div>
  );
}
