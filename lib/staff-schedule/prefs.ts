import { getCalendarViewPrefsKey } from "@/lib/tenant/storage-keys";

export type CalendarViewMode = "day" | "week";

export interface CalendarViewPrefs {
  desktopView: CalendarViewMode;
}

export function readCalendarViewPrefs(organizationId: string): CalendarViewPrefs {
  // Default day view for staff ops workbench (time × staff).
  if (typeof window === "undefined") return { desktopView: "day" };
  try {
    const raw = localStorage.getItem(getCalendarViewPrefsKey(organizationId));
    if (!raw) return { desktopView: "day" };
    const parsed = JSON.parse(raw) as CalendarViewPrefs;
    if (parsed.desktopView === "day" || parsed.desktopView === "week") return parsed;
  } catch {
    /* ignore */
  }
  return { desktopView: "day" };
}

export function writeCalendarViewPrefs(
  organizationId: string,
  prefs: CalendarViewPrefs,
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(getCalendarViewPrefsKey(organizationId), JSON.stringify(prefs));
}
