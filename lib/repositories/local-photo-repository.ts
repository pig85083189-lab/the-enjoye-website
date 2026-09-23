import type { CustomerPhoto } from "@/types/customer";
import type { CustomerPhotoRepository, OrgCustomerQuery } from "./interfaces";
import { SEED_PHOTOS } from "@/data/seed-crm";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import { normalizeOrganizationEntity } from "@/lib/tenant/access";
import { readTenantJson } from "./tenant-read";

function seedForOrganization(organizationId: string): CustomerPhoto[] {
  if (organizationId === ORG_ENJOYE_ID) return SEED_PHOTOS;
  return [];
}

function mergeWithSeed(existing: CustomerPhoto[], organizationId: string): CustomerPhoto[] {
  const seeds = seedForOrganization(organizationId);
  const byId = new Map<string, CustomerPhoto>();
  for (const seed of seeds) byId.set(seed.id, seed);
  for (const raw of existing) {
    const stamped = normalizeOrganizationEntity(raw, organizationId);
    if (stamped.organizationId !== organizationId) continue;
    byId.set(stamped.id, { ...stamped, organizationId });
  }
  return Array.from(byId.values()).filter((p) => p.organizationId === organizationId);
}

function readAll(organizationId: string): CustomerPhoto[] {
  if (typeof window === "undefined") return [...seedForOrganization(organizationId)];
  const existing = readTenantJson<CustomerPhoto[] | null>(
    organizationId,
    "customer-photos",
    null,
  );
  if (existing && Array.isArray(existing) && existing.length > 0) {
    return mergeWithSeed(existing, organizationId);
  }
  return [...seedForOrganization(organizationId)];
}

export class LocalCustomerPhotoRepository implements CustomerPhotoRepository {
  listByCustomer(query: OrgCustomerQuery): CustomerPhoto[] {
    return readAll(query.organizationId)
      .filter((p) => p.customerId === query.customerId)
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  }
}

export const localCustomerPhotoRepository = new LocalCustomerPhotoRepository();
