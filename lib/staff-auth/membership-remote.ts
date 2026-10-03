import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffMembership } from "@/types/saas";
import {
  STAFF_AUTH_MEMBERSHIP_LOCATIONS_TABLE,
  STAFF_AUTH_MEMBERSHIPS_TABLE,
  staffMembershipFromRow,
  staffMembershipLocationRows,
  staffMembershipToRow,
  type StaffAuthMembershipLocationRow,
  type StaffAuthMembershipRow,
} from "@/lib/staff-auth/membership-schema";
import { assertOperationalStaffId } from "@/lib/staff-auth/staff-id";
import { MEMBERSHIP_ENJOYE_OWNER_ID } from "@/lib/tenant/constants";

export async function fetchStaffAuthMembershipsByAuthUserId(
  client: SupabaseClient,
  authUserId: string,
): Promise<StaffMembership[]> {
  const { data, error } = await client
    .from(STAFF_AUTH_MEMBERSHIPS_TABLE)
    .select("*")
    .eq("auth_user_id", authUserId);
  if (error) throw new Error(error.message);
  return hydrateLocationIds(client, (data ?? []) as StaffAuthMembershipRow[]);
}

export async function fetchStaffAuthMembershipsByOrganizationId(
  client: SupabaseClient,
  organizationId: string,
): Promise<StaffMembership[]> {
  const { data, error } = await client
    .from(STAFF_AUTH_MEMBERSHIPS_TABLE)
    .select("*")
    .eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
  return hydrateLocationIds(client, (data ?? []) as StaffAuthMembershipRow[]);
}

export async function upsertStaffAuthMembership(
  client: SupabaseClient,
  membership: StaffMembership,
): Promise<StaffMembership> {
  assertOperationalStaffId(membership.userId);
  const row = staffMembershipToRow(membership);
  const { data, error } = await client
    .from(STAFF_AUTH_MEMBERSHIPS_TABLE)
    .upsert(row, { onConflict: "id" })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message || "無法寫入員工登入對應");
  }
  const locations = staffMembershipLocationRows(membership);
  const { error: deleteError } = await client
    .from(STAFF_AUTH_MEMBERSHIP_LOCATIONS_TABLE)
    .delete()
    .eq("membership_id", membership.id);
  if (deleteError) throw new Error(deleteError.message);
  if (locations.length > 0) {
    const { error: insertError } = await client
      .from(STAFF_AUTH_MEMBERSHIP_LOCATIONS_TABLE)
      .insert(locations);
    if (insertError) throw new Error(insertError.message);
  }
  return staffMembershipFromRow(data as StaffAuthMembershipRow, membership.locationIds);
}

export async function deleteStaffAuthMembership(
  client: SupabaseClient,
  membershipId: string,
): Promise<void> {
  if (membershipId === MEMBERSHIP_ENJOYE_OWNER_ID) {
    throw new Error("不得刪除現有店主");
  }
  const { error: locationError } = await client
    .from(STAFF_AUTH_MEMBERSHIP_LOCATIONS_TABLE)
    .delete()
    .eq("membership_id", membershipId);
  if (locationError) throw new Error(locationError.message);
  const { error } = await client
    .from(STAFF_AUTH_MEMBERSHIPS_TABLE)
    .delete()
    .eq("id", membershipId)
    .neq("id", MEMBERSHIP_ENJOYE_OWNER_ID);
  if (error) throw new Error(error.message);
}

export async function bindStaffAuthMembershipAuthUser(
  client: SupabaseClient,
  membershipId: string,
  authUserId: string,
): Promise<StaffMembership> {
  const { data, error } = await client
    .from(STAFF_AUTH_MEMBERSHIPS_TABLE)
    .update({ auth_user_id: authUserId })
    .eq("id", membershipId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message || "無法綁定登入帳號");
  }
  const rows = await hydrateLocationIds(client, [data as StaffAuthMembershipRow]);
  const membership = rows[0];
  if (!membership) throw new Error("無法綁定登入帳號");
  return membership;
}

async function hydrateLocationIds(
  client: SupabaseClient,
  rows: StaffAuthMembershipRow[],
): Promise<StaffMembership[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const { data, error } = await client
    .from(STAFF_AUTH_MEMBERSHIP_LOCATIONS_TABLE)
    .select("*")
    .in("membership_id", ids);
  if (error) throw new Error(error.message);
  const byMembership = new Map<string, string[]>();
  for (const item of (data ?? []) as StaffAuthMembershipLocationRow[]) {
    const list = byMembership.get(item.membership_id) ?? [];
    list.push(item.location_id);
    byMembership.set(item.membership_id, list);
  }
  return rows.map((row) =>
    staffMembershipFromRow(row, byMembership.get(row.id) ?? []),
  );
}
