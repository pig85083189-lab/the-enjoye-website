/**
 * Customer 360 presentation model — derived view only.
 * Does not persist remaining, balance, or spend. Reads existing domain snapshots.
 */
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import { formatTwd } from "@/lib/commerce/money";
import {
  formatHmLabel,
  formatSlashDate,
  parseCustomerDate,
} from "@/lib/customers/crm-derived";
import {
  PACKAGE_LEDGER_TYPE_LABEL,
  type CustomerPackage,
  type PackageLedgerEntry,
} from "@/lib/packages/domain";
import type { FollowUpTask } from "@/lib/follow-ups/domain";
import {
  STORED_VALUE_LEDGER_TYPE_LABEL,
  type StoredValueLedgerEntry,
} from "@/lib/stored-value/domain";
import type { Transaction } from "@/lib/commerce/domain";
import type { Customer, Service } from "@/types";
import type { CustomerConsultation } from "@/types/customer";
import type { TreatmentDraft } from "@/types/treatment";

export const CUSTOMER_360_TIMELINE_PREVIEW = 5;
export const CUSTOMER_360_FREQUENT_LIMIT = 3;
export const CUSTOMER_360_TX_LIMIT = 3;
export const CUSTOMER_360_PACKAGE_PREVIEW = 2;
export const CUSTOMER_360_SUMMARY_WIDTH_PX = 320;

export const CUSTOMER_360_TAB_IDS = [
  "overview",
  "treatments",
  "consultation",
  "follow-ups",
  "appointments",
  "photos",
  "wallet",
  "transactions",
  "notes",
] as const;

export type Customer360TabId = (typeof CUSTOMER_360_TAB_IDS)[number];

export const CUSTOMER_360_PRIMARY_TABS: Array<{
  id: Exclude<Customer360TabId, "wallet" | "transactions" | "notes">;
  label: string;
}> = [
  { id: "overview", label: "總覽" },
  { id: "treatments", label: "療程" },
  { id: "consultation", label: "諮詢" },
  { id: "follow-ups", label: "追蹤" },
  { id: "appointments", label: "預約" },
  { id: "photos", label: "照片" },
];

export const CUSTOMER_360_FINANCIAL_ITEMS: Array<{
  id: Extract<Customer360TabId, "wallet" | "transactions">;
  section?: "packages" | "stored-value";
  label: string;
}> = [
  { id: "wallet", section: "packages", label: "套票" },
  { id: "wallet", section: "stored-value", label: "儲值" },
  { id: "transactions", label: "交易" },
];

export type Customer360WalletSection = "packages" | "stored-value";

export function isCustomer360TabId(value: string | null): value is Customer360TabId {
  return CUSTOMER_360_TAB_IDS.some((id) => id === value);
}

export function isFinancialTab(tab: Customer360TabId): boolean {
  return tab === "wallet" || tab === "transactions";
}

/** Profile workbench only — excludes /new, /edit, consultation nested routes. */
export function isCustomerProfileWorkbenchPath(pathname: string): boolean {
  return /^\/staff\/customers\/(?!new$)[^/]+$/.test(pathname);
}

/** Remote rows win when the pilot handed an array (including empty). Null keeps local. */
export function resolveCustomer360Appointments(
  remoteAppointments: ScheduleAppointment[] | null | undefined,
  localAppointments: ScheduleAppointment[],
): ScheduleAppointment[] {
  return remoteAppointments != null ? remoteAppointments : localAppointments;
}

export function customerCreateAppointmentHref(customerId: string): string {
  return `/staff/calendar?create=1&customer=${customerId}`;
}

export function customerEditHref(customerId: string): string {
  return `/staff/customers/${customerId}/edit`;
}

export function customerConsultationNewHref(customerId: string): string {
  return `/staff/customers/${customerId}/consultation/new`;
}

export function customerWalletHref(
  customerId: string,
  section?: Customer360WalletSection,
): string {
  const base = `/staff/customers/${customerId}?tab=wallet`;
  return section ? `${base}&section=${section}` : base;
}

export function customerTransactionsHref(customerId: string): string {
  return `/staff/customers/${customerId}?tab=transactions`;
}

export const PACKAGE_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "使用中",
  EXHAUSTED: "已用完",
  EXPIRED: "已到期",
  VOIDED: "已作廢",
};

export type Customer360ServiceFocus = {
  conditionNotes: string[];
  lastBeauticianNote: string | null;
  suggestions: string[];
};

export type FrequentServiceView = {
  serviceId: string;
  serviceName: string;
  usageCount: number;
  lastUsedAt: string;
  lastUsedLabel: string;
  durationMinutes: number | null;
  priceMinor: number | null;
};

export type TimelineItemType =
  | "treatment_completed"
  | "appointment_completed"
  | "follow_up"
  | "consultation"
  | "transaction"
  | "package"
  | "stored_value";

export type TimelineItemView = {
  id: string;
  at: string;
  dateLabel: string;
  timeLabel: string | null;
  type: TimelineItemType;
  typeLabel: string;
  title: string;
  summary: string | null;
  staffName: string | null;
  href: string | null;
  ctaLabel: string | null;
};

export type PackageFinancialView = {
  customerPackageId: string;
  name: string;
  sessionCountSnapshot: number;
  usableBalance: number;
  ledgerBalance: number;
  usedSessions: number;
  expiresAtLabel: string | null;
  status: string;
};

export type RecentTransactionView = {
  id: string;
  dateLabel: string;
  itemSummary: string;
  totalMinor: number;
};

export type UsableBalanceFn = (
  organizationId: string,
  customerPackageId: string,
) => { ledgerBalance: number; usableBalance: number; status: string };

function dateParts(iso: string): { dateLabel: string; timeLabel: string | null; at: string } {
  const parsed = parseCustomerDate(iso);
  if (!parsed) {
    return { at: iso, dateLabel: iso, timeLabel: null };
  }
  const hasTime = /T\d{2}:\d{2}/.test(iso) || iso.includes(":");
  return {
    at: parsed.toISOString(),
    dateLabel: formatSlashDate(parsed),
    timeLabel: hasTime ? formatHmLabel(parsed) : null,
  };
}

function treatmentCompletedAt(treatment: TreatmentDraft): string {
  const extra = treatment as TreatmentDraft & { completedAt?: string };
  return extra.completedAt?.trim() || treatment.updatedAt;
}

export function deriveServiceFocus(input: {
  customer: Customer;
  latestTreatment?: TreatmentDraft | null;
  latestConsultation?: CustomerConsultation | null;
}): Customer360ServiceFocus {
  const { customer, latestTreatment, latestConsultation } = input;
  const consultationConditions = (latestConsultation?.healthItems ?? [])
    .filter((item) => item.checked)
    .map((item) => (item.note?.trim() ? `${item.label}：${item.note.trim()}` : item.label));
  const conditionNotes = uniqueTexts([
    ...(customer.lastServiceNotes ?? []),
    ...(latestTreatment?.assessment.concerns ?? []),
    ...(latestTreatment?.assessment.clientFocus
      ? [latestTreatment.assessment.clientFocus]
      : []),
    ...consultationConditions,
  ]).slice(0, 6);
  const lastBeauticianNote =
    latestTreatment?.professionalNote?.trim() ||
    latestTreatment?.clientFeeling?.trim() ||
    null;
  const suggestions = uniqueTexts([...(customer.trackingFocus ?? [])]);
  return { conditionNotes, lastBeauticianNote, suggestions };
}

export function hasServiceFocus(focus: Customer360ServiceFocus): boolean {
  return (
    focus.conditionNotes.length > 0 ||
    Boolean(focus.lastBeauticianNote) ||
    focus.suggestions.length > 0
  );
}

export function deriveFrequentServices(input: {
  treatments: TreatmentDraft[];
  appointments: ScheduleAppointment[];
  catalog: Service[];
}): FrequentServiceView[] {
  const counted = new Map<
    string,
    { serviceId: string; count: number; lastUsedAt: string; name: string }
  >();
  const seenAppointments = new Set<string>();

  for (const treatment of input.treatments) {
    if (treatment.status && treatment.status !== "completed") continue;
    const at = treatmentCompletedAt(treatment);
    bump(counted, treatment.serviceId, treatment.appointmentId, at, input.catalog);
    if (treatment.appointmentId) seenAppointments.add(treatment.appointmentId);
  }

  for (const apt of input.appointments) {
    if (apt.status !== "COMPLETED") continue;
    if (seenAppointments.has(apt.id)) continue;
    bump(counted, apt.serviceId, apt.id, apt.startAt, input.catalog, apt.serviceName);
  }

  return [...counted.values()]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.lastUsedAt.localeCompare(a.lastUsedAt);
    })
    .slice(0, CUSTOMER_360_FREQUENT_LIMIT)
    .map((row) => {
      const service = input.catalog.find((item) => item.id === row.serviceId);
      const parts = dateParts(row.lastUsedAt);
      return {
        serviceId: row.serviceId,
        serviceName: service?.name ?? row.name,
        usageCount: row.count,
        lastUsedAt: row.lastUsedAt,
        lastUsedLabel: parts.dateLabel,
        durationMinutes: service?.durationMinutes ?? null,
        priceMinor:
          typeof service?.priceMinor === "number" && Number.isInteger(service.priceMinor)
            ? service.priceMinor
            : null,
      };
    });
}

function bump(
  counted: Map<string, { serviceId: string; count: number; lastUsedAt: string; name: string }>,
  serviceId: string,
  _dedupeKey: string | undefined,
  at: string,
  catalog: Service[],
  fallbackName?: string,
): void {
  if (!serviceId) return;
  const current = counted.get(serviceId);
  const name = catalog.find((item) => item.id === serviceId)?.name ?? fallbackName ?? serviceId;
  if (!current) {
    counted.set(serviceId, { serviceId, count: 1, lastUsedAt: at, name });
    return;
  }
  current.count += 1;
  if (at.localeCompare(current.lastUsedAt) > 0) current.lastUsedAt = at;
}

export function deriveCustomerTimeline(input: {
  customerId: string;
  treatments: TreatmentDraft[];
  appointments: ScheduleAppointment[];
  followUps: FollowUpTask[];
  consultations: CustomerConsultation[];
  transactions: Transaction[];
  packageLedger?: PackageLedgerEntry[];
  storedValueLedger?: StoredValueLedgerEntry[];
  catalog: Service[];
  staffNameById?: Record<string, string>;
}): TimelineItemView[] {
  const items: TimelineItemView[] = [];
  const staff = input.staffNameById ?? {};

  for (const treatment of input.treatments) {
    if (treatment.status && treatment.status !== "completed") continue;
    const at = treatmentCompletedAt(treatment);
    const parts = dateParts(at);
    const service = input.catalog.find((item) => item.id === treatment.serviceId);
    items.push({
      id: `treatment:${treatment.id}`,
      at: parts.at,
      dateLabel: parts.dateLabel,
      timeLabel: parts.timeLabel,
      type: "treatment_completed",
      typeLabel: "完成服務",
      title: service?.name ?? "療程",
      summary: treatment.professionalNote?.trim() || treatment.followUp.tags.join("、") || null,
      staffName: staff[treatment.staffId] ?? null,
      href: `/staff/treatments/${treatment.id}`,
      ctaLabel: "查看療程紀錄",
    });
  }

  const treatmentAppointmentIds = new Set(
    input.treatments.map((t) => t.appointmentId).filter(Boolean),
  );
  for (const apt of input.appointments) {
    if (apt.status !== "COMPLETED") continue;
    if (treatmentAppointmentIds.has(apt.id)) continue;
    const parts = dateParts(apt.startAt);
    items.push({
      id: `appointment:${apt.id}`,
      at: parts.at,
      dateLabel: parts.dateLabel,
      timeLabel: parts.timeLabel,
      type: "appointment_completed",
      typeLabel: "完成預約",
      title: apt.serviceName,
      summary: apt.durationMinutes ? `${apt.durationMinutes} 分鐘` : null,
      staffName: apt.staffName || null,
      href: "/staff/calendar",
      ctaLabel: "查看行事曆",
    });
  }

  for (const task of input.followUps) {
    const at = task.updatedAt || task.createdAt;
    const parts = dateParts(at);
    items.push({
      id: `follow-up:${task.id}`,
      at: parts.at,
      dateLabel: parts.dateLabel,
      timeLabel: parts.timeLabel,
      type: "follow_up",
      typeLabel: task.status === "OPEN" ? "新增追蹤" : "完成追蹤",
      title: task.context.serviceName ?? (task.note?.trim() || "追蹤"),
      summary: task.note?.trim() || task.context.followUpTags.join("、") || null,
      staffName: task.context.staffName ?? staff[task.assignedStaffId ?? ""] ?? null,
      href: "/staff/follow-ups",
      ctaLabel: "查看追蹤",
    });
  }

  for (const row of input.consultations) {
    const parts = dateParts(row.consultedAt || row.createdAt);
    items.push({
      id: `consultation:${row.id}`,
      at: parts.at,
      dateLabel: parts.dateLabel,
      timeLabel: parts.timeLabel,
      type: "consultation",
      typeLabel: row.kind === "initial" ? "初次諮詢" : "諮詢更新",
      title: row.title,
      summary: row.goalNote?.trim() || null,
      staffName: row.consultedByName || null,
      href: `/staff/customers/${input.customerId}?tab=consultation`,
      ctaLabel: "查看諮詢",
    });
  }

  for (const tx of input.transactions) {
    if (tx.status !== "COMPLETED") continue;
    const parts = dateParts(tx.completedAt);
    items.push({
      id: `transaction:${tx.id}`,
      at: parts.at,
      dateLabel: parts.dateLabel,
      timeLabel: parts.timeLabel,
      type: "transaction",
      typeLabel: "完成結帳",
      title: tx.items[0]?.nameSnapshot ?? tx.transactionNumber,
      summary: tx.items.length > 1 ? `共 ${tx.items.length} 項` : null,
      staffName: null,
      href: `/staff/transactions?id=${tx.id}`,
      ctaLabel: "查看交易",
    });
  }

  for (const entry of input.packageLedger ?? []) {
    if (entry.customerId !== input.customerId) continue;
    const parts = dateParts(entry.createdAt);
    items.push({
      id: `package:${entry.id}`,
      at: parts.at,
      dateLabel: parts.dateLabel,
      timeLabel: parts.timeLabel,
      type: "package",
      typeLabel: entry.type === "PURCHASE" ? "購買套票" : entry.type === "REDEMPTION" ? "核銷套票" : "套票異動",
      title: PACKAGE_LEDGER_TYPE_LABEL[entry.type] ?? entry.type,
      summary: `${entry.sessionDelta > 0 ? "+" : ""}${entry.sessionDelta} 堂`,
      staffName: null,
      href: `/staff/customers/${input.customerId}?tab=wallet`,
      ctaLabel: "查看套票",
    });
  }

  for (const entry of input.storedValueLedger ?? []) {
    if (entry.customerId !== input.customerId) continue;
    const parts = dateParts(entry.createdAt);
    items.push({
      id: `sv:${entry.id}`,
      at: parts.at,
      dateLabel: parts.dateLabel,
      timeLabel: parts.timeLabel,
      type: "stored_value",
      typeLabel: entry.type === "TOP_UP" ? "儲值" : entry.type === "PAYMENT" ? "儲值消費" : "儲值異動",
      title: STORED_VALUE_LEDGER_TYPE_LABEL[entry.type] ?? entry.type,
      summary: `${entry.amountDelta >= 0 ? "+" : ""}${formatTwd(entry.amountDelta)}`,
      staffName: null,
      href: `/staff/customers/${input.customerId}?tab=wallet`,
      ctaLabel: "查看儲值",
    });
  }

  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export function derivePackageFinancialCards(
  organizationId: string,
  packages: CustomerPackage[],
  getUsable: UsableBalanceFn,
): PackageFinancialView[] {
  return packages.map((pkg) => {
    const bal = getUsable(organizationId, pkg.id);
    const usedSessions = Math.max(0, pkg.sessionCountSnapshot - bal.ledgerBalance);
    return {
      customerPackageId: pkg.id,
      name: pkg.nameSnapshot,
      sessionCountSnapshot: pkg.sessionCountSnapshot,
      usableBalance: bal.usableBalance,
      ledgerBalance: bal.ledgerBalance,
      usedSessions,
      expiresAtLabel: pkg.expiresAt ? dateParts(pkg.expiresAt).dateLabel : null,
      status: bal.status,
    };
  });
}

export function deriveRecentTransactions(
  transactions: Transaction[],
  limit = CUSTOMER_360_TX_LIMIT,
): RecentTransactionView[] {
  return transactions
    .filter((tx) => tx.status === "COMPLETED")
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(0, limit)
    .map((tx) => ({
      id: tx.id,
      dateLabel: dateParts(tx.completedAt).dateLabel,
      itemSummary: tx.items[0]?.nameSnapshot ?? tx.transactionNumber,
      totalMinor: tx.total,
    }));
}

export function deriveLastVisitLabel(input: {
  customer: Customer;
  appointments: ScheduleAppointment[];
  treatments: TreatmentDraft[];
}): string | null {
  const stamps: string[] = [];
  for (const apt of input.appointments) {
    if (apt.status === "COMPLETED") stamps.push(apt.startAt);
  }
  for (const treatment of input.treatments) {
    if (treatment.status && treatment.status !== "completed") continue;
    stamps.push(treatmentCompletedAt(treatment));
  }
  stamps.sort((a, b) => b.localeCompare(a));
  if (stamps[0]) return dateParts(stamps[0]).dateLabel;
  const fallback = parseCustomerDate(input.customer.lastVisit);
  return fallback ? formatSlashDate(fallback) : input.customer.lastVisit?.trim() || null;
}

export function previewTimeline(
  items: TimelineItemView[],
  limit = CUSTOMER_360_TIMELINE_PREVIEW,
): TimelineItemView[] {
  return items.slice(0, limit);
}

export function derivePrimaryServiceName(
  frequent: FrequentServiceView[],
  customer: Customer,
): string | null {
  return frequent[0]?.serviceName ?? customer.lastServiceName?.trim() ?? null;
}

export function previewPackages(
  packages: PackageFinancialView[],
  limit = CUSTOMER_360_PACKAGE_PREVIEW,
): PackageFinancialView[] {
  return [...packages]
    .sort((a, b) => {
      if (b.usableBalance !== a.usableBalance) return b.usableBalance - a.usableBalance;
      return b.ledgerBalance - a.ledgerBalance;
    })
    .slice(0, limit);
}

function uniqueTexts(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const text = raw.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}
