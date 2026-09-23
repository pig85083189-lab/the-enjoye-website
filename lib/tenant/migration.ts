import {
  LEGACY_STORAGE_KEYS,
  MIGRATION_FLAG_KEY,
  ORG_ENJOYE_ID,
} from "./constants";
import {
  getConsultationDraftKey,
  getTenantStorageKey,
  getTreatmentDraftKey,
  isLegacyMigrationOrg,
  legacyKeyForResource,
  type TenantResource,
} from "./storage-keys";

const RESOURCES: TenantResource[] = [
  "customers",
  "consultations",
  "customer-notes",
  "customer-photos",
  "appointments",
  "treatments-completed",
  "appointment-status",
];

type MigrationFlags = Record<string, boolean>;

function readFlags(): MigrationFlags {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MIGRATION_FLAG_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as MigrationFlags;
  } catch {
    return {};
  }
}

function writeFlags(flags: MigrationFlags): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MIGRATION_FLAG_KEY, JSON.stringify(flags));
}

function copyIfMissing(fromKey: string, toKey: string): void {
  if (typeof window === "undefined") return;
  const existing = window.localStorage.getItem(toKey);
  if (existing !== null && existing !== "") return;
  const legacy = window.localStorage.getItem(fromKey);
  if (legacy === null || legacy === "") return;
  window.localStorage.setItem(toKey, legacy);
}

/**
 * Idempotent migration of Phase 4 THE ENJOYE localStorage → tenant-scoped keys.
 * Other organizations never read legacy keys.
 */
export function migrateLegacyTenantStorage(organizationId: string): void {
  if (typeof window === "undefined") return;
  if (!isLegacyMigrationOrg(organizationId)) return;

  const flags = readFlags();
  const flagKey = `${organizationId}:core`;
  if (flags[flagKey]) return;

  for (const resource of RESOURCES) {
    const legacy = legacyKeyForResource(resource);
    if (!legacy) continue;
    const next = getTenantStorageKey(organizationId, resource);
    copyIfMissing(legacy, next);
  }

  // Consultation drafts: copy known "new" + any keys with legacy prefix
  const draftPrefix = LEGACY_STORAGE_KEYS.consultationDraftPrefix;
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(draftPrefix)) continue;
    const suffix = key.slice(draftPrefix.length);
    copyIfMissing(key, getConsultationDraftKey(ORG_ENJOYE_ID, suffix));
  }

  const treatmentPrefix = LEGACY_STORAGE_KEYS.treatmentDraftPrefix;
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(treatmentPrefix)) continue;
    const suffix = key.slice(treatmentPrefix.length);
    copyIfMissing(key, getTreatmentDraftKey(ORG_ENJOYE_ID, suffix));
  }

  flags[flagKey] = true;
  writeFlags(flags);
}
