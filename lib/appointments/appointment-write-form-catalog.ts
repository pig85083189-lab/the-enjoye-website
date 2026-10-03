/**
 * Authenticated create-form options for the Appointment write pilot.
 * Names and duration come from remote rows, not Calendar UI text.
 */

import { IdentityCatalogError } from "@/lib/persistence/identity-errors";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentityQueryBuilder,
  type IdentityQueryResult,
  type IdentitySupabaseClient,
  type LoadedAuthenticatedIdentity,
} from "@/lib/persistence/authenticated-identity-catalog";
import { isAppointmentWritePilotOwner } from "./appointment-write-guard";

export type AppointmentWriteFormOption = {
  id: string;
  name: string;
};

export type AppointmentWriteServiceOption = AppointmentWriteFormOption & {
  durationMinutes: number;
};

export type AppointmentWriteFormCatalog = {
  identity: LoadedAuthenticatedIdentity;
  role: string;
  canCreate: boolean;
  customers: AppointmentWriteFormOption[];
  services: AppointmentWriteServiceOption[];
  staff: AppointmentWriteFormOption[];
};

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
    await readNamedRows(
      client
        .from("customers")
        .select("app_id, organization_id, full_name")
        .eq("organization_id", identity.organizationDbId),
    )
  ).flatMap((row) => {
    const id = typeof row.app_id === "string" ? row.app_id : "";
    const name = asName(row.full_name);
    if (!id || !name) return [];
    return [{ id, name }];
  });
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
  const staff = (
    await readNamedRows(
      client
        .from("staff_auth_memberships")
        .select("user_id, display_name, organization_id, is_active")
        .eq("organization_id", identity.organizationAppId),
    )
  ).flatMap((row) => {
    if (row.is_active === false) return [];
    const id = typeof row.user_id === "string" ? row.user_id : "";
    const name = asName(row.display_name);
    if (!id || !name) return [];
    return [{ id, name }];
  });
  return {
    identity,
    role,
    canCreate: isAppointmentWritePilotOwner(role),
    customers,
    services,
    staff,
  };
}
