/**
 * Stored Value Operations Workspace — presentation helpers only.
 * Balance truth remains SUM(ledger amountDelta) in lib/stored-value/store.
 * Does not persist a second account, ledger, status, or customer.balance.
 */
import { membershipBadge } from "@/lib/customers/crm-derived";
import {
  STORED_VALUE_LEDGER_TYPE_LABEL,
  type StoredValueAccount,
  type StoredValueLedgerEntry,
  type StoredValueLedgerType,
} from "@/lib/stored-value/domain";
import type { Customer } from "@/types";

export const STORED_VALUE_PANEL_WIDTH_PX = 400;
export const STORED_VALUE_INLINE_MIN_PX = 1200;
export const STORED_VALUE_WORKSPACE_GAP_PX = 16;

/** Domain flags — UI must not invent missing accounting dimensions. */
export const STORED_VALUE_HAS_PRINCIPAL_BONUS_SPLIT = false;
export const STORED_VALUE_HAS_EXPIRATION = false;
export const STORED_VALUE_HAS_REFUND_TYPE = false;
export const STORED_VALUE_HAS_ADJUSTMENT = true;

export type StoredValueListFilter = "all" | "positive" | "zero";
export type StoredValueListSort = "recent" | "balance_desc" | "balance_asc";
export type StoredValueRowStatusKind = "positive" | "zero";

export const STORED_VALUE_FILTER_OPTIONS: Array<{
  id: StoredValueListFilter;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "positive", label: "有餘額" },
  { id: "zero", label: "餘額為 0" },
];

export const STORED_VALUE_SORT_OPTIONS: Array<{
  id: StoredValueListSort;
  label: string;
}> = [
  { id: "recent", label: "最近異動" },
  { id: "balance_desc", label: "餘額最高" },
  { id: "balance_asc", label: "餘額最低" },
];

export const STORED_VALUE_ADJUSTMENT_REASONS = [
  { id: "manual", label: "人工修正" },
  { id: "refund", label: "退款" },
  { id: "promo", label: "活動補償" },
  { id: "other", label: "其他" },
] as const;

export interface StoredValueWorkspaceStatusView {
  kind: StoredValueRowStatusKind;
  title: string;
}

export interface StoredValueWorkspaceRow {
  customerId: string;
  accountId: string;
  customerName: string;
  customerPhone: string;
  customerInitials: string;
  membership: { id: "vip" | "new"; label: string } | null;
  totalVisits: number;
  balanceMinor: number;
  lifetimeTopUpMinor: number;
  lastActivityAt: string | null;
  status: StoredValueWorkspaceStatusView;
}

export interface StoredValueWorkspaceSummary {
  holders: number;
  availableMinor: number;
  monthTopUpMinor: number;
  monthUsageMinor: number;
}

export interface StoredValueLedgerView {
  id: string;
  createdAt: string;
  type: StoredValueLedgerType;
  typeLabel: string;
  amountDelta: number;
  runningBalanceMinor: number;
  transactionId?: string;
  appointmentId?: string;
  locationId?: string;
  reason?: string;
  staffId: string;
  staffName: string;
  reversesEntryId?: string;
}

export interface StoredValueTopUpPreview {
  currentBalanceMinor: number;
  amountMinor: number;
  afterBalanceMinor: number;
}

export function storedValueBalanceFromLedger(
  ledger: StoredValueLedgerEntry[],
  accountId: string,
): number {
  return ledger
    .filter((entry) => entry.accountId === accountId)
    .reduce((sum, entry) => sum + entry.amountDelta, 0);
}

export function deriveStoredValueRowStatus(
  balanceMinor: number,
): StoredValueWorkspaceStatusView {
  if (balanceMinor > 0) return { kind: "positive", title: "有餘額" };
  return { kind: "zero", title: "餘額為 0" };
}

export const STORED_VALUE_DISPLAY_TIMEZONE = "Asia/Taipei";

export function isInLocalMonth(iso: string, now: Date): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORED_VALUE_DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  });
  return fmt.format(date) === fmt.format(now);
}

export function formatStoredValueTimestamp(iso: string | null): {
  dateLabel: string;
  timeLabel: string;
} {
  if (!iso) return { dateLabel: "", timeLabel: "" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { dateLabel: "", timeLabel: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORED_VALUE_DISPLAY_TIMEZONE,
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

export function buildStoredValueWorkspaceRows(input: {
  organizationId: string;
  accounts: StoredValueAccount[];
  ledger: StoredValueLedgerEntry[];
  customers: Customer[];
}): StoredValueWorkspaceRow[] {
  const customersById = new Map(
    input.customers
      .filter((customer) => customer.organizationId === input.organizationId)
      .map((customer) => [customer.id, customer]),
  );
  const orgLedger = input.ledger.filter(
    (entry) => entry.organizationId === input.organizationId,
  );

  return input.accounts
    .filter(
      (account) =>
        account.organizationId === input.organizationId &&
        account.status === "ACTIVE",
    )
    .flatMap((account) => {
      const customer = customersById.get(account.customerId);
      if (!customer) return [];
      const accountLedger = orgLedger.filter(
        (entry) => entry.accountId === account.id,
      );
      const balanceMinor = accountLedger.reduce(
        (sum, entry) => sum + entry.amountDelta,
        0,
      );
      const lifetimeTopUpMinor = accountLedger
        .filter((entry) => entry.type === "TOP_UP")
        .reduce((sum, entry) => sum + entry.amountDelta, 0);
      const lastActivityAt =
        accountLedger.reduce<string | null>((latest, entry) => {
          if (!latest || entry.createdAt > latest) return entry.createdAt;
          return latest;
        }, null) ?? account.createdAt;

      return [
        {
          customerId: customer.id,
          accountId: account.id,
          customerName: customer.name,
          customerPhone: customer.phone,
          customerInitials: customer.name.slice(0, 1),
          membership: membershipBadge(customer),
          totalVisits: customer.totalVisits,
          balanceMinor,
          lifetimeTopUpMinor,
          lastActivityAt,
          status: deriveStoredValueRowStatus(balanceMinor),
        } satisfies StoredValueWorkspaceRow,
      ];
    });
}

export function countStoredValueSummary(
  rows: StoredValueWorkspaceRow[],
  ledger: StoredValueLedgerEntry[],
  now: Date,
  organizationId?: string,
): StoredValueWorkspaceSummary {
  const scoped = organizationId
    ? ledger.filter((entry) => entry.organizationId === organizationId)
    : ledger;
  return {
    holders: rows.filter((row) => row.balanceMinor > 0).length,
    availableMinor: rows.reduce((sum, row) => sum + row.balanceMinor, 0),
    monthTopUpMinor: scoped
      .filter((entry) => entry.type === "TOP_UP" && isInLocalMonth(entry.createdAt, now))
      .reduce((sum, entry) => sum + entry.amountDelta, 0),
    monthUsageMinor: scoped
      .filter((entry) => entry.type === "PAYMENT" && isInLocalMonth(entry.createdAt, now))
      .reduce((sum, entry) => sum + Math.abs(entry.amountDelta), 0),
  };
}

export function matchesStoredValueSearch(
  row: Pick<StoredValueWorkspaceRow, "customerName" | "customerPhone">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.customerName.toLowerCase().includes(q) ||
    row.customerPhone.toLowerCase().includes(q)
  );
}

export function filterStoredValueRows(
  rows: StoredValueWorkspaceRow[],
  filter: StoredValueListFilter,
  query: string,
): StoredValueWorkspaceRow[] {
  return rows.filter((row) => {
    if (filter === "positive" && row.balanceMinor <= 0) return false;
    if (filter === "zero" && row.balanceMinor !== 0) return false;
    return matchesStoredValueSearch(row, query);
  });
}

export function sortStoredValueRows(
  rows: StoredValueWorkspaceRow[],
  sort: StoredValueListSort,
): StoredValueWorkspaceRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (sort === "balance_desc") {
      if (b.balanceMinor !== a.balanceMinor) return b.balanceMinor - a.balanceMinor;
    } else if (sort === "balance_asc") {
      if (a.balanceMinor !== b.balanceMinor) return a.balanceMinor - b.balanceMinor;
    } else {
      const aAt = a.lastActivityAt ?? "";
      const bAt = b.lastActivityAt ?? "";
      if (aAt !== bAt) return bAt.localeCompare(aAt);
    }
    return a.customerName.localeCompare(b.customerName, "zh-Hant");
  });
  return copy;
}

export function ledgerWithRunningBalance(
  entries: StoredValueLedgerEntry[],
): StoredValueLedgerView[] {
  const chronological = [...entries].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  let running = 0;
  return chronological.map((entry) => {
    running += entry.amountDelta;
    return {
      id: entry.id,
      createdAt: entry.createdAt,
      type: entry.type,
      typeLabel: STORED_VALUE_LEDGER_TYPE_LABEL[entry.type],
      amountDelta: entry.amountDelta,
      runningBalanceMinor: running,
      transactionId: entry.transactionId,
      appointmentId: entry.appointmentId,
      locationId: entry.locationId,
      reason: entry.reason,
      staffId: entry.createdByStaffId,
      staffName: "",
      reversesEntryId: entry.reversesEntryId,
    };
  });
}

export function mapStoredValueLedgerViews(
  entries: StoredValueLedgerEntry[],
  staffNames: Record<string, string> = {},
): StoredValueLedgerView[] {
  return ledgerWithRunningBalance(entries).map((entry) => ({
    ...entry,
    staffName: staffNames[entry.staffId] ?? "",
  }));
}

export function recentLedgerViews(
  views: StoredValueLedgerView[],
  limit = 5,
): StoredValueLedgerView[] {
  return [...views].reverse().slice(0, limit);
}

export function previewStoredValueTopUp(input: {
  currentBalanceMinor: number;
  amountMinor: number;
}): StoredValueTopUpPreview {
  const currentBalanceMinor = Number.isInteger(input.currentBalanceMinor)
    ? input.currentBalanceMinor
    : 0;
  const amountMinor = Number.isInteger(input.amountMinor) ? input.amountMinor : 0;
  return {
    currentBalanceMinor,
    amountMinor,
    afterBalanceMinor: currentBalanceMinor + amountMinor,
  };
}

export function canConfirmStoredValueTopUp(input: {
  customerId: string | null;
  amountMinor: number | null;
}): boolean {
  return Boolean(
    input.customerId &&
      input.amountMinor != null &&
      Number.isInteger(input.amountMinor) &&
      input.amountMinor > 0,
  );
}

export function resolveSelectedStoredValueRow(
  rows: StoredValueWorkspaceRow[],
  selectedCustomerId: string | null,
): StoredValueWorkspaceRow | null {
  if (!selectedCustomerId) return null;
  return rows.find((row) => row.customerId === selectedCustomerId) ?? null;
}

export function shouldResetStoredValueSelection(input: {
  selectedCustomerId: string | null;
  visibleRows: StoredValueWorkspaceRow[];
}): boolean {
  if (!input.selectedCustomerId) return false;
  return !input.visibleRows.some((row) => row.customerId === input.selectedCustomerId);
}

export function shouldRenderStoredValueQuickView(
  selected: StoredValueWorkspaceRow | null,
): boolean {
  return selected !== null;
}

export function isInlineStoredValueQuickViewViewport(widthPx: number): boolean {
  return widthPx >= STORED_VALUE_INLINE_MIN_PX;
}

export function storedValueListPresentation(
  widthPx: number,
): "desktop-rows" | "mobile-cards" {
  return isInlineStoredValueQuickViewViewport(widthPx)
    ? "desktop-rows"
    : "mobile-cards";
}

export function isStoredValueRowKeyboardActivation(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function filterCustomersForStoredValuePicker(
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

export function visitCountLabel(totalVisits: number): string | null {
  if (!Number.isInteger(totalVisits) || totalVisits <= 0) return null;
  return `第 ${totalVisits} 次來店`;
}
