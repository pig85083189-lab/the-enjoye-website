/**
 * Read-only backup and preflight for browser appointments and completed
 * treatments. This module never writes localStorage or Supabase.
 * Customer identity is an exact app id or database UUID. Names and phones
 * are not match keys.
 */
import { LEGACY_STORAGE_KEYS } from "@/lib/tenant/constants";

export const LOCAL_MIGRATION_BACKUP_VERSION = 1 as const;

const SCHEDULE_KEY = /^beauty-os:([^:]+):schedule-appointments:v1$/;
const COMPLETED_KEY = /^beauty-os:([^:]+):treatments-completed:v1$/;

export interface LocalStorageView {
  getItem(key: string): string | null;
  keys(): readonly string[];
}

export interface LocalAppointmentBackup {
  storageKey: string;
  id: string;
  organizationId: string;
  locationId: string;
  customerId: string;
  staffId: string;
  serviceId: string;
  serviceName: string;
  staffName: string;
  startAt: string;
  endAt: string;
  status: string;
}

export interface LocalTreatmentBackup {
  storageKey: string;
  id: string;
  organizationId: string;
  locationId: string;
  appointmentId: string;
  customerId: string;
  staffId: string;
  serviceId: string;
  status: string;
  assessment: unknown;
  bodyMarkers: unknown;
  bodyMapNote: string;
  professionalNote: string;
  clientFeeling: string;
  discomfortNote: string;
  followUp: unknown;
  products: unknown;
  suggestedTrackingAreas: unknown;
}

export interface LocalMigrationBackup {
  version: typeof LOCAL_MIGRATION_BACKUP_VERSION;
  readOnly: true;
  appointments: LocalAppointmentBackup[];
  completedTreatments: LocalTreatmentBackup[];
  unreadableKeys: string[];
}

export interface RemoteCustomerRef {
  appId: string;
  dbId: string;
  status: string;
}

export interface RemoteAppointmentRef {
  appId: string;
  customerDbId: string | null;
  startsAt: string;
}

export interface RemoteLineLinkRef {
  customerDbId: string;
  revokedAt: string | null;
}

/** Exact identifiers only. Do not add name, phone, or LINE secrets. */
export interface RemoteIdentitySnapshot {
  customers: readonly RemoteCustomerRef[];
  appointments: readonly RemoteAppointmentRef[];
  lineLinks: readonly RemoteLineLinkRef[];
}

export interface ClinicalPresence {
  assessment: boolean;
  body: boolean;
  professional: boolean;
  followUp: boolean;
}

export interface MigrationPreflightRow {
  appointmentId: string;
  customerId: string;
  organizationId: string;
  locationId: string;
  staffId: string;
  serviceId: string;
  serviceDate: string | null;
  serviceName: string;
  backupComplete: boolean;
  missingIdentity: string[];
  clinical: ClinicalPresence;
  customerMatch: "not-provided" | "unconfirmed" | "confirmed" | "ambiguous";
  lineLink: "not-provided" | "unconfirmed" | "active" | "revoked-only" | "ambiguous";
  financeAppointment: "not-provided" | "absent" | "present";
  transferable: boolean;
  reason: string;
}

export interface MigrationPreflightReport {
  rows: MigrationPreflightRow[];
  transferableAppointmentIds: string[];
  unconfirmedAppointmentIds: string[];
}

export function taipeiServiceDate(iso: string): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
}

export function readLocalMigrationBackup(storage: LocalStorageView): LocalMigrationBackup {
  const appointments: LocalAppointmentBackup[] = [];
  const completedTreatments: LocalTreatmentBackup[] = [];
  const unreadableKeys: string[] = [];

  for (const key of storage.keys()) {
    if (SCHEDULE_KEY.test(key)) {
      const rows = readArray(storage, key, unreadableKeys);
      if (!rows) continue;
      for (const row of rows) appointments.push(appointmentFrom(key, row));
      continue;
    }
    if (COMPLETED_KEY.test(key) || key === LEGACY_STORAGE_KEYS.treatmentsCompleted) {
      const rows = readArray(storage, key, unreadableKeys);
      if (!rows) continue;
      for (const row of rows) completedTreatments.push(treatmentFrom(key, row));
    }
  }

  return {
    version: LOCAL_MIGRATION_BACKUP_VERSION,
    readOnly: true,
    appointments,
    completedTreatments,
    unreadableKeys,
  };
}

export function preflightLocalMigration(
  backup: LocalMigrationBackup,
  remote?: RemoteIdentitySnapshot,
): MigrationPreflightReport {
  const rows = backup.completedTreatments.map((treatment) => {
    const appointment = backup.appointments.find(
      (item) =>
        item.id === treatment.appointmentId &&
        item.organizationId === treatment.organizationId,
    );
    return classify(treatment, appointment, remote);
  });
  return {
    rows,
    transferableAppointmentIds: rows.filter((row) => row.transferable).map((row) => row.appointmentId),
    unconfirmedAppointmentIds: rows.filter((row) => !row.transferable).map((row) => row.appointmentId),
  };
}

function classify(
  treatment: LocalTreatmentBackup,
  appointment: LocalAppointmentBackup | undefined,
  remote: RemoteIdentitySnapshot | undefined,
): MigrationPreflightRow {
  const missingIdentity = missingIds(treatment, appointment);
  const clinical = clinicalPresence(treatment);
  const serviceDate = taipeiServiceDate(appointment?.startAt ?? "");
  const base = {
    appointmentId: treatment.appointmentId,
    customerId: treatment.customerId,
    organizationId: treatment.organizationId,
    locationId: treatment.locationId,
    staffId: treatment.staffId,
    serviceId: treatment.serviceId,
    serviceDate,
    serviceName: appointment?.serviceName ?? "",
    backupComplete: missingIdentity.length === 0,
    missingIdentity,
    clinical,
    transferable: false,
  };

  if (!remote) {
    return {
      ...base,
      customerMatch: "not-provided",
      lineLink: "not-provided",
      financeAppointment: "not-provided",
      reason: "尚未取得正式資料庫的唯讀對照，不能視為可移轉。",
    };
  }

  const customers = remote.customers.filter((customer) => sameCustomer(treatment.customerId, customer));
  const customerMatch = customers.length === 1 ? "confirmed" : customers.length === 0 ? "unconfirmed" : "ambiguous";
  const customer = customers.length === 1 ? customers[0] : undefined;
  const links = customer
    ? remote.lineLinks.filter((link) => link.customerDbId === customer.dbId)
    : [];
  const activeLinks = links.filter((link) => !link.revokedAt);
  const lineLink = !customer
    ? "unconfirmed"
    : activeLinks.length === 1 && links.length === activeLinks.length
      ? "active"
      : activeLinks.length === 0 && links.length > 0
        ? "revoked-only"
        : links.length === 0
          ? "unconfirmed"
          : "ambiguous";
  const appointments = remote.appointments.filter((item) => item.appId === treatment.appointmentId);
  const financeAppointment = appointments.length === 1 ? "present" : "absent";
  const appointmentCustomerMatches = Boolean(
    customer &&
    appointments.length === 1 &&
    appointments[0]?.customerDbId === customer.dbId,
  );
  const identityReady = customerMatch === "confirmed" && customer?.status === "ACTIVE" && lineLink === "active";
  const transferable = Boolean(
    base.backupComplete &&
    identityReady &&
    financeAppointment === "present" &&
    appointmentCustomerMatches,
  );
  return {
    ...base,
    customerMatch,
    lineLink,
    financeAppointment,
    transferable,
    reason: transferable
      ? "正式預約、顧客與未撤銷的 LINE 綁定都已對上，療程內容可進入第二階段。"
      : blockedReason(base.backupComplete, customerMatch, lineLink, financeAppointment, appointmentCustomerMatches),
  };
}

function blockedReason(
  backupComplete: boolean,
  customerMatch: MigrationPreflightRow["customerMatch"],
  lineLink: MigrationPreflightRow["lineLink"],
  financeAppointment: MigrationPreflightRow["financeAppointment"],
  appointmentCustomerMatches: boolean,
): string {
  if (!backupComplete) return "本機備份缺少必要編號，已保留原始資料。";
  if (customerMatch !== "confirmed") return "正式顧客編號尚未以精確 ID 確認，不能移轉。";
  if (lineLink !== "active") return "LINE 會員綁定尚未確認為一筆未撤銷的有效對應。";
  if (financeAppointment !== "present") return "正式財務庫沒有這筆預約，第一階段不建立預約。";
  if (!appointmentCustomerMatches) return "正式預約的顧客與已確認的會員顧客不同，已停止。";
  return "尚未滿足移轉條件。";
}

function missingIds(
  treatment: LocalTreatmentBackup,
  appointment: LocalAppointmentBackup | undefined,
): string[] {
  const missing: string[] = [];
  if (!treatment.appointmentId) missing.push("appointmentId");
  if (!treatment.customerId) missing.push("customerId");
  if (!treatment.organizationId) missing.push("organizationId");
  if (!treatment.locationId) missing.push("locationId");
  if (!treatment.staffId) missing.push("staffId");
  if (!treatment.serviceId) missing.push("serviceId");
  if (!appointment) missing.push("localAppointment");
  if (appointment && appointment.customerId !== treatment.customerId) missing.push("appointmentCustomerMismatch");
  if (appointment && appointment.organizationId !== treatment.organizationId) missing.push("appointmentOrganizationMismatch");
  return missing;
}

function clinicalPresence(treatment: LocalTreatmentBackup): ClinicalPresence {
  const assessment = hasValue(treatment.assessment);
  const body = hasValue(treatment.bodyMarkers) || treatment.bodyMapNote.trim().length > 0;
  const professional = treatment.professionalNote.trim().length > 0 || treatment.clientFeeling.trim().length > 0;
  const followUp = hasValue(treatment.followUp) || hasValue(treatment.suggestedTrackingAreas);
  return { assessment, body, professional, followUp };
}

function sameCustomer(localCustomerId: string, customer: RemoteCustomerRef): boolean {
  return localCustomerId === customer.appId || localCustomerId === customer.dbId;
}

function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return typeof value === "string" && value.trim().length > 0;
}

function readArray(
  storage: LocalStorageView,
  key: string,
  unreadableKeys: string[],
): Record<string, unknown>[] | null {
  const raw = storage.getItem(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      unreadableKeys.push(key);
      return null;
    }
    return parsed.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item));
  } catch {
    unreadableKeys.push(key);
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function appointmentFrom(storageKey: string, row: Record<string, unknown>): LocalAppointmentBackup {
  return {
    storageKey,
    id: text(row.id),
    organizationId: text(row.organizationId),
    locationId: text(row.locationId),
    customerId: text(row.customerId),
    staffId: text(row.staffId),
    serviceId: text(row.serviceId),
    serviceName: text(row.serviceName),
    staffName: text(row.staffName),
    startAt: text(row.startAt),
    endAt: text(row.endAt),
    status: text(row.status),
  };
}

function treatmentFrom(storageKey: string, row: Record<string, unknown>): LocalTreatmentBackup {
  return {
    storageKey,
    id: text(row.id),
    organizationId: text(row.organizationId),
    locationId: text(row.locationId),
    appointmentId: text(row.appointmentId),
    customerId: text(row.customerId),
    staffId: text(row.staffId),
    serviceId: text(row.serviceId),
    status: text(row.status),
    assessment: row.assessment ?? null,
    bodyMarkers: row.bodyMarkers ?? [],
    bodyMapNote: text(row.bodyMapNote),
    professionalNote: text(row.professionalNote),
    clientFeeling: text(row.clientFeeling),
    discomfortNote: text(row.discomfortNote),
    followUp: row.followUp ?? null,
    products: row.products ?? [],
    suggestedTrackingAreas: row.suggestedTrackingAreas ?? [],
  };
}
