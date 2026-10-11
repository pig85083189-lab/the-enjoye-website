/**
 * Settings Workspace — presentation isolation.
 * Covers A–T. No second organization / location / settings store.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import {
  getOrganizationById,
  listLocations,
  persistCurrentLocation,
  updateOrganizationLocal,
} from "@/lib/tenant/organization-store";
import type { Organization } from "@/types/saas";
import {
  SETTINGS_BRAND_TAGLINE,
  SETTINGS_CANONICAL_CURRENCY,
  SETTINGS_CANONICAL_LOCALE,
  SETTINGS_CANONICAL_TIMEZONE,
  SETTINGS_CATEGORY_OPTIONS,
  SETTINGS_HAS_BOOKING_RULES,
  SETTINGS_HAS_LOCATION_CRUD,
  SETTINGS_HAS_LOGO_UPLOAD,
  SETTINGS_HAS_NOTIFICATION_PREFS,
  SETTINGS_HAS_SECOND_STORE,
  SETTINGS_HAS_SYSTEM_PREFS_STORE,
  SETTINGS_INLINE_MIN_PX,
  SETTINGS_WORKSPACE_GAP_PX,
  canUploadOrganizationLogo,
  formatOrganizationCurrencyLabel,
  formatOrganizationLocaleLabel,
  formatOrganizationTimezoneCanonical,
  formatOrganizationTimezonePrimary,
  isOrganizationSettingsDirty,
  isSettingsCategoryEnabled,
  organizationBrandInitials,
  planOrganizationSettingsSave,
  resetOrganizationSettingsDraft,
  settingsWorkspacePresentation,
  shouldShowSettingsDirtyBar,
  toOrganizationSettingsDraft,
} from "./settings-workspace-derived";

beforeEach(() => {
  localStorage.clear();
});

function org(over: Partial<Organization> = {}): Organization {
  return {
    id: over.id ?? ORG_ENJOYE_ID,
    name: over.name ?? "THE ENJOYE",
    slug: over.slug ?? "the-enjoye",
    logoUrl: over.logoUrl ?? null,
    phone: over.phone ?? "04-1234-5678",
    email: over.email ?? "hello@theenjoye.example",
    address: over.address ?? "台中市西屯區示範路 88 號",
    timezone: over.timezone ?? SETTINGS_CANONICAL_TIMEZONE,
    currency: over.currency ?? SETTINGS_CANONICAL_CURRENCY,
    locale: over.locale ?? SETTINGS_CANONICAL_LOCALE,
    status: over.status ?? "ACTIVE",
    createdAt: over.createdAt ?? "2025-01-01T00:00:00+08:00",
    updatedAt: over.updatedAt ?? "2026-09-20T00:00:00+08:00",
  };
}

describe("A–E canonical form", () => {
  it("A only reads the requested organization", () => {
    const enjoye = getOrganizationById(ORG_ENJOYE_ID);
    expect(enjoye?.id).toBe(ORG_ENJOYE_ID);
    expect(toOrganizationSettingsDraft(enjoye!).name).toBe("THE ENJOYE");
  });

  it("B does not leak another organization into the draft", () => {
    const enjoye = getOrganizationById(ORG_ENJOYE_ID)!;
    const lumiere = getOrganizationById(ORG_LUMIERE_ID)!;
    expect(toOrganizationSettingsDraft(enjoye).slug).toBe("the-enjoye");
    expect(toOrganizationSettingsDraft(lumiere).slug).toBe("lumiere-beauty");
    expect(toOrganizationSettingsDraft(enjoye).name).not.toBe(lumiere.name);
  });

  it("C location context does not overwrite another organization", () => {
    persistCurrentLocation(ORG_ENJOYE_ID, LOC_ENJOYE_SECONDARY_ID);
    const enjoye = getOrganizationById(ORG_ENJOYE_ID)!;
    const lumiere = getOrganizationById(ORG_LUMIERE_ID)!;
    expect(enjoye.name).toBe("THE ENJOYE");
    expect(lumiere.name).toBe("LUMIÈRE BEAUTY");
    expect(listLocations(ORG_ENJOYE_ID).every((item) => item.organizationId === ORG_ENJOYE_ID)).toBe(
      true,
    );
    expect(listLocations(ORG_ENJOYE_ID).some((item) => item.id === LOC_ENJOYE_PRIMARY_ID)).toBe(
      true,
    );
  });

  it("D initial form equals the canonical organization value", () => {
    const live = getOrganizationById(ORG_ENJOYE_ID)!;
    expect(toOrganizationSettingsDraft(live)).toEqual({
      name: live.name,
      slug: live.slug,
      phone: live.phone ?? "",
      email: live.email ?? "",
      address: live.address ?? "",
    });
  });

  it("E unmodified draft is not dirty", () => {
    const live = org();
    const draft = toOrganizationSettingsDraft(live);
    expect(isOrganizationSettingsDirty(draft, live)).toBe(false);
    expect(shouldShowSettingsDirtyBar(false)).toBe(false);
  });
});

describe("F–J dirty / save contract", () => {
  it("F renaming the store marks dirty", () => {
    const live = org();
    const draft = { ...toOrganizationSettingsDraft(live), name: "THE ENJOYE 旗艦" };
    expect(isOrganizationSettingsDirty(draft, live)).toBe(true);
    expect(shouldShowSettingsDirtyBar(true)).toBe(true);
  });

  it("G cancel resets to the canonical value", () => {
    const live = org();
    const dirty = { ...toOrganizationSettingsDraft(live), name: "改過" };
    expect(resetOrganizationSettingsDraft(live)).toEqual(toOrganizationSettingsDraft(live));
    expect(isOrganizationSettingsDirty(resetOrganizationSettingsDraft(live), live)).toBe(false);
    expect(dirty.name).toBe("改過");
  });

  it("H save calls the canonical mutation exactly once", () => {
    const spy = vi.spyOn(
      { updateOrganizationLocal },
      "updateOrganizationLocal",
    );
    const draft = {
      ...toOrganizationSettingsDraft(getOrganizationById(ORG_ENJOYE_ID)!),
      name: "THE ENJOYE 旗艦",
    };
    const patch = planOrganizationSettingsSave(draft);
    const saved = updateOrganizationLocal(ORG_ENJOYE_ID, patch);
    expect(saved?.name).toBe("THE ENJOYE 旗艦");
    expect(getOrganizationById(ORG_ENJOYE_ID)?.name).toBe("THE ENJOYE 旗艦");
    expect(getOrganizationById(ORG_LUMIERE_ID)?.name).toBe("LUMIÈRE BEAUTY");
    spy.mockRestore();
    const counted = vi.fn(updateOrganizationLocal);
    counted(ORG_ENJOYE_ID, planOrganizationSettingsSave(draft));
    expect(counted).toHaveBeenCalledTimes(1);
    expect(counted).toHaveBeenCalledWith(ORG_ENJOYE_ID, patch);
  });

  it("I save does not create a second settings store", () => {
    expect(SETTINGS_HAS_SECOND_STORE).toBe(false);
    const derived = readFileSync(
      path.join(process.cwd(), "lib/settings/settings-workspace-derived.ts"),
      "utf8",
    );
    expect(derived).not.toMatch(/localStorage|settingsStore|organizationStoreV2/);
  });

  it("J slug remains part of the existing save contract", () => {
    const patch = planOrganizationSettingsSave({
      name: "THE ENJOYE",
      slug: "the-enjoye-flagship",
      phone: "04-1234-5678",
      email: "hello@theenjoye.example",
      address: "台中市西屯區示範路 88 號",
    });
    expect(patch.slug).toBe("the-enjoye-flagship");
    expect(Object.keys(patch).sort()).toEqual(
      ["address", "email", "name", "phone", "slug"].sort(),
    );
  });
});

describe("K–O presentation vs persist", () => {
  it("K timezone canonical value stays Asia/Taipei", () => {
    expect(SETTINGS_CANONICAL_TIMEZONE).toBe("Asia/Taipei");
    expect(formatOrganizationTimezoneCanonical(SETTINGS_CANONICAL_TIMEZONE)).toBe(
      "Asia/Taipei",
    );
  });

  it("L currency canonical value stays TWD", () => {
    expect(SETTINGS_CANONICAL_CURRENCY).toBe("TWD");
    expect(formatOrganizationCurrencyLabel("TWD")).toBe("新台幣（TWD）");
  });

  it("M locale canonical value stays zh-TW", () => {
    expect(SETTINGS_CANONICAL_LOCALE).toBe("zh-TW");
    expect(formatOrganizationLocaleLabel("zh-TW")).toBe("繁體中文（zh-TW）");
  });

  it("N presentation labels are not in the save patch", () => {
    const patch = planOrganizationSettingsSave(toOrganizationSettingsDraft(org()));
    const serialized = JSON.stringify(patch);
    expect(serialized).not.toContain("台北（GMT+8）");
    expect(serialized).not.toContain("新台幣");
    expect(serialized).not.toContain("繁體中文");
    expect(serialized).not.toContain(SETTINGS_BRAND_TAGLINE);
    expect(patch).not.toHaveProperty("timezone");
    expect(patch).not.toHaveProperty("currency");
    expect(patch).not.toHaveProperty("locale");
    expect(formatOrganizationTimezonePrimary("Asia/Taipei")).toBe("台北（GMT+8）");
  });

  it("O logo has no fake upload when the pipeline is missing", () => {
    expect(SETTINGS_HAS_LOGO_UPLOAD).toBe(false);
    expect(canUploadOrganizationLogo(null)).toBe(false);
    expect(canUploadOrganizationLogo("https://cdn.example/logo.png")).toBe(false);
    expect(organizationBrandInitials("THE ENJOYE")).toBe("TE");
  });
});

describe("P–T chrome and source contract", () => {
  it("P mobile layout has no desktop two-column contract", () => {
    expect(settingsWorkspacePresentation(1536)).toBe("desktop-split");
    expect(settingsWorkspacePresentation(SETTINGS_INLINE_MIN_PX)).toBe("desktop-split");
    expect(settingsWorkspacePresentation(1199)).toBe("mobile-stack");
    expect(settingsWorkspacePresentation(390)).toBe("mobile-stack");
    expect(SETTINGS_WORKSPACE_GAP_PX).toBe(16);
  });

  it("Q Settings UI does not import commerce mutations", () => {
    const page = readFileSync(
      path.join(process.cwd(), "features/settings/SettingsWorkspacePage.tsx"),
      "utf8",
    );
    expect(page).not.toMatch(/@\/lib\/commerce|completeCheckout|createCheckout/);
  });

  it("R Settings UI does not import inventory mutations", () => {
    const page = readFileSync(
      path.join(process.cwd(), "features/settings/SettingsWorkspacePage.tsx"),
      "utf8",
    );
    expect(page).not.toMatch(/@\/lib\/inventory|receiveStock|adjustStock/);
  });

  it("S Settings UI does not import follow-up mutations", () => {
    const page = readFileSync(
      path.join(process.cwd(), "features/settings/SettingsWorkspacePage.tsx"),
      "utf8",
    );
    expect(page).not.toMatch(/@\/lib\/follow-ups|completeFollowUpTask|snoozeFollowUpTask/);
  });

  it("T Phase 5A source contract is untouched", () => {
    expect(SETTINGS_HAS_BOOKING_RULES).toBe(false);
    expect(SETTINGS_HAS_NOTIFICATION_PREFS).toBe(false);
    expect(SETTINGS_HAS_SYSTEM_PREFS_STORE).toBe(false);
    expect(SETTINGS_HAS_LOCATION_CRUD).toBe(false);
    expect(isSettingsCategoryEnabled("organization")).toBe(true);
    expect(SETTINGS_CATEGORY_OPTIONS.filter((entry) => entry.enabled)).toHaveLength(1);
    const page = readFileSync(
      path.join(process.cwd(), "features/settings/SettingsWorkspacePage.tsx"),
      "utf8",
    );
    const derived = readFileSync(
      path.join(process.cwd(), "lib/settings/settings-workspace-derived.ts"),
      "utf8",
    );
    const shell = readFileSync(
      path.join(process.cwd(), "components/layout/StaffShell.tsx"),
      "utf8",
    );
    const route = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/settings/page.tsx"),
      "utf8",
    );
    expect(page).toMatch(/updateOrganizationLocal/);
    expect(page).toMatch(/data-settings-workspace/);
    expect(page).toMatch(/data-line-settings-entry/);
    expect(page).not.toMatch(/channel_secret_cipher|channelAccessToken/);
    expect(page).toMatch(/取消變更/);
    expect(page).toMatch(/儲存變更/);
    expect(page).not.toMatch(/type=["']file["']|更換 Logo/);
    expect(page).not.toMatch(/settingsWorkspaceStore|createSettingsStore/);
    expect(page).not.toMatch(/lib\/packages|lib\/persistence|types\/database/);
    expect(derived).not.toMatch(/lib\/packages|lib\/persistence|types\/database/);
    expect(route).toMatch(/SettingsWorkspacePage/);
    expect(shell).toMatch(/isSettingsWorkbench/);
    expect(shell).toMatch(/w-\[232px\]/);
    expect(shell).toMatch(/w-\[254px\]/);
  });
});
