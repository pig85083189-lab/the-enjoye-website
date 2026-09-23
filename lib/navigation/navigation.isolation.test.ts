/**
 * Phase 4.7 — Navigation / IA resolve helpers (no full UI snapshots).
 */
import { describe, expect, it } from "vitest";
import {
  CANONICAL_CALENDAR_HREF,
  LEGACY_APPOINTMENTS_HREF,
  MOBILE_MORE_HREF,
  NAVIGATION_ITEMS,
} from "@/lib/navigation/config";
import {
  getMobilePrimaryItems,
  getMobilePrimaryNavCount,
  getMoreHubItems,
  getVisibleNavigationItems,
  isNavItemVisibleForRole,
  resolveActiveNavId,
  shouldUseLeaveGuard,
} from "@/lib/navigation/resolve";
import {
  canAccessLocation,
  canAccessOrganization,
} from "@/lib/tenant/access";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_LUMIERE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import {
  persistCurrentLocation,
  persistOrganizationId,
} from "@/lib/tenant/organization-store";

describe("active route resolution", () => {
  it("resolves today and customers", () => {
    expect(resolveActiveNavId("/staff/today")).toBe("today");
    expect(resolveActiveNavId("/staff/customers")).toBe("customers");
    expect(resolveActiveNavId("/staff/customers/demo-001")).toBe("customers");
  });

  it("maps legacy appointments to calendar canonical", () => {
    expect(LEGACY_APPOINTMENTS_HREF).toBe("/staff/appointments");
    expect(CANONICAL_CALENDAR_HREF).toBe("/staff/calendar");
    expect(resolveActiveNavId("/staff/appointments")).toBe("calendar");
    expect(resolveActiveNavId("/staff/calendar")).toBe("calendar");
  });

  it("treatments workspace activates treatments parent", () => {
    expect(resolveActiveNavId("/staff/treatments")).toBe("treatments");
    expect(resolveActiveNavId("/staff/treatments/new")).toBe("treatments");
    expect(resolveActiveNavId("/staff/treatments/treatment-seed-001")).toBe(
      "treatments",
    );
  });

  it("settings nested routes activate settings", () => {
    expect(resolveActiveNavId("/staff/settings")).toBe("settings");
    expect(resolveActiveNavId("/staff/settings/organization")).toBe("settings");
    expect(resolveActiveNavId("/staff/settings/locations")).toBe("settings");
  });

  it("more hub resolves as more", () => {
    expect(resolveActiveNavId(MOBILE_MORE_HREF)).toBe("more");
  });
});

describe("mobile primary navigation", () => {
  it("keeps primary tabs ≤ 4 for STAFF", () => {
    expect(getMobilePrimaryNavCount("STAFF")).toBeLessThanOrEqual(4);
    expect(getMobilePrimaryItems("STAFF").map((i) => i.id)).toEqual([
      "today",
      "calendar",
      "customers",
    ]);
  });

  it("More hub excludes primary destinations", () => {
    const more = getMoreHubItems("STAFF");
    expect(more.some((i) => i.id === "today")).toBe(false);
    expect(more.some((i) => i.id === "checkout" || i.id === "treatments")).toBe(
      true,
    );
  });
});

describe("role-aware visibility", () => {
  it("hides Staff and Settings from STAFF role", () => {
    const ids = getVisibleNavigationItems("STAFF").map((i) => i.id);
    expect(ids).not.toContain("staff");
    expect(ids).not.toContain("settings");
    expect(ids).not.toContain("reports");
  });

  it("shows Staff and Settings for OWNER", () => {
    const ids = getVisibleNavigationItems("OWNER").map((i) => i.id);
    expect(ids).toContain("staff");
    expect(ids).toContain("settings");
    expect(ids).toContain("reports");
  });

  it("RECEPTIONIST can see checkout but not treatments list by role gate", () => {
    expect(isNavItemVisibleForRole(
      NAVIGATION_ITEMS.find((i) => i.id === "checkout")!,
      "RECEPTIONIST",
    )).toBe(true);
    expect(isNavItemVisibleForRole(
      NAVIGATION_ITEMS.find((i) => i.id === "treatments")!,
      "RECEPTIONIST",
    )).toBe(false);
  });
});

describe("leave guard helper", () => {
  it("flags treatment routes", () => {
    expect(shouldUseLeaveGuard("/staff/treatments/new")).toBe(true);
    expect(shouldUseLeaveGuard("/staff/today")).toBe(false);
  });
});

describe("org/location switch still fail-closed (4.5B regression)", () => {
  it("rejects cross-org location and unauthorized org", () => {
    expect(canAccessLocation(ORG_ENJOYE_ID, LOC_LUMIERE_PRIMARY_ID)).toBe(false);
    expect(persistCurrentLocation(ORG_ENJOYE_ID, LOC_LUMIERE_PRIMARY_ID)).toBe(
      false,
    );
    expect(canAccessOrganization("nobody", ORG_ENJOYE_ID)).toBe(false);
    expect(persistOrganizationId(ORG_LUMIERE_ID, "nobody")).toBe(false);
    expect(persistOrganizationId(ORG_ENJOYE_ID, "staff-001")).toBe(true);
    expect(persistCurrentLocation(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID)).toBe(
      true,
    );
  });
});

describe("catalog completeness", () => {
  it("has unique ids and hrefs", () => {
    const ids = NAVIGATION_ITEMS.map((i) => i.id);
    const hrefs = NAVIGATION_ITEMS.map((i) => i.href);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
