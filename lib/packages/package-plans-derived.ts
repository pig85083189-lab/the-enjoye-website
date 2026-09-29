/**
 * Package Plans workspace — presentation helpers only.
 *
 * Canonical catalog is PackageDefinition (lib/packages/domain + store).
 * This module does not persist, does not invent a second store, and does not
 * change purchase / redemption lifecycle.
 *
 * Honest domain limits:
 * - includedServices[] are eligible service identities (canonical serviceId).
 * - sessionCount is a SHARED pool. Redemption of any eligible service deducts 1.
 * - sessionsPerRedemption is always 1. Per-service quotas are not persisted.
 * - PackageDefinition has no location restriction. Sale is organization-wide.
 * - Sold / active-holder counts are derived from CustomerPackage + ledger.
 */
import { parseMoneyInput } from "@/lib/commerce/money";
import type {
  CustomerPackage,
  PackageDefinition,
  PackageLedgerEntry,
} from "@/lib/packages/domain";
import { derivePackageWorkspaceStatus } from "@/lib/packages/packages-workspace-derived";
import type { StaffRole } from "@/types/saas";

export const PACKAGE_PLANS_PANEL_WIDTH_PX = 400;
export const PACKAGE_PLANS_INLINE_MIN_PX = 1200;
export const PACKAGE_PLANS_WORKSPACE_GAP_PX = 16;

export const PACKAGE_PLANS_HAS_LOCATION_RESTRICTION = false;
export const PACKAGE_PLANS_HAS_PER_SERVICE_QUOTA = false;
export const PACKAGE_PLANS_USES_SHARED_SESSION_POOL = true;
export const PACKAGE_PLANS_HAS_PERSISTED_KPI = false;
export const PACKAGE_PLANS_HAS_SECOND_STORE = false;

export const PACKAGE_PLAN_HREF = "/staff/packages/plans";

/** Same mutate gate already used by customer-package adjustment on /staff/packages. */
export const PACKAGE_PLAN_MANAGE_ROLES: ReadonlySet<StaffRole> = new Set([
  "OWNER",
  "MANAGER",
]);

export type PackagePlanListFilter = "all" | "active" | "inactive";
export type PackagePlanStep = 1 | 2 | 3;
export type PackagePlanValidityMode = "none" | "180" | "365" | "custom";

export const PACKAGE_PLAN_FILTER_OPTIONS: Array<{
  id: PackagePlanListFilter;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "active", label: "販售中" },
  { id: "inactive", label: "已停售" },
];

export const PACKAGE_PLAN_STEPS: Array<{ id: PackagePlanStep; label: string }> = [
  { id: 1, label: "基本資料" },
  { id: 2, label: "套票內容" },
  { id: 3, label: "販售設定" },
];

export const PACKAGE_PLAN_VALIDITY_PRESETS = [180, 365] as const;

export interface PackagePlanWorkspaceRow {
  definitionId: string;
  name: string;
  description: string;
  includedServiceIds: string[];
  includedServiceNames: string[];
  sessionCount: number;
  priceMinor: number;
  validityDays: number | null;
  isActive: boolean;
  isCombination: boolean;
  statusTitle: string;
  contentsLabel: string;
  validityLabel: string;
  soldCount: number;
  activeHolderCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PackagePlanWorkspaceSummary {
  total: number;
  active: number;
  inactive: number;
  combination: number;
}

export interface PackagePlanDraft {
  name: string;
  description: string;
  priceInput: string;
  validityMode: PackagePlanValidityMode;
  customValidityDays: string;
  includedServiceIds: string[];
  sessionCountInput: string;
  isActive: boolean;
}

export interface PackagePlanMutationInput {
  name: string;
  description?: string;
  includedServiceIds: string[];
  sessionCount: number;
  priceMinor: number;
  validityDays?: number | null;
  isActive: boolean;
}

export interface PackagePlanServiceOption {
  id: string;
  name: string;
}

export function canManagePackagePlans(role: StaffRole | undefined): boolean {
  return Boolean(role && PACKAGE_PLAN_MANAGE_ROLES.has(role));
}

export function isCombinationPlan(
  definition: Pick<PackageDefinition, "includedServices">,
): boolean {
  return definition.includedServices.length > 1;
}

export function planStatusTitle(isActive: boolean): string {
  return isActive ? "販售中" : "已停售";
}

export function planValidityLabel(validityDays: number | null | undefined): string {
  if (validityDays == null) return "無固定期限";
  if (!Number.isInteger(validityDays) || validityDays < 1) return "無固定期限";
  return `${validityDays} 天`;
}

export function planContentsLabel(input: {
  includedServiceNames: string[];
  sessionCount: number;
}): string {
  const names = input.includedServiceNames.filter((name) => name.trim().length > 0);
  if (names.length === 1) {
    return `${names[0]} × ${input.sessionCount}`;
  }
  if (names.length > 1) {
    return `${names.length} 項療程 · 共用 ${input.sessionCount} 堂`;
  }
  return `共用 ${input.sessionCount} 堂`;
}

export function emptyPackagePlanDraft(): PackagePlanDraft {
  return {
    name: "",
    description: "",
    priceInput: "",
    validityMode: "none",
    customValidityDays: "",
    includedServiceIds: [],
    sessionCountInput: "",
    isActive: true,
  };
}

export function draftFromPackageDefinition(
  definition: PackageDefinition,
): PackagePlanDraft {
  const validityDays = definition.validityDays;
  let validityMode: PackagePlanValidityMode = "none";
  let customValidityDays = "";
  if (validityDays === 180) validityMode = "180";
  else if (validityDays === 365) validityMode = "365";
  else if (validityDays != null && Number.isInteger(validityDays) && validityDays > 0) {
    validityMode = "custom";
    customValidityDays = String(validityDays);
  }
  return {
    name: definition.name,
    description: definition.description ?? "",
    priceInput: String(definition.priceMinor),
    validityMode,
    customValidityDays,
    includedServiceIds: definition.includedServices.map((row) => row.serviceId),
    sessionCountInput: String(definition.sessionCount),
    isActive: definition.isActive,
  };
}

export function togglePlanService(
  includedServiceIds: string[],
  serviceId: string,
): string[] {
  if (includedServiceIds.includes(serviceId)) {
    return includedServiceIds.filter((id) => id !== serviceId);
  }
  return [...includedServiceIds, serviceId];
}

export function addPlanService(
  includedServiceIds: string[],
  serviceId: string,
): string[] {
  if (!serviceId || includedServiceIds.includes(serviceId)) return includedServiceIds;
  return [...includedServiceIds, serviceId];
}

export function removePlanService(
  includedServiceIds: string[],
  serviceId: string,
): string[] {
  return includedServiceIds.filter((id) => id !== serviceId);
}

export function availablePlanServices(
  options: PackagePlanServiceOption[],
  includedServiceIds: string[],
): PackagePlanServiceOption[] {
  const taken = new Set(includedServiceIds);
  return options.filter((row) => !taken.has(row.id));
}

function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(value)) return null;
  return value;
}

export function parsePlanValidityDays(
  draft: Pick<PackagePlanDraft, "validityMode" | "customValidityDays">,
): { ok: true; value?: number | null } | { ok: false; error: string } {
  if (draft.validityMode === "none") return { ok: true, value: null };
  if (draft.validityMode === "180") return { ok: true, value: 180 };
  if (draft.validityMode === "365") return { ok: true, value: 365 };
  const days = parsePositiveInt(draft.customValidityDays);
  if (days == null || days < 1) {
    return { ok: false, error: "請輸入有效期限天數" };
  }
  return { ok: true, value: days };
}

export function parsePlanPrice(
  raw: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "請輸入售價" };
  const parsed = parseMoneyInput(trimmed);
  if (parsed == null) return { ok: false, error: "售價必須是整數金額" };
  if (parsed < 0) return { ok: false, error: "售價不能為負數" };
  return { ok: true, value: parsed };
}

export function parsePlanSessionCount(
  raw: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const value = parsePositiveInt(raw);
  if (value == null || value < 1) {
    return { ok: false, error: "堂數必須是大於等於 1 的整數" };
  }
  return { ok: true, value };
}

export function validatePackagePlanStep(
  step: PackagePlanStep,
  draft: PackagePlanDraft,
): string | null {
  if (step === 1) {
    if (!draft.name.trim()) return "請輸入套票名稱";
    const price = parsePlanPrice(draft.priceInput);
    if (!price.ok) return price.error;
    const validity = parsePlanValidityDays(draft);
    if (!validity.ok) return validity.error;
    return null;
  }
  if (step === 2) {
    if (draft.includedServiceIds.length === 0) {
      return "請至少加入一個療程";
    }
    const sessions = parsePlanSessionCount(draft.sessionCountInput);
    if (!sessions.ok) return sessions.error;
    return null;
  }
  return null;
}

export function parsePackagePlanDraft(
  draft: PackagePlanDraft,
): { ok: true; value: PackagePlanMutationInput } | { ok: false; error: string } {
  for (const step of [1, 2, 3] as const) {
    const error = validatePackagePlanStep(step, draft);
    if (error) return { ok: false, error };
  }
  const price = parsePlanPrice(draft.priceInput);
  const sessions = parsePlanSessionCount(draft.sessionCountInput);
  const validity = parsePlanValidityDays(draft);
  if (!price.ok) return price;
  if (!sessions.ok) return sessions;
  if (!validity.ok) return validity;
  const description = draft.description.trim();
  return {
    ok: true,
    value: {
      name: draft.name.trim(),
      description: description ? description : undefined,
      includedServiceIds: [...draft.includedServiceIds],
      sessionCount: sessions.value,
      priceMinor: price.value,
      validityDays: validity.value ?? null,
      isActive: draft.isActive,
    },
  };
}

export function buildPackagePlanRows(input: {
  organizationId: string;
  definitions: PackageDefinition[];
  packages: CustomerPackage[];
  ledger: PackageLedgerEntry[];
  serviceNames?: Record<string, string>;
  now: Date;
}): PackagePlanWorkspaceRow[] {
  const orgLedger = input.ledger.filter(
    (entry) => entry.organizationId === input.organizationId,
  );
  const holdings = input.packages.filter(
    (pkg) => pkg.organizationId === input.organizationId,
  );

  return input.definitions
    .filter((definition) => definition.organizationId === input.organizationId)
    .map((definition) => {
      const includedServiceIds = definition.includedServices.map((row) => row.serviceId);
      const includedServiceNames = includedServiceIds.map(
        (id) => input.serviceNames?.[id] ?? id,
      );
      const related = holdings.filter(
        (pkg) => pkg.packageDefinitionId === definition.id,
      );
      let soldCount = 0;
      const activeHolders = new Set<string>();
      for (const pkg of related) {
        const ledgerBalance = orgLedger
          .filter((entry) => entry.customerPackageId === pkg.id)
          .reduce((sum, entry) => sum + entry.sessionDelta, 0);
        const status = derivePackageWorkspaceStatus(pkg, ledgerBalance, input.now);
        if (status.kind !== "voided") soldCount += 1;
        if (status.kind === "active") activeHolders.add(pkg.customerId);
      }
      const validityDays = definition.validityDays ?? null;
      return {
        definitionId: definition.id,
        name: definition.name,
        description: definition.description ?? "",
        includedServiceIds,
        includedServiceNames,
        sessionCount: definition.sessionCount,
        priceMinor: definition.priceMinor,
        validityDays,
        isActive: definition.isActive,
        isCombination: isCombinationPlan(definition),
        statusTitle: planStatusTitle(definition.isActive),
        contentsLabel: planContentsLabel({
          includedServiceNames,
          sessionCount: definition.sessionCount,
        }),
        validityLabel: planValidityLabel(validityDays),
        soldCount,
        activeHolderCount: activeHolders.size,
        createdAt: definition.createdAt,
        updatedAt: definition.updatedAt,
      } satisfies PackagePlanWorkspaceRow;
    })
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

export function countPackagePlanSummary(
  rows: PackagePlanWorkspaceRow[],
): PackagePlanWorkspaceSummary {
  return {
    total: rows.length,
    active: rows.filter((row) => row.isActive).length,
    inactive: rows.filter((row) => !row.isActive).length,
    combination: rows.filter((row) => row.isCombination).length,
  };
}

export function matchesPackagePlanSearch(
  row: Pick<PackagePlanWorkspaceRow, "name">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.name.toLowerCase().includes(q);
}

export function filterPackagePlanRows(
  rows: PackagePlanWorkspaceRow[],
  filter: PackagePlanListFilter,
  query: string,
): PackagePlanWorkspaceRow[] {
  return rows.filter((row) => {
    if (filter === "active" && !row.isActive) return false;
    if (filter === "inactive" && row.isActive) return false;
    return matchesPackagePlanSearch(row, query);
  });
}

export function packagePlanEmptyCopy(input: {
  hasAny: boolean;
  filter: PackagePlanListFilter;
  query: string;
}): { title: string; body: string } {
  if (!input.hasAny) {
    return {
      title: "尚未建立套票方案",
      body: "建立第一個套票方案後，就可以直接販售給客戶。",
    };
  }
  if (input.query.trim()) {
    return {
      title: "找不到符合的套票方案",
      body: "試試調整搜尋或篩選條件。",
    };
  }
  if (input.filter === "inactive") {
    return {
      title: "目前沒有已停售的套票方案",
      body: "停售的方案會出現在這裡，已售出的客戶套票不受影響。",
    };
  }
  if (input.filter === "active") {
    return {
      title: "目前沒有販售中的套票方案",
      body: "重新上架既有方案，或新增一個可販售的套票方案。",
    };
  }
  return {
    title: "找不到符合的套票方案",
    body: "試試調整搜尋或篩選條件。",
  };
}

export function resolveSelectedPackagePlanRow(
  rows: PackagePlanWorkspaceRow[],
  selectedPlanId: string | null,
): PackagePlanWorkspaceRow | null {
  if (!selectedPlanId) return null;
  return rows.find((row) => row.definitionId === selectedPlanId) ?? null;
}

export function shouldResetPackagePlanSelection(input: {
  selectedPlanId: string | null;
  visibleRows: PackagePlanWorkspaceRow[];
}): boolean {
  if (!input.selectedPlanId) return false;
  return !input.visibleRows.some((row) => row.definitionId === input.selectedPlanId);
}

export function shouldRenderPackagePlanQuickView(
  selected: PackagePlanWorkspaceRow | null,
): boolean {
  return selected !== null;
}

export function isInlinePackagePlanQuickViewViewport(widthPx: number): boolean {
  return widthPx >= PACKAGE_PLANS_INLINE_MIN_PX;
}

export function isPackagePlanRowKeyboardActivation(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function activeDefinitionsForSale(
  definitions: PackageDefinition[],
): PackageDefinition[] {
  return definitions.filter((row) => row.isActive);
}
