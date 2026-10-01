/**
 * Temporary Preview-only Strategy B RLS smoke.
 * Uses the cookie-bound publishable client + auth.getUser().
 * Never uses the service-role client. Never accepts tokens or identity input.
 */
import { createClient } from "@/lib/supabase/server";
import {
  STAFF_AUTH_MEMBERSHIPS_TABLE,
  type StaffAuthMembershipRow,
} from "@/lib/staff-auth/membership-schema";
import { assertOperationalStaffId } from "@/lib/staff-auth/staff-id";

export const RLS_SMOKE_ORG_UUID = "62bd49b6-a4c3-4da1-b53e-4746923685f1";
export const RLS_SMOKE_LOC_UUID = "c46b700c-bb42-45ce-be53-4484e217c3f8";
export const RLS_SMOKE_UNRELATED_ORG_UUID =
  "00000000-0000-4000-8000-000000000001";
export const RLS_SMOKE_UNRELATED_LOC_UUID =
  "00000000-0000-4000-8000-000000000002";

export type AuthenticatedRlsSmokeResult =
  | { authenticated: false }
  | {
      authenticated: true;
      operationalStaffId: string;
      role: string;
      organizationMembership: boolean | null;
      organizationRole: string | null;
      locationAccess: boolean | null;
      unrelatedOrganizationMembership: boolean | null;
      unrelatedLocationAccess: boolean | null;
    };

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function asRole(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function runAuthenticatedRlsSmoke(): Promise<AuthenticatedRlsSmokeResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { authenticated: false };
  }

  const { data: rows } = await supabase
    .from(STAFF_AUTH_MEMBERSHIPS_TABLE)
    .select("id,user_id,auth_user_id,organization_id,role,is_active")
    .eq("auth_user_id", data.user.id)
    .eq("is_active", true);

  const memberships = (rows ?? []) as Pick<
    StaffAuthMembershipRow,
    "id" | "user_id" | "auth_user_id" | "organization_id" | "role" | "is_active"
  >[];
  const membership =
    memberships.find((row) => row.organization_id === "org-the-enjoye") ??
    memberships[0];
  if (membership) {
    assertOperationalStaffId(membership.user_id);
  }

  const { data: hasOrg } = await supabase.rpc("user_has_org_membership", {
    target_org: RLS_SMOKE_ORG_UUID,
  });
  const { data: orgRole } = await supabase.rpc("user_org_role", {
    target_org: RLS_SMOKE_ORG_UUID,
  });
  const { data: canLoc } = await supabase.rpc("user_can_access_location", {
    target_org: RLS_SMOKE_ORG_UUID,
    target_loc: RLS_SMOKE_LOC_UUID,
  });
  const { data: hasWrongOrg } = await supabase.rpc("user_has_org_membership", {
    target_org: RLS_SMOKE_UNRELATED_ORG_UUID,
  });
  const { data: canWrongLoc } = await supabase.rpc("user_can_access_location", {
    target_org: RLS_SMOKE_ORG_UUID,
    target_loc: RLS_SMOKE_UNRELATED_LOC_UUID,
  });

  const result = {
    authenticated: true as const,
    operationalStaffId: membership?.user_id ?? "",
    role: membership?.role ?? "",
    organizationMembership: asBoolean(hasOrg),
    organizationRole: asRole(orgRole),
    locationAccess: asBoolean(canLoc),
    unrelatedOrganizationMembership: asBoolean(hasWrongOrg),
    unrelatedLocationAccess: asBoolean(canWrongLoc),
  };

  console.info(
    "[beauty-os-rls-smoke]",
    JSON.stringify({
      authenticated: true,
      staff: result.operationalStaffId,
      role: result.role,
      org: result.organizationMembership,
      orgRole: result.organizationRole,
      loc: result.locationAccess,
      wrongOrg: result.unrelatedOrganizationMembership,
      wrongLoc: result.unrelatedLocationAccess,
    }),
  );

  return result;
}
