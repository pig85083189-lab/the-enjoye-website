/**
 * Packages Operations Workspace — presentation helpers only.
 * Remaining sessions truth remains SUM(ledger sessionDelta) via lib/packages/store.
 * Does not persist a second remaining field, status enum, or Customer.packages residue.
 */
import { membershipBadge } from "@/lib/customers/crm-derived";
import {
  PACKAGE_LEDGER_TYPE_LABEL,
  type CustomerPackage,
  type CustomerPackageStatus,
  type PackageDefinition,
  type PackageLedgerEntry,
} from "@/lib/packages/domain";
import type { Customer } from "@/types";

export const PACKAGE_PANEL_WIDTH_PX = 400;
export const PACKAGE_INLINE_MIN_PX = 1200;
export const PACKAGE_WORKSPACE_GAP_PX = 16;

/** Domain flags — UI must not invent missing accounting dimensions. */
export const PACKAGES_HAS_EXPIRATION = true;
export const PACKAGES_HAS_ADJUSTMENT = true;
export const PACKAGES_HAS_VOID = true;
export const PACKAGES_USES_CUSTOMER_RESIDUE_REMAINING = false;

export type PackageListFilter = "all" | "active" | "exhausted" | "expired";
export type PackageListSort = "recent" | "remaining_desc" | "purchased_desc";
export type PackageRowStatusKind = "active" | "exhausted" | "expired" | "voided";

export const PACKAGE_FILTER_OPTIONS: Array<{
  id: PackageListFilter;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "active", label: "使用中" },
  { id: "exhausted", label: "已用完" },
  { id: "expired", label: "已到期" },
];

export const PACKAGE_SORT_OPTIONS: Array<{
  id: PackageListSort;
  label: string;
}> = [
  { id: "recent", label: "最近使用" },
  { id: "remaining_desc", label: "剩餘堂數" },
  { id: "purchased_desc", label: "購買時間" },
];

export const PACKAGE_ADJUSTMENT_REASONS = [
  { id: "manual", label: "人工修正" },
  { id: "compensation", label: "堂數補償" },
  { id: "other", label: "其他" },
] as const;

export interface PackageWorkspaceStatusView {
  kind: PackageRowStatusKind;
  title: string;
  domainStatus: CustomerPackageStatus;
}

export interface PackageWorkspaceRow {
  customerPackageId: string;
  customerId: string;
  packageDefinitionId: string;
  customerName: string;
  customerPhone: string;
  customerInitials: string;
  membership: { id: "vip" | "new"; label: string } | null;
  packageName: string;
  includedServiceIds: string[];
  includedServiceNames: string[];
  totalSessions: number;
  usedSessions: number;
  remainingSessions: number;
  ledgerBalance: number;
  purchasedAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastActivityAt: string | null;
  status: PackageWorkspaceStatusView;
}

export interface PackageWorkspaceSummary {
  holderCustomers: number;
  activePackages: number;
  remainingSessions: number;
  monthUsageSessions: number;
}

export interface PackageLedgerView {
  id: string;
  createdAt: string;
  type: PackageLedgerEntry["type"];
  typeLabel: string;
  sessionDelta: number;
  runningBalance: number;
  serviceId?: string;
  serviceName?: string;
  appointmentId?: string;
  transactionId?: string;
  locationId?: string;
  reason?: string;
  staffId: string;
  staffName: string;
  reversesEntryId?: string;
}

export const PACKAGE_DISPLAY_TIMEZONE = "Asia/Taipei";

export function isInLocalMonth(iso: string, now: Date): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACKAGE_DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  });
  return fmt.format(date) === fmt.format(now);
}

export function formatPackageTimestamp(iso: string | null): {
  dateLabel: string;
  timeLabel: string;
} {
  if (!iso) return { dateLabel: "", timeLabel: "" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { dateLabel: "", timeLabel: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACKAGE_DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    dateLabel: `${get("year")}/${get("month")}/${get("day")}`,
    timeLabel: `${get("hour")}:${get("minute")}`,
  };
}

export function packageLedgerBalance(
  ledger: PackageLedgerEntry[],
  customerPackageId: string,
): number {
  return ledger
    .filter((entry) => entry.customerPackageId === customerPackageId)
    .reduce((sum, entry) => sum + entry.sessionDelta, 0);
}

export function usedSessionsFromSnapshot(
  totalSessions: number,
  ledgerBalance: number,
): number {
  if (!Number.isInteger(totalSessions) || totalSessions < 0) return 0;
  const remaining = Number.isInteger(ledgerBalance) ? ledgerBalance : 0;
  return Math.max(0, totalSessions - Math.max(0, remaining));
}

export function derivePackageWorkspaceStatus(
  pkg: CustomerPackage,
  ledgerBalance: number,
  now: Date,
): PackageWorkspaceStatusView {
  if (pkg.status === "VOIDED") {
    return { kind: "voided", title: "已作廢", domainStatus: "VOIDED" };
  }
  if (pkg.expiresAt) {
    const expires = new Date(pkg.expiresAt);
    if (!Number.isNaN(expires.getTime()) && expires.getTime() < now.getTime()) {
      return { kind: "expired", title: "已到期", domainStatus: "EXPIRED" };
    }
  }
  if (ledgerBalance <= 0) {
    return { kind: "exhausted", title: "已用完", domainStatus: "EXHAUSTED" };
  }
  return { kind: "active", title: "使用中", domainStatus: "ACTIVE" };
}

export function usableSessionsFromStatus(
  status: PackageWorkspaceStatusView,
  ledgerBalance: number,
): number {
  if (status.kind !== "active") return 0;
  return ledgerBalance > 0 ? ledgerBalance : 0;
}

export function packageProgressLabel(used: number, total: number): string {
  return `已使用 ${used} / ${total} 堂`;
}

export function packageRemainingLabel(remaining: number): string {
  return `剩餘 ${remaining} 堂`;
}

export function packageProgressDots(
  used: number,
  total: number,
  maxDots = 12,
): { filled: number; empty: number; truncated: boolean } {
  const safeTotal = Number.isInteger(total) && total > 0 ? total : 0;
  const safeUsed = Math.min(Math.max(0, used), safeTotal);
  if (safeTotal === 0) return { filled: 0, empty: 0, truncated: false };
  if (safeTotal <= maxDots) {
    return { filled: safeUsed, empty: safeTotal - safeUsed, truncated: false };
  }
  const filled = Math.round((safeUsed / safeTotal) * maxDots);
  return { filled, empty: maxDots - filled, truncated: true };
}

export function buildPackageWorkspaceRows(input: {
  organizationId: string;
  packages: CustomerPackage[];
  ledger: PackageLedgerEntry[];
  customers: Customer[];
  serviceNames?: Record<string, string>;
  now: Date;
}): PackageWorkspaceRow[] {
  const customersById = new Map(
    input.customers
      .filter((customer) => customer.organizationId === input.organizationId)
      .map((customer) => [customer.id, customer]),
  );
  const orgLedger = input.ledger.filter(
    (entry) => entry.organizationId === input.organizationId,
  );

  return input.packages
    .filter((pkg) => pkg.organizationId === input.organizationId)
    .flatMap((pkg) => {
      const customer = customersById.get(pkg.customerId);
      if (!customer) return [];
      const pkgLedger = orgLedger.filter(
        (entry) => entry.customerPackageId === pkg.id,
      );
      const ledgerBalance = pkgLedger.reduce(
        (sum, entry) => sum + entry.sessionDelta,
        0,
      );
      const status = derivePackageWorkspaceStatus(pkg, ledgerBalance, input.now);
      const remainingSessions = usableSessionsFromStatus(status, ledgerBalance);
      const lastUsedAt =
        pkgLedger
          .filter((entry) => entry.type === "REDEMPTION")
          .reduce<string | null>((latest, entry) => {
            if (!latest || entry.createdAt > latest) return entry.createdAt;
            return latest;
          }, null);
      const lastActivityAt =
        pkgLedger.reduce<string | null>((latest, entry) => {
          if (!latest || entry.createdAt > latest) return entry.createdAt;
          return latest;
        }, null) ?? pkg.purchasedAt;

      return [
        {
          customerPackageId: pkg.id,
          customerId: customer.id,
          packageDefinitionId: pkg.packageDefinitionId,
          customerName: customer.name,
          customerPhone: customer.phone,
          customerInitials: customer.name.slice(0, 1),
          membership: membershipBadge(customer),
          packageName: pkg.nameSnapshot,
          includedServiceIds: pkg.includedServiceIdsSnapshot,
          includedServiceNames: pkg.includedServiceIdsSnapshot.map(
            (id) => input.serviceNames?.[id] ?? id,
          ),
          totalSessions: pkg.sessionCountSnapshot,
          usedSessions: usedSessionsFromSnapshot(
            pkg.sessionCountSnapshot,
            ledgerBalance,
          ),
          remainingSessions,
          ledgerBalance,
          purchasedAt: pkg.purchasedAt,
          expiresAt: pkg.expiresAt ?? null,
          lastUsedAt,
          lastActivityAt,
          status,
        } satisfies PackageWorkspaceRow,
      ];
    });
}

export function countPackageSummary(
  rows: PackageWorkspaceRow[],
  ledger: PackageLedgerEntry[],
  now: Date,
  organizationId?: string,
): PackageWorkspaceSummary {
  const scoped = organizationId
    ? ledger.filter((entry) => entry.organizationId === organizationId)
    : ledger;
  const holders = new Set(
    rows
      .filter((row) => row.status.kind !== "voided")
      .map((row) => row.customerId),
  );
  return {
    holderCustomers: holders.size,
    activePackages: rows.filter((row) => row.status.kind === "active").length,
    remainingSessions: rows
      .filter((row) => row.status.kind === "active")
      .reduce((sum, row) => sum + row.remainingSessions, 0),
    monthUsageSessions: scoped
      .filter(
        (entry) =>
          entry.type === "REDEMPTION" && isInLocalMonth(entry.createdAt, now),
      )
      .reduce((sum, entry) => sum + Math.abs(entry.sessionDelta), 0),
  };
}

export function matchesPackageSearch(
  row: Pick<
    PackageWorkspaceRow,
    "customerName" | "customerPhone" | "packageName"
  >,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.customerName.toLowerCase().includes(q) ||
    row.customerPhone.toLowerCase().includes(q) ||
    row.packageName.toLowerCase().includes(q)
  );
}

export function filterPackageRows(
  rows: PackageWorkspaceRow[],
  filter: PackageListFilter,
  query: string,
): PackageWorkspaceRow[] {
  return rows.filter((row) => {
    if (filter === "active" && row.status.kind !== "active") return false;
    if (filter === "exhausted" && row.status.kind !== "exhausted") return false;
    if (filter === "expired" && row.status.kind !== "expired") return false;
    return matchesPackageSearch(row, query);
  });
}

export function sortPackageRows(
  rows: PackageWorkspaceRow[],
  sort: PackageListSort,
): PackageWorkspaceRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (sort === "remaining_desc") {
      if (b.remainingSessions !== a.remainingSessions) {
        return b.remainingSessions - a.remainingSessions;
      }
    } else if (sort === "purchased_desc") {
      if (a.purchasedAt !== b.purchasedAt) {
        return b.purchasedAt.localeCompare(a.purchasedAt);
      }
    } else {
      const aAt = a.lastUsedAt ?? a.lastActivityAt ?? "";
      const bAt = b.lastUsedAt ?? b.lastActivityAt ?? "";
      if (aAt !== bAt) return bAt.localeCompare(aAt);
    }
    return a.customerName.localeCompare(b.customerName, "zh-Hant");
  });
  return copy;
}

export function ledgerWithRunningSessions(
  entries: PackageLedgerEntry[],
): PackageLedgerView[] {
  const chronological = [...entries].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  let running = 0;
  return chronological.map((entry) => {
    running += entry.sessionDelta;
    return {
      id: entry.id,
      createdAt: entry.createdAt,
      type: entry.type,
      typeLabel: PACKAGE_LEDGER_TYPE_LABEL[entry.type],
      sessionDelta: entry.sessionDelta,
      runningBalance: running,
      serviceId: entry.serviceId,
      appointmentId: entry.appointmentId,
      transactionId: entry.transactionId,
      locationId: entry.locationId,
      reason: entry.reason,
      staffId: entry.createdByStaffId,
      staffName: "",
      reversesEntryId: entry.reversesEntryId,
    };
  });
}

export function mapPackageLedgerViews(
  entries: PackageLedgerEntry[],
  names: { staff?: Record<string, string>; services?: Record<string, string> } = {},
): PackageLedgerView[] {
  return ledgerWithRunningSessions(entries).map((entry) => ({
    ...entry,
    staffName: names.staff?.[entry.staffId] ?? "",
    serviceName: entry.serviceId
      ? names.services?.[entry.serviceId] ?? entry.serviceId
      : undefined,
  }));
}

export function recentPackageLedgerViews(
  views: PackageLedgerView[],
  limit = 5,
): PackageLedgerView[] {
  return [...views].reverse().slice(0, limit);
}

export function resolveSelectedPackageRow(
  rows: PackageWorkspaceRow[],
  selectedPackageId: string | null,
): PackageWorkspaceRow | null {
  if (!selectedPackageId) return null;
  return rows.find((row) => row.customerPackageId === selectedPackageId) ?? null;
}

export function shouldResetPackageSelection(input: {
  selectedPackageId: string | null;
  visibleRows: PackageWorkspaceRow[];
}): boolean {
  if (!input.selectedPackageId) return false;
  return !input.visibleRows.some(
    (row) => row.customerPackageId === input.selectedPackageId,
  );
}

export function shouldRenderPackageQuickView(
  selected: PackageWorkspaceRow | null,
): boolean {
  return selected !== null;
}

export function isInlinePackageQuickViewViewport(widthPx: number): boolean {
  return widthPx >= PACKAGE_INLINE_MIN_PX;
}

export function packageListPresentation(
  widthPx: number,
): "desktop-rows" | "mobile-cards" {
  return isInlinePackageQuickViewViewport(widthPx)
    ? "desktop-rows"
    : "mobile-cards";
}

export function isPackageRowKeyboardActivation(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function canScheduleFromPackage(row: PackageWorkspaceRow): boolean {
  return row.status.kind === "active" && row.remainingSessions > 0;
}

export function packageScheduleHref(row: PackageWorkspaceRow): string {
  const params = new URLSearchParams({
    create: "1",
    customer: row.customerId,
  });
  const serviceId = row.includedServiceIds[0];
  if (serviceId) params.set("service", serviceId);
  return `/staff/calendar?${params.toString()}`;
}

export function filterCustomersForPackagePicker(
  customers: Customer[],
  query: string,
): Customer[] {
  const q = query.trim().toLowerCase();
  if (!q) return customers;
  return customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(q) ||
      customer.phone.toLowerCase().includes(q),
  );
}

export function filterDefinitionsForPackagePicker(
  definitions: PackageDefinition[],
  query: string,
): PackageDefinition[] {
  const active = definitions.filter((row) => row.isActive);
  const q = query.trim().toLowerCase();
  if (!q) return active;
  return active.filter((row) => row.name.toLowerCase().includes(q));
}

export function canStartPackageSale(input: {
  customerId: string | null;
  definitionId: string | null;
}): boolean {
  return Boolean(input.customerId && input.definitionId);
}

export function visitCountLabel(totalVisits: number): string | null {
  if (!Number.isInteger(totalVisits) || totalVisits <= 0) return null;
  return `第 ${totalVisits} 次來店`;
}
