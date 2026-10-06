/**
 * Customer domain ↔ remote customers table mapping.
 * CRM-only and local-only fields must not leak into the remote payload.
 */

import type { Customer, CustomerListStatus, MembershipTier } from "@/types";
import type { DbCustomer, RemoteCustomerStatus } from "./operational-rows";

export const CRM_ONLY_CUSTOMER_FIELDS = [
  "tags",
  "alerts",
  "lastServiceNotes",
  "trackingFocus",
  "preferences",
  "packages",
] as const;

export const LOCAL_ONLY_CUSTOMER_FIELDS = [
  "occupation",
  "address",
] as const;

export const DEMO_RESIDUE_CUSTOMER_FIELDS = [
  "lastVisit",
  "totalVisits",
  "remainingSessions",
] as const;

export const REMOTE_CUSTOMER_COLUMNS = [
  "id",
  "organization_id",
  "app_id",
  "full_name",
  "phone",
  "email",
  "birthday",
  "gender",
  "line_user_id",
  "source",
  "membership_tier",
  "is_vip",
  "primary_staff_id",
  "status",
  "notes",
  "created_at",
  "updated_at",
] as const;

export function emptyToNull(value: string | undefined | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export const CUSTOMER_BIRTHDAY_MESSAGE = "請以 YYYY/MM/DD 填寫生日";

export class CustomerBirthdayError extends Error {
  constructor(message = CUSTOMER_BIRTHDAY_MESSAGE) {
    super(message);
    this.name = "CustomerBirthdayError";
  }
}

function padDatePart(value: string): string {
  return value.padStart(2, "0");
}

function isoDateIfValid(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) {
    return null;
  }
  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

/**
 * Accept empty, YYYY-MM-DD, YYYY/M/D, YYYY.M.D, and YYYY年M月D日.
 * Reject two-digit years and impossible calendar dates before INSERT.
 */
export function birthdayToRemoteDate(birthday: string | undefined | null): string | null {
  const raw = emptyToNull(birthday);
  if (!raw) return null;
  const match = raw.match(
    /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/,
  );
  const iso = match ? isoDateIfValid(match[1]!, match[2]!, match[3]!) : null;
  if (!iso) {
    throw new CustomerBirthdayError();
  }
  return iso;
}

export function birthdayFromRemoteDate(value: string | null): string {
  if (!value) return "";
  const iso = value.slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${match[1]}/${match[2]}/${match[3]}`;
}

export function toRemoteMembership(
  membership: MembershipTier | undefined,
): { membership_tier: string | null; is_vip: boolean } {
  if (!membership) return { membership_tier: null, is_vip: false };
  return {
    membership_tier: membership,
    is_vip: membership === "vip",
  };
}

export function fromRemoteMembership(
  membershipTier: string | null,
  isVip: boolean,
): MembershipTier {
  if (membershipTier === "vip" || membershipTier === "regular" || membershipTier === "new") {
    return membershipTier;
  }
  return isVip ? "vip" : "new";
}

/**
 * Explicit remote enum mapping.
 * needs_follow_up is CRM-only and never a customer_status value.
 */
export function toRemoteCustomerStatus(
  listStatus: CustomerListStatus | undefined,
): RemoteCustomerStatus {
  if (listStatus === "inactive") return "INACTIVE";
  if (listStatus === "archived") return "ARCHIVED";
  return "ACTIVE";
}

export function fromRemoteCustomerStatus(
  status: RemoteCustomerStatus,
): CustomerListStatus {
  if (status === "INACTIVE") return "inactive";
  if (status === "ARCHIVED") return "archived";
  return "normal";
}

export function assertNoCrmOnlyLeak(payload: Record<string, unknown>): void {
  for (const field of CRM_ONLY_CUSTOMER_FIELDS) {
    if (field in payload) {
      throw new Error(`CRM-only field ${field} must not be written to remote customers`);
    }
  }
  for (const field of LOCAL_ONLY_CUSTOMER_FIELDS) {
    if (field in payload) {
      throw new Error(`Local-only field ${field} must not be written to remote customers`);
    }
  }
  for (const field of DEMO_RESIDUE_CUSTOMER_FIELDS) {
    if (field in payload) {
      throw new Error(`Demo residue field ${field} must not be written to remote customers`);
    }
  }
  if (payload.status === "needs_follow_up") {
    throw new Error("needs_follow_up is not a remote customer_status");
  }
}

export function remoteCustomerPayload(row: DbCustomer): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const column of REMOTE_CUSTOMER_COLUMNS) {
    payload[column] = row[column];
  }
  assertNoCrmOnlyLeak(payload);
  return payload;
}

export function ageFromIsoDate(birthday: string): number {
  const parts = birthday.split(/[/-]/).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return 0;
  const [y, m, d] = parts;
  const today = new Date();
  let age = today.getFullYear() - y!;
  if (today.getMonth() + 1 < m! || (today.getMonth() + 1 === m && today.getDate() < d!)) {
    age -= 1;
  }
  return age;
}

export function customerFromRemoteRow(
  organizationAppId: string,
  row: DbCustomer,
): Customer {
  const birthday = birthdayFromRemoteDate(row.birthday);
  const now = row.updated_at;
  return {
    id: row.app_id,
    organizationId: organizationAppId,
    name: row.full_name,
    phone: row.phone ?? "",
    birthday,
    age: birthday ? ageFromIsoDate(birthday) : 0,
    membership: fromRemoteMembership(row.membership_tier, row.is_vip),
    lastVisit: "",
    totalVisits: 0,
    packages: [],
    lastServiceNotes: [],
    trackingFocus: [],
    alerts: [],
    tags: [],
    email: row.email ?? undefined,
    lineId: row.line_user_id ?? undefined,
    gender: (row.gender as Customer["gender"]) ?? undefined,
    source: (row.source as Customer["source"]) ?? undefined,
    primaryStaffId: row.primary_staff_id ?? undefined,
    joinedAt: row.created_at.slice(0, 10).replace(/-/g, "/"),
    listStatus: fromRemoteCustomerStatus(row.status),
    createdAt: row.created_at,
    updatedAt: now,
  };
}
