/**
 * Service Catalog workspace — presentation helpers only.
 *
 * Canonical catalog is Service via data/mock-services + lib/services/store
 * (seed + overlay). This module does not persist and does not invent a
 * second Service store.
 *
 * Honest domain limits:
 * - Joins use serviceId only.
 * - isActive is the only availability flag. Bookable / sellable are derived.
 * - Package eligibility is not persisted; any canonical Service may be
 *   referenced by PackageDefinition.
 * - No location restriction. Services apply to the whole organization.
 * - No persisted analytics (sales / booking / package counts).
 */
import { getServicePriceMinor } from "@/lib/commerce/pricing";
import { parseMoneyInput } from "@/lib/commerce/money";
import { isServiceActive } from "@/lib/services/store";
import type { StaffRole } from "@/types/saas";
import type { Service } from "@/types";

export const SERVICE_CATALOG_PANEL_WIDTH_PX = 400;
export const SERVICE_CATALOG_INLINE_MIN_PX = 1200;
export const SERVICE_CATALOG_WORKSPACE_GAP_PX = 16;
export const SERVICE_CATALOG_HREF = "/staff/services";

export const SERVICE_CATALOG_HAS_DESCRIPTION = false;
export const SERVICE_CATALOG_HAS_LOCATION_RESTRICTION = false;
export const SERVICE_CATALOG_HAS_BOOKABLE_FLAG = false;
export const SERVICE_CATALOG_HAS_SELLABLE_FLAG = false;
export const SERVICE_CATALOG_HAS_PACKAGE_ELIGIBLE_FLAG = false;
export const SERVICE_CATALOG_HAS_PERSISTED_KPI = false;
export const SERVICE_CATALOG_HAS_SECOND_STORE = false;
export const SERVICE_CATALOG_USES_SHARED_SERVICE_ID = true;

export const SERVICE_CATALOG_MANAGE_ROLES: ReadonlySet<StaffRole> = new Set([
  "OWNER",
  "MANAGER",
]);

export type ServiceCatalogListFilter = "all" | "active" | "inactive";
export type ServiceCatalogStep = 1 | 2;

export const SERVICE_CATALOG_FILTER_OPTIONS: Array<{
  id: ServiceCatalogListFilter;
  label: string;
}> = [
  { id: "all", label: "全部狀態" },
  { id: "active", label: "販售中" },
  { id: "inactive", label: "已停售" },
];

export const SERVICE_CATALOG_STEPS: Array<{ id: ServiceCatalogStep; label: string }> = [
  { id: 1, label: "基本資料" },
  { id: 2, label: "服務設定" },
];

export interface ServiceCatalogWorkspaceRow {
  serviceId: string;
  name: string;
  category: string;
  durationMinutes: number;
  priceMinor: number;
  isActive: boolean;
  bookable: boolean;
  sellable: boolean;
  packageEligible: boolean;
  statusTitle: string;
  initials: string;
}

export interface ServiceCatalogWorkspaceSummary {
  total: number;
  active: number;
  packageEligible: number;
  inactive: number;
}

export interface ServiceCatalogDraft {
  name: string;
  category: string;
  durationInput: string;
  priceInput: string;
  isActive: boolean;
}

export interface ServiceCatalogMutationInput {
  name: string;
  category: string;
  durationMinutes: number;
  priceMinor: number;
  isActive: boolean;
}

export interface ServiceCatalogRelatedCounts {
  appointmentCount: number;
  packagePlanCount: number;
  salesCount: number;
}

export function canManageServices(role: StaffRole | undefined): boolean {
  return Boolean(role && SERVICE_CATALOG_MANAGE_ROLES.has(role));
}

export function serviceCatalogStatusTitle(isActive: boolean): string {
  return isActive ? "販售中" : "已停售";
}

export function serviceInitials(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "服";
}

export function emptyServiceCatalogDraft(): ServiceCatalogDraft {
  return {
    name: "",
    category: "",
    durationInput: "60",
    priceInput: "",
    isActive: true,
  };
}

export function draftFromService(service: Service): ServiceCatalogDraft {
  return {
    name: service.name,
    category: service.category ?? "",
    durationInput: String(service.durationMinutes),
    priceInput:
      typeof service.priceMinor === "number" ? String(service.priceMinor) : "",
    isActive: isServiceActive(service),
  };
}

export function parseDurationInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

export function parseServiceCatalogDraft(
  draft: ServiceCatalogDraft,
): { ok: true; value: ServiceCatalogMutationInput } | { ok: false; error: string } {
  const name = draft.name.trim();
  if (!name) return { ok: false, error: "請輸入服務名稱" };
  const durationMinutes = parseDurationInput(draft.durationInput);
  if (durationMinutes == null) return { ok: false, error: "時長須為大於 0 的整數分鐘" };
  const priceMinor = parseMoneyInput(draft.priceInput);
  if (priceMinor == null || priceMinor < 0) {
    return { ok: false, error: "售價須為非負整數（NT$）" };
  }
  return {
    ok: true,
    value: {
      name,
      category: draft.category.trim(),
      durationMinutes,
      priceMinor,
      isActive: draft.isActive,
    },
  };
}

export function validateServiceCatalogStep(
  step: ServiceCatalogStep,
  draft: ServiceCatalogDraft,
): string | null {
  if (step === 1) {
    const parsed = parseServiceCatalogDraft(draft);
    return parsed.ok ? null : parsed.error;
  }
  return null;
}

export function buildServiceCatalogRows(services: Service[]): ServiceCatalogWorkspaceRow[] {
  return services.map((service) => {
    const active = isServiceActive(service);
    return {
      serviceId: service.id,
      name: service.name,
      category: service.category?.trim() ?? "",
      durationMinutes: service.durationMinutes,
      priceMinor: getServicePriceMinor(service),
      isActive: active,
      bookable: active,
      sellable: active,
      packageEligible: true,
      statusTitle: serviceCatalogStatusTitle(active),
      initials: serviceInitials(service.name),
    };
  });
}

export function countServiceCatalogSummary(
  rows: ServiceCatalogWorkspaceRow[],
): ServiceCatalogWorkspaceSummary {
  const active = rows.filter((row) => row.isActive);
  return {
    total: rows.length,
    active: active.length,
    packageEligible: rows.length,
    inactive: rows.length - active.length,
  };
}

export function listServiceCatalogCategories(rows: ServiceCatalogWorkspaceRow[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const row of rows) {
    if (!row.category || seen.has(row.category)) continue;
    seen.add(row.category);
    list.push(row.category);
  }
  return list.sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

export function filterServiceCatalogRows(
  rows: ServiceCatalogWorkspaceRow[],
  input: { status: ServiceCatalogListFilter; category: string; query: string },
): ServiceCatalogWorkspaceRow[] {
  const query = input.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (input.status === "active" && !row.isActive) return false;
    if (input.status === "inactive" && row.isActive) return false;
    if (input.category && row.category !== input.category) return false;
    if (query && !row.name.toLowerCase().includes(query)) return false;
    return true;
  });
}

export function resolveSelectedServiceRow(
  rows: ServiceCatalogWorkspaceRow[],
  selectedServiceId: string | null,
): ServiceCatalogWorkspaceRow | null {
  if (!selectedServiceId) return null;
  return rows.find((row) => row.serviceId === selectedServiceId) ?? null;
}

export function shouldResetServiceCatalogSelection(input: {
  selectedServiceId: string | null;
  visibleRows: ServiceCatalogWorkspaceRow[];
}): boolean {
  if (!input.selectedServiceId) return false;
  return !input.visibleRows.some((row) => row.serviceId === input.selectedServiceId);
}

export function shouldRenderServiceQuickView(
  selected: ServiceCatalogWorkspaceRow | null,
): boolean {
  return selected !== null;
}

export function isInlineServiceQuickViewViewport(widthPx: number): boolean {
  return widthPx >= SERVICE_CATALOG_INLINE_MIN_PX;
}

export function isServiceRowKeyboardActivation(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function serviceCatalogEmptyCopy(input: {
  hasAny: boolean;
  filter: ServiceCatalogListFilter;
  category: string;
  query: string;
}): { title: string; body: string } {
  if (!input.hasAny) {
    return {
      title: "尚未建立服務項目",
      body: "建立服務後，即可用於預約、療程、結帳與套票方案。",
    };
  }
  if (input.query.trim() || input.category || input.filter !== "all") {
    return {
      title: "找不到符合的服務",
      body: "試試調整搜尋、分類或狀態篩選。",
    };
  }
  return {
    title: "尚未建立服務項目",
    body: "建立服務後，即可用於預約、療程、結帳與套票方案。",
  };
}

export function selectableServicesForBooking(
  services: Service[],
  selectedServiceId?: string,
): Service[] {
  return services.filter(
    (service) => isServiceActive(service) || service.id === selectedServiceId,
  );
}

export function countRelatedPackagePlans(
  includedServiceIdLists: Array<readonly string[]>,
  serviceId: string,
): number {
  return includedServiceIdLists.filter((ids) => ids.includes(serviceId)).length;
}

export function countRelatedAppointments(
  appointmentServiceIds: readonly string[],
  serviceId: string,
): number {
  return appointmentServiceIds.filter((id) => id === serviceId).length;
}

export function countRelatedServiceSales(
  lineReferenceIds: readonly string[],
  serviceId: string,
): number {
  return lineReferenceIds.filter((id) => id === serviceId).length;
}
