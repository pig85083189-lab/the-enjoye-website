import type { StaffRole } from "@/types/saas";
import {
  CANONICAL_CALENDAR_HREF,
  LEGACY_APPOINTMENTS_HREF,
  MOBILE_MORE_HREF,
  NAVIGATION_ITEMS,
  NAV_GROUPS,
} from "./config";
import type { NavigationGroup, NavigationItem } from "./types";

const DEFAULT_ROLE: StaffRole = "STAFF";

export function normalizeStaffRole(role: StaffRole | string | undefined | null): StaffRole {
  if (
    role === "OWNER" ||
    role === "MANAGER" ||
    role === "STAFF" ||
    role === "RECEPTIONIST" ||
    role === "ACCOUNTANT"
  ) {
    return role;
  }
  return DEFAULT_ROLE;
}

/** UX visibility only — not authorization. */
export function isNavItemVisibleForRole(
  item: NavigationItem,
  role: StaffRole | string | undefined | null,
): boolean {
  if (item.status === "future") {
    // Still show as future in More hubs for owners/managers; hide from STAFF bottom flows via roles
  }
  if (!item.roles || item.roles.length === 0) return true;
  const normalized = normalizeStaffRole(role);
  return item.roles.includes(normalized);
}

export function getVisibleNavigationItems(
  role: StaffRole | string | undefined | null,
): NavigationItem[] {
  return NAVIGATION_ITEMS.filter((item) => isNavItemVisibleForRole(item, role));
}

export function getMobilePrimaryItems(
  role: StaffRole | string | undefined | null,
): NavigationItem[] {
  return getVisibleNavigationItems(role)
    .filter((item) => typeof item.mobilePriority === "number")
    .sort((a, b) => (a.mobilePriority ?? 99) - (b.mobilePriority ?? 99));
}

/** Primary mobile tabs must stay ≤ 4 before the More hub. */
export function getMobilePrimaryNavCount(role?: StaffRole | string | null): number {
  return getMobilePrimaryItems(role).length;
}

export function getMoreHubItems(
  role: StaffRole | string | undefined | null,
): NavigationItem[] {
  const primaryIds = new Set(getMobilePrimaryItems(role).map((i) => i.id));
  return getVisibleNavigationItems(role).filter((item) => !primaryIds.has(item.id));
}

export function groupNavigationItems(
  items: NavigationItem[],
): Array<{ group: NavigationGroup; items: NavigationItem[] }> {
  return NAV_GROUPS.map((group) => ({
    group,
    items: items.filter((item) => item.group === group.id),
  })).filter((entry) => entry.items.length > 0);
}

/**
 * Active route resolution.
 * /staff/appointments is treated as calendar (canonical).
 * /staff/treatments/new|[id] activates Treatments list parent when browsing from shell.
 */
export function resolveActiveNavId(pathname: string): string | null {
  const normalized =
    pathname === LEGACY_APPOINTMENTS_HREF ||
    pathname.startsWith(`${LEGACY_APPOINTMENTS_HREF}/`)
      ? CANONICAL_CALENDAR_HREF
      : pathname;

  if (normalized === MOBILE_MORE_HREF || normalized.startsWith(`${MOBILE_MORE_HREF}/`)) {
    return "more";
  }

  if (
    normalized === "/staff/settings" ||
    normalized.startsWith("/staff/settings/")
  ) {
    return "settings";
  }

  let best: NavigationItem | null = null;
  for (const item of NAVIGATION_ITEMS) {
    const exact = normalized === item.href;
    const prefix =
      item.matchPrefix !== false &&
      (normalized === item.href || normalized.startsWith(`${item.href}/`));
    if (!exact && !prefix) continue;
    if (!best || item.href.length > best.href.length) {
      best = item;
    }
  }
  return best?.id ?? null;
}

export function isNavItemActive(item: NavigationItem, pathname: string): boolean {
  return resolveActiveNavId(pathname) === item.id;
}

export function shouldUseLeaveGuard(pathname: string): boolean {
  return pathname.startsWith("/staff/treatments");
}
