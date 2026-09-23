import type { CustomerConsultation } from "@/types/customer";
import type { ConsultationRepository, OrgCustomerQuery, OrgEntityQuery } from "./interfaces";
import { SEED_CONSULTATIONS } from "@/data/seed-crm";
import { SEED_LUMIERE_CONSULTATIONS } from "@/data/seed-organizations";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";
import { normalizeOrganizationEntity } from "@/lib/tenant/access";
import { readTenantJson, writeTenantJson } from "./tenant-read";

function seedForOrganization(organizationId: string): CustomerConsultation[] {
  if (organizationId === ORG_ENJOYE_ID) return SEED_CONSULTATIONS;
  if (organizationId === ORG_LUMIERE_ID) return SEED_LUMIERE_CONSULTATIONS;
  return [];
}

function mergeWithSeed(
  existing: CustomerConsultation[],
  organizationId: string,
): CustomerConsultation[] {
  const seeds = seedForOrganization(organizationId);
  const byId = new Map<string, CustomerConsultation>();
  for (const seed of seeds) byId.set(seed.id, seed);
  for (const raw of existing) {
    const stamped = normalizeOrganizationEntity(raw, organizationId);
    if (stamped.organizationId !== organizationId) continue;
    byId.set(stamped.id, { ...stamped, organizationId });
  }
  return Array.from(byId.values()).filter((c) => c.organizationId === organizationId);
}

function readAll(organizationId: string): CustomerConsultation[] {
  if (typeof window === "undefined") return [...seedForOrganization(organizationId)];
  const existing = readTenantJson<CustomerConsultation[] | null>(
    organizationId,
    "consultations",
    null,
  );
  if (existing && Array.isArray(existing) && existing.length > 0) {
    return mergeWithSeed(existing, organizationId);
  }
  return [...seedForOrganization(organizationId)];
}

export class LocalConsultationRepository implements ConsultationRepository {
  listByCustomer(query: OrgCustomerQuery): CustomerConsultation[] {
    return readAll(query.organizationId)
      .filter((c) => c.customerId === query.customerId)
      .sort((a, b) => b.consultedAt.localeCompare(a.consultedAt));
  }

  getById(query: OrgEntityQuery): CustomerConsultation | undefined {
    return readAll(query.organizationId).find((c) => c.id === query.id);
  }

  create(consultation: CustomerConsultation): CustomerConsultation {
    if (!consultation.organizationId) {
      throw new Error("Consultation.organizationId is required");
    }
    const all = readAll(consultation.organizationId);
    writeTenantJson(
      consultation.organizationId,
      "consultations",
      [consultation, ...all],
      "consultations",
    );
    return consultation;
  }
}

export const localConsultationRepository = new LocalConsultationRepository();
