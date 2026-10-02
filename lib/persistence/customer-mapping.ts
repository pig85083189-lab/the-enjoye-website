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

export function birthdayToRemoteDate(birthday: string | undefined | null): string | null {
  const raw = emptyToNull(birthday);
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  const slash = raw.match(/^(\d{4})[/](\d{1,2})[/](\d{1,2})$/);
  if (!slash) {
    throw new Error(`Invalid birthday ${JSON.stringify(birthday)}`);
  }
  return `${slash[1]}-${slash[2]!.padStart(2, "0")}-${slash[3]!.padStart(2, "0")}`;
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
