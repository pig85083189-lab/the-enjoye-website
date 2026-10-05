/**
 * Authenticated create-form options for the Appointment write pilot.
 * Customer options reuse the Customer remote-read adapter so Calendar
 * search matches /staff/customers (name + phone, org-scoped).
 */

import { AuthenticatedCustomerReadStore } from "@/lib/persistence/authenticated-customer-read-store";
import { CustomerRemoteAdapter } from "@/lib/persistence/customer-remote-adapter";
import { IdentityCatalogError } from "@/lib/persistence/identity-errors";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentityQueryBuilder,
  type IdentityQueryResult,
  type IdentitySupabaseClient,
  type LoadedAuthenticatedIdentity,
} from "@/lib/persistence/authenticated-identity-catalog";
import type { StaffMembership, StaffRole } from "@/types/saas";
import { canCancelAppointment, canCreateAppointment } from "@/lib/staff-auth/operational-capabilities";
import type { AppointmentWriteCustomerOption } from "./appointment-write-customer-search";

const STAFF_ROLES = new Set<StaffRole>([
  "OWNER",
  "MANAGER",
  "STAFF",
  "RECEPTIONIST",
  "ACCOUNTANT",
]);

function asStaffRole(role: string): StaffRole {
  return STAFF_ROLES.has(role as StaffRole) ? (role as StaffRole) : "STAFF";
}

export type { AppointmentWriteCustomerOption } from "./appointment-write-customer-search";
export { filterAppointmentWriteCustomers } from "./appointment-write-customer-search";

export type AppointmentWriteFormOption = {
  id: string;
  name: string;
};

export type AppointmentWriteServiceOption = AppointmentWriteFormOption & {
  durationMinutes: number;
};

export type AppointmentWriteStaffOption = AppointmentWriteFormOption & {
  locationIds: string[];
  role: string;
};

export type AppointmentWriteFormCatalog = {
  identity: LoadedAuthenticatedIdentity;
  role: string;
  canCreate: boolean;
  canCancel: boolean;
  customers: AppointmentWriteCustomerOption[];
  services: AppointmentWriteServiceOption[];
  staff: AppointmentWriteStaffOption[];
};

export function filterAppointmentWriteStaff(
  staff: AppointmentWriteStaffOption[],
  locationId: string,
): AppointmentWriteStaffOption[] {
  if (!locationId) return [];
  return staff.filter(
    (row) => row.locationIds.length === 0 || row.locationIds.includes(locationId),
  );
}

export function appointmentWriteStaffToMembership(
  staff: AppointmentWriteStaffOption,
  organizationId: string,
): StaffMembership {
  return {
    id: `remote-staff-${staff.id}`,
    organizationId,
    userId: staff.id,
    locationIds: staff.locationIds,
    role: asStaffRole(staff.role),
    displayName: staff.name,
    isActive: true,
    createdAt: "",
  };
}

async function readNamedRows(
  builder: IdentityQueryBuilder,
): Promise<Array<Record<string, unknown>>> {
  const result: IdentityQueryResult = await builder;
  if (result.error) {
    throw new IdentityCatalogError("missing_mapping", result.error.message);
  }
  return result.data ?? [];
}

function asName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function loadAppointmentWriteFormCatalog(
  client: IdentitySupabaseClient,
): Promise<AppointmentWriteFormCatalog> {
  const identity = await loadAuthenticatedIdentityCatalog(client);
  const staffRow = identity.catalog.findStaffByAppId(
    identity.organizationDbId,
    identity.operationalStaffId,
  );
  const role = staffRow?.role ?? "";
  const customers = (
    await new CustomerRemoteAdapter(
      identity.mapper,
      new AuthenticatedCustomerReadStore(client),
    ).list({ organizationId: identity.organizationAppId })
  ).map((customer) => ({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
  }));
  const services = (
    await readNamedRows(
      client
        .from("services")
        .select("app_id, organization_id, name, duration_minutes")
        .eq("organization_id", identity.organizationDbId),
    )
  ).flatMap((row) => {
    const id = typeof row.app_id === "string" ? row.app_id : "";
    const name = asName(row.name);
    const durationMinutes =
      typeof row.duration_minutes === "number" ? row.duration_minutes : Number(row.duration_minutes);
    if (!id || !name || !Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      return [];
    }
    return [{ id, name, durationMinutes }];
  });
  const membershipRows = (
    await readNamedRows(
      client
        .from("staff_auth_memberships")
        .select("id, user_id, display_name, organization_id, is_active, role")
        .eq("organization_id", identity.organizationAppId),
    )
  ).filter((row) => row.is_active !== false && row.organization_id === identity.organizationAppId);
  const locationRows = await readNamedRows(
    client.from("staff_auth_membership_locations").select("membership_id, location_id"),
  );
  const locationsByMembership = new Map<string, string[]>();
  for (const row of locationRows) {
    const membershipId = typeof row.membership_id === "string" ? row.membership_id : "";
    const locationId = typeof row.location_id === "string" ? row.location_id : "";
    if (!membershipId || !locationId) continue;
    const current = locationsByMembership.get(membershipId) ?? [];
    current.push(locationId);
    locationsByMembership.set(membershipId, current);
  }
  const staff = membershipRows.flatMap((row) => {
    const membershipId = typeof row.id === "string" ? row.id : "";
    const id = typeof row.user_id === "string" ? row.user_id : "";
    const name = asName(row.display_name);
    const role = asName(row.role);
    if (!membershipId || !id || !name) return [];
    return [
      {
        id,
        name,
        role,
        locationIds: locationsByMembership.get(membershipId) ?? [],
      },
    ];
  });
  return {
    identity,
    role,
    canCreate: canCreateAppointment({ role, isActive: true }),
    canCancel: canCancelAppointment({ role, isActive: true }),
    customers,
    services,
    staff,
  };
}
