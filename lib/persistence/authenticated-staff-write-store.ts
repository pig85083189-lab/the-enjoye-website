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

export const CREATE_OPERATIONAL_STAFF_RPC = "create_operational_staff";

export interface AuthenticatedStaffWriteClient {
  auth: IdentitySupabaseClient["auth"];
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<StaffWriteQueryResult<Record<string, unknown>>>;
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
    const inserted = await this.client.rpc(CREATE_OPERATIONAL_STAFF_RPC, {
      p_membership_id: input.membershipId,
      p_user_id: input.userId,
      p_display_name: input.displayName,
      p_role: input.role,
      p_location_ids: input.locationIds,
      p_phone: input.phone,
      p_email: input.email,
      p_title: input.title,
    });
    if (inserted.error) {
      if (isUniqueViolation(inserted.error)) {
        const existing = await this.getMembershipById(input.membershipId);
        if (
          existing &&
          existing.userId === input.userId &&
          existing.organizationId === input.organizationId &&
          !existing.authUserId &&
          existing.locationIds.length > 0
        ) {
          return existing;
        }
        throw new StaffWriteConflictError("員工識別已存在");
      }
      throw new Error(inserted.error.message);
    }
    const payload = Array.isArray(inserted.data) ? inserted.data[0] : inserted.data;
    if (!payload || typeof payload !== "object") {
      throw new Error("insert staff: empty response");
    }
    const created = await this.getMembershipById(input.membershipId);
    if (created && created.locationIds.length > 0 && !created.authUserId) {
      return created;
    }
    const locationIds = Array.isArray(payload.location_ids)
      ? (payload.location_ids as unknown[]).filter((id): id is string => typeof id === "string")
      : input.locationIds;
    if (locationIds.length === 0) {
      throw new Error("insert staff: location assignment missing");
    }
    return staffMembershipFromRow(
      {
        id: String(payload.id ?? input.membershipId),
        user_id: String(payload.user_id ?? input.userId),
        auth_user_id:
          typeof payload.auth_user_id === "string" ? payload.auth_user_id : null,
        organization_id: String(payload.organization_id ?? input.organizationId),
        role: String(payload.role ?? input.role),
        display_name: String(payload.display_name ?? input.displayName),
        email: typeof payload.email === "string" ? payload.email : null,
        phone: typeof payload.phone === "string" ? payload.phone : null,
        title: typeof payload.title === "string" ? payload.title : null,
        is_active: payload.is_active !== false,
        created_at:
          typeof payload.created_at === "string"
            ? payload.created_at
            : new Date().toISOString(),
        created_by_staff_id: input.createdByStaffId,
      },
      locationIds,
    );
  }

  update(): never {
    return refuseStaffWriteMutation("update");
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
