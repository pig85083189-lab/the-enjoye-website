/**
 * Settings Workspace — presentation / derived read model only.
 * Source of truth remains Organization via lib/tenant/organization-store.
 * No second organization / location / settings store.
 */
import type { Organization } from "@/types/saas";

export const SETTINGS_WORKSPACE_GAP_PX = 16;
export const SETTINGS_INLINE_MIN_PX = 1200;

export const SETTINGS_CANONICAL_TIMEZONE = "Asia/Taipei";
export const SETTINGS_CANONICAL_CURRENCY = "TWD";
export const SETTINGS_CANONICAL_LOCALE = "zh-TW";

export const SETTINGS_BRAND_TAGLINE = "Beauty · Wellness · You";

export const SETTINGS_HAS_LOGO_UPLOAD = false;
export const SETTINGS_HAS_SECOND_STORE = false;
export const SETTINGS_HAS_BOOKING_RULES = false;
export const SETTINGS_HAS_NOTIFICATION_PREFS = false;
export const SETTINGS_HAS_SYSTEM_PREFS_STORE = false;
export const SETTINGS_HAS_LOCATION_CRUD = false;

export type SettingsCategoryId =
  | "organization"
  | "locations"
  | "booking"
  | "notifications"
  | "preferences";

export const SETTINGS_CATEGORY_OPTIONS: Array<{
  id: SettingsCategoryId;
  label: string;
  enabled: boolean;
}> = [
  { id: "organization", label: "店家設定", enabled: true },
  { id: "locations", label: "分店管理", enabled: false },
  { id: "booking", label: "預約設定", enabled: false },
  { id: "notifications", label: "通知設定", enabled: false },
  { id: "preferences", label: "系統偏好", enabled: false },
];

export interface OrganizationSettingsDraft {
  name: string;
  slug: string;
  phone: string;
  email: string;
  address: string;
}

export type OrganizationSettingsSavePatch = Pick<Organization, "name" | "slug"> & {
  phone?: string;
  email?: string;
  address?: string;
};

export function isSettingsCategoryEnabled(id: SettingsCategoryId): boolean {
  return SETTINGS_CATEGORY_OPTIONS.find((entry) => entry.id === id)?.enabled ?? false;
}

export function toOrganizationSettingsDraft(
  organization: Organization,
): OrganizationSettingsDraft {
  return {
    name: organization.name,
    slug: organization.slug,
    phone: organization.phone ?? "",
    email: organization.email ?? "",
    address: organization.address ?? "",
  };
}

export function isOrganizationSettingsDirty(
  draft: OrganizationSettingsDraft,
  organization: Organization,
): boolean {
  const canonical = toOrganizationSettingsDraft(organization);
  return (
    draft.name !== canonical.name ||
    draft.slug !== canonical.slug ||
    draft.phone !== canonical.phone ||
    draft.email !== canonical.email ||
    draft.address !== canonical.address
  );
}

export function resetOrganizationSettingsDraft(
  organization: Organization,
): OrganizationSettingsDraft {
  return toOrganizationSettingsDraft(organization);
}

/** Patch for updateOrganizationLocal. Never includes presentation labels. */
export function planOrganizationSettingsSave(
  draft: OrganizationSettingsDraft,
): OrganizationSettingsSavePatch {
  return {
    name: draft.name.trim(),
    slug: draft.slug.trim(),
    phone: draft.phone.trim() || undefined,
    email: draft.email.trim() || undefined,
    address: draft.address.trim() || undefined,
  };
}

export function formatOrganizationTimezonePrimary(timezone: string): string {
  return timezone === SETTINGS_CANONICAL_TIMEZONE ? "台北（GMT+8）" : timezone;
}

export function formatOrganizationTimezoneCanonical(timezone: string): string {
  return timezone;
}

export function formatOrganizationCurrencyLabel(currency: string): string {
  return currency === SETTINGS_CANONICAL_CURRENCY ? "新台幣（TWD）" : currency;
}

export function formatOrganizationLocaleLabel(locale: string): string {
  return locale === SETTINGS_CANONICAL_LOCALE ? "繁體中文（zh-TW）" : locale;
}

export function organizationBrandInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "店";
  if (/^[\u4e00-\u9fff]/.test(trimmed)) return trimmed.slice(0, 1);
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]!.charAt(0)}${words[1]!.charAt(0)}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function canUploadOrganizationLogo(logoUrl: string | null | undefined): boolean {
  void logoUrl;
  return SETTINGS_HAS_LOGO_UPLOAD;
}

export function settingsWorkspacePresentation(
  widthPx: number,
): "desktop-split" | "mobile-stack" {
  return widthPx >= SETTINGS_INLINE_MIN_PX ? "desktop-split" : "mobile-stack";
}

export function shouldShowSettingsDirtyBar(dirty: boolean): boolean {
  return dirty;
}
