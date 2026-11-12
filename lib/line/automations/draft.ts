import { LINE_AUTOMATION_CATALOG } from "./catalog";
import { LINE_AUTOMATION_EMPTY_STAT } from "./copy";
import { LINE_AUTOMATION_IDS, type LineAutomationDraft, type LineAutomationId, type LineAutomationStats, type LineAutomationTiming } from "./types";

export const LINE_AUTOMATION_MAX_CUSTOM_TIMINGS = 3;

export function createEmptyLineAutomationStats(): LineAutomationStats {
  return {
    sentThisMonth: null,
    plannedThisMonth: null,
    successRate: null,
    pendingTasks: null,
  };
}

export function formatLineAutomationStat(value: number | null): string {
  return value == null ? LINE_AUTOMATION_EMPTY_STAT : String(value);
}

export function createDefaultLineAutomationDraft(
  id: LineAutomationId,
): LineAutomationDraft {
  const definition = LINE_AUTOMATION_CATALOG.find((item) => item.id === id);
  if (!definition) {
    throw new Error(`Unknown LINE automation: ${id}`);
  }
  return {
    id,
    enabled: false,
    selectedTimingIds: [...definition.defaultTimingIds],
    customTimings: [],
    template: definition.demoTemplate,
  };
}

export function createDefaultLineAutomationDrafts(): Record<
  LineAutomationId,
  LineAutomationDraft
> {
  return Object.fromEntries(
    LINE_AUTOMATION_IDS.map((id) => [id, createDefaultLineAutomationDraft(id)]),
  ) as Record<LineAutomationId, LineAutomationDraft>;
}

export function allLineAutomationsDefaultOff(
  drafts: Record<LineAutomationId, LineAutomationDraft>,
): boolean {
  return LINE_AUTOMATION_IDS.every((id) => drafts[id]?.enabled === false);
}

export function setLineAutomationEnabled(
  drafts: Record<LineAutomationId, LineAutomationDraft>,
  id: LineAutomationId,
  enabled: boolean,
): Record<LineAutomationId, LineAutomationDraft> {
  return {
    ...drafts,
    [id]: {
      ...drafts[id],
      enabled,
    },
  };
}

export function toggleLineAutomationTiming(
  draft: LineAutomationDraft,
  timingId: string,
): LineAutomationDraft {
  const selected = draft.selectedTimingIds.includes(timingId)
    ? draft.selectedTimingIds.filter((id) => id !== timingId)
    : [...draft.selectedTimingIds, timingId];
  return { ...draft, selectedTimingIds: selected };
}

export function addLineAutomationCustomTiming(
  draft: LineAutomationDraft,
  label: string,
): LineAutomationDraft {
  const trimmed = label.trim();
  if (!trimmed) return draft;
  if (draft.customTimings.length >= LINE_AUTOMATION_MAX_CUSTOM_TIMINGS) return draft;
  const id = `custom_${draft.customTimings.length + 1}_${trimmed}`;
  if (draft.customTimings.some((item) => item.label === trimmed)) return draft;
  const timing: LineAutomationTiming = { id, label: trimmed, builtin: false };
  return {
    ...draft,
    customTimings: [...draft.customTimings, timing],
    selectedTimingIds: [...draft.selectedTimingIds, id],
  };
}

export function applyLineAutomationEditor(
  drafts: Record<LineAutomationId, LineAutomationDraft>,
  next: LineAutomationDraft,
): Record<LineAutomationId, LineAutomationDraft> {
  return {
    ...drafts,
    [next.id]: {
      ...next,
      template: next.template.trim() || drafts[next.id].template,
    },
  };
}

export function resetLineAutomationDraftsOnOrganizationChange(input: {
  previousOrganizationId: string | null;
  nextOrganizationId: string;
  drafts: Record<LineAutomationId, LineAutomationDraft>;
}): {
  reset: boolean;
  drafts: Record<LineAutomationId, LineAutomationDraft>;
} {
  if (
    !input.previousOrganizationId ||
    input.previousOrganizationId === input.nextOrganizationId
  ) {
    return { reset: false, drafts: input.drafts };
  }
  return { reset: true, drafts: createDefaultLineAutomationDrafts() };
}

export function lineAutomationTimingsForDraft(
  definitionTimings: readonly LineAutomationTiming[],
  draft: LineAutomationDraft,
): LineAutomationTiming[] {
  return [...definitionTimings, ...draft.customTimings];
}
