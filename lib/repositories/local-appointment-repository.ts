import type { AppointmentStatus } from "@/types";
import type { CrmAppointment, CrmAppointmentStatus } from "@/types/customer";
import type { AppointmentRepository, OrgCustomerQuery, OrgEntityQuery } from "./interfaces";
import { SEED_CRM_APPOINTMENTS } from "@/data/seed-crm";
import { SEED_LUMIERE_CRM_APPOINTMENTS } from "@/data/seed-organizations";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";
import { normalizeOrganizationEntity } from "@/lib/tenant/access";
import { readTenantJson } from "./tenant-read";

/**
 * @deprecated CRM appointment snapshots — NOT the schedule source of truth.
 * Calendar / Today / Checkout use `lib/appointments/store` (ScheduleAppointment).
 * Do not wire new UI to this repository for operational scheduling.
 */

function mapLiveStatus(status: AppointmentStatus): CrmAppointmentStatus {
  if (status === "pending") return "booked";
  if (status === "in_progress") return "in_progress";
  return "completed";
}

function seedForOrganization(organizationId: string): CrmAppointment[] {
  if (organizationId === ORG_ENJOYE_ID) return SEED_CRM_APPOINTMENTS;
  if (organizationId === ORG_LUMIERE_ID) return SEED_LUMIERE_CRM_APPOINTMENTS;
  return [];
}

function mergeWithSeed(
  existing: CrmAppointment[],
  organizationId: string,
): CrmAppointment[] {
  const seeds = seedForOrganization(organizationId);
  const byId = new Map<string, CrmAppointment>();
  for (const seed of seeds) byId.set(seed.id, seed);
  for (const raw of existing) {
    const stamped = normalizeOrganizationEntity(raw, organizationId);
    if (stamped.organizationId !== organizationId) continue;
    byId.set(stamped.id, { ...stamped, organizationId });
  }
  return Array.from(byId.values()).filter((a) => a.organizationId === organizationId);
}

function readAll(organizationId: string): CrmAppointment[] {
  if (typeof window === "undefined") return [...seedForOrganization(organizationId)];
  const existing = readTenantJson<CrmAppointment[] | null>(
    organizationId,
    "appointments",
    null,
  );
  if (existing && Array.isArray(existing) && existing.length > 0) {
    return mergeWithSeed(existing, organizationId);
  }
  return [...seedForOrganization(organizationId)];
}

function withLiveStatus(
  organizationId: string,
  list: CrmAppointment[],
): CrmAppointment[] {
  if (typeof window === "undefined") return list;
  const overlay = readTenantJson<Record<string, AppointmentStatus>>(
    organizationId,
    "appointment-status",
    {},
  );
  return list.map((apt) => {
    const live = overlay[apt.id];
    if (!live) return apt;
    return { ...apt, status: mapLiveStatus(live) };
  });
}

export class LocalAppointmentRepository implements AppointmentRepository {
  listByCustomer(query: OrgCustomerQuery): CrmAppointment[] {
    const all = withLiveStatus(query.organizationId, readAll(query.organizationId));
    return all
      .filter((a) => a.customerId === query.customerId)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  }

  getById(query: OrgEntityQuery): CrmAppointment | undefined {
    return withLiveStatus(query.organizationId, readAll(query.organizationId)).find(
      (a) => a.id === query.id,
    );
  }
}

export const localAppointmentRepository = new LocalAppointmentRepository();
