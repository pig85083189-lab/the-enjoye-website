/**
 * Authenticated PostgREST Staff CREATE store.
 * Insert-only (no upsert, no Auth Admin, no service role).
 * auth_user_id is forced null. Retry with the same ids returns the existing row.
 */

import {
  STAFF_AUTH_MEMBERSHIP_LOCATIONS_TABLE,
  STAFF_AUTH_MEMBERSHIPS_TABLE,
  staffMembershipFromRow,
  type StaffAuthMembershipRow,
} from "@/lib/staff-auth/membership-schema";
import { assertOperationalStaffId, isAuthUuid } from "@/lib/staff-auth/staff-id";
import { StaffWriteConflictError, refuseStaffWriteMutation } from "@/lib/staff/staff-write-guard";
import type { StaffMembership } from "@/types/saas";
import type {
  IdentityQueryBuilder,
  IdentitySupabaseClient,
} from "./authenticated-identity-catalog";

export const STAFF_MEMBERSHIP_WRITE_COLUMNS =
  "id, user_id, auth_user_id, organization_id, role, display_name, email, phone, title, is_active, created_at, created_by_staff_id";

export type StaffWriteQueryResult<T = unknown> = {
  data: T | null;
  error: { message: string; code?: string } | null;
};

export interface AuthenticatedStaffWriteClient {
  auth: IdentitySupabaseClient["auth"];
  from(table: string): {
    select(columns: string): IdentityQueryBuilder;
    insert(payload: Record<string, unknown> | Record<string, unknown>[]): {
      select(columns: string): PromiseLike<StaffWriteQueryResult>;
    };
  };
}

export type StaffOperationalInsertInput = {
  membershipId: string;
  userId: string;
  organizationId: string;
  role: StaffMembership["role"];
  displayName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  locationIds: string[];
  createdByStaffId: string;
};

function isUniqueViolation(error: { message: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return /duplicate key|unique constraint/i.test(error.message);
}

async function readRows<T>(builder: IdentityQueryBuilder): Promise<T[]> {
  const result = await builder;
  if (result.error) {
    throw new Error(result.error.message);
  }
  return (result.data ?? []) as T[];
}

export class AuthenticatedStaffWriteStore {
  constructor(private readonly client: AuthenticatedStaffWriteClient) {}

  async listOrgMemberships(organizationId: string): Promise<StaffMembership[]> {
    const rows = await readRows<StaffAuthMembershipRow>(
      this.client
        .from(STAFF_AUTH_MEMBERSHIPS_TABLE)
        .select(STAFF_MEMBERSHIP_WRITE_COLUMNS)
        .eq("organization_id", organizationId),
    );
    return this.hydrateLocationIds(rows.filter((row) => row.organization_id === organizationId));
  }

  async getMembershipById(membershipId: string): Promise<StaffMembership | undefined> {
    const rows = await readRows<StaffAuthMembershipRow>(
      this.client
        .from(STAFF_AUTH_MEMBERSHIPS_TABLE)
        .select(STAFF_MEMBERSHIP_WRITE_COLUMNS)
        .eq("id", membershipId),
    );
    const hydrated = await this.hydrateLocationIds(rows.filter((row) => row.id === membershipId));
    return hydrated[0];
  }

  async insertOperationalStaff(input: StaffOperationalInsertInput): Promise<StaffMembership> {
    assertOperationalStaffId(input.userId);
    assertOperationalStaffId(input.createdByStaffId);
    if (isAuthUuid(input.userId) || isAuthUuid(input.membershipId)) {
      throw new StaffWriteConflictError("Auth UUID 不得作為員工識別");
    }
    const payload = {
      id: input.membershipId,
      user_id: input.userId,
      auth_user_id: null,
      organization_id: input.organizationId,
      role: input.role,
      display_name: input.displayName,
      email: input.email,
      phone: input.phone,
      title: input.title,
      is_active: true,
      created_by_staff_id: input.createdByStaffId,
    };
    const inserted = await this.client
      .from(STAFF_AUTH_MEMBERSHIPS_TABLE)
      .insert(payload)
      .select(STAFF_MEMBERSHIP_WRITE_COLUMNS);
    if (inserted.error) {
      if (isUniqueViolation(inserted.error)) {
        const existing = await this.getMembershipById(input.membershipId);
        if (
          existing &&
          existing.userId === input.userId &&
          existing.organizationId === input.organizationId &&
          !existing.authUserId
        ) {
          await this.insertLocations(input.membershipId, input.locationIds);
          return (await this.getMembershipById(input.membershipId)) ?? existing;
        }
        throw new StaffWriteConflictError("員工識別已存在");
      }
      throw new Error(inserted.error.message);
    }
    const row = Array.isArray(inserted.data) ? inserted.data[0] : inserted.data;
    if (!row) {
      throw new Error("insert staff: empty response");
    }
    await this.insertLocations(input.membershipId, input.locationIds);
    const created = await this.getMembershipById(input.membershipId);
    if (created) return created;
    return staffMembershipFromRow(row as StaffAuthMembershipRow, input.locationIds);
  }

  update(): never {
    return refuseStaffWriteMutation("update");
  }

  private async insertLocations(membershipId: string, locationIds: string[]): Promise<void> {
    const unique = [...new Set(locationIds.filter(Boolean))];
    if (unique.length === 0) return;
    const payload = unique.map((locationId) => ({
      membership_id: membershipId,
      location_id: locationId,
    }));
    const result = await this.client
      .from(STAFF_AUTH_MEMBERSHIP_LOCATIONS_TABLE)
      .insert(payload)
      .select("membership_id, location_id");
    if (result.error && !isUniqueViolation(result.error)) {
      throw new Error(result.error.message);
    }
  }

  private async hydrateLocationIds(rows: StaffAuthMembershipRow[]): Promise<StaffMembership[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const locations = await readRows<{ membership_id: string; location_id: string }>(
      this.client
        .from(STAFF_AUTH_MEMBERSHIP_LOCATIONS_TABLE)
        .select("membership_id, location_id")
        .in("membership_id", ids),
    );
    const byMembership = new Map<string, string[]>();
    for (const item of locations) {
      const list = byMembership.get(item.membership_id) ?? [];
      list.push(item.location_id);
      byMembership.set(item.membership_id, list);
    }
    return rows.map((row) => staffMembershipFromRow(row, byMembership.get(row.id) ?? []));
  }
}
