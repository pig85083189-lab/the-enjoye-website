import type { Customer } from "@/types";
import type { CustomerRepository, OrgEntityQuery, OrgQuery } from "./interfaces";
import { SEED_CUSTOMERS } from "@/data/seed-crm";
import { SEED_LUMIERE_CUSTOMERS } from "@/data/seed-organizations";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";
import { normalizeOrganizationEntity } from "@/lib/tenant/access";
import { normalizePhone, phonesMatch } from "@/lib/phone";
import { readTenantJson, writeTenantJson } from "./tenant-read";

function seedForOrganization(organizationId: string): Customer[] {
  if (organizationId === ORG_ENJOYE_ID) return SEED_CUSTOMERS;
  if (organizationId === ORG_LUMIERE_ID) return SEED_LUMIERE_CUSTOMERS;
  return [];
}

function createMinimalDefaults(
  raw: Partial<Customer>,
  organizationId: string,
): Customer {
  const now = new Date().toISOString();
  return {
    id: raw.id ?? "unknown",
    organizationId,
    name: raw.name ?? "",
    phone: raw.phone ?? "",
    birthday: raw.birthday ?? "",
    age: raw.age ?? 0,
    membership: raw.membership ?? "new",
    lastVisit: raw.lastVisit ?? "",
    totalVisits: raw.totalVisits ?? 0,
    packages: [],
    lastServiceNotes: [],
    trackingFocus: [],
    alerts: [],
    tags: [],
    joinedAt: now.slice(0, 10).replace(/-/g, "/"),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeList(list: Customer[], organizationId: string): Customer[] {
  const seeds = seedForOrganization(organizationId);
  const seedMap = new Map(seeds.map((c) => [c.id, c]));
  const byId = new Map<string, Customer>();

  for (const seed of seeds) {
    byId.set(seed.id, { ...seed, packages: [] });
  }

  for (const raw of list) {
    const stamped = normalizeOrganizationEntity(raw, organizationId);
    if (stamped.organizationId !== organizationId) continue;
    const seed = seedMap.get(stamped.id);
    byId.set(stamped.id, {
      ...(seed ?? createMinimalDefaults(stamped, organizationId)),
      ...stamped,
      organizationId,
      tags: stamped.tags?.length ? stamped.tags : (seed?.tags ?? []),
      packages: [],
      lastServiceNotes: stamped.lastServiceNotes ?? seed?.lastServiceNotes ?? [],
      trackingFocus: stamped.trackingFocus ?? seed?.trackingFocus ?? [],
      alerts: stamped.alerts ?? seed?.alerts ?? [],
      joinedAt: stamped.joinedAt ?? seed?.joinedAt ?? stamped.createdAt ?? new Date().toISOString(),
      createdAt: stamped.createdAt ?? seed?.createdAt ?? new Date().toISOString(),
      updatedAt: stamped.updatedAt ?? seed?.updatedAt ?? new Date().toISOString(),
    });
  }

  return Array.from(byId.values()).filter((c) => c.organizationId === organizationId);
}

function readAll(organizationId: string): Customer[] {
  if (typeof window === "undefined") {
    // Fail-closed: never expose seed packages[] as balance SoT (SSR / hydration)
    return seedForOrganization(organizationId).map((c) => ({ ...c, packages: [] }));
  }
  const existing = readTenantJson<Customer[] | null>(organizationId, "customers", null);
  if (existing && Array.isArray(existing) && existing.length > 0) {
    return normalizeList(existing, organizationId);
  }
  return normalizeList([...seedForOrganization(organizationId)], organizationId);
}

export class LocalCustomerRepository implements CustomerRepository {
  list(query: OrgQuery): Customer[] {
    return readAll(query.organizationId);
  }

  getById(query: OrgEntityQuery): Customer | undefined {
    return this.list(query).find((c) => c.id === query.id);
  }

  upsert(customer: Customer): Customer {
    if (!customer.organizationId) {
      throw new Error("Customer.organizationId is required");
    }
    const list = this.list({ organizationId: customer.organizationId });
    const idx = list.findIndex((c) => c.id === customer.id);
    const next = [...list];
    if (idx >= 0) next[idx] = customer;
    else next.unshift(customer);
    writeTenantJson(customer.organizationId, "customers", next, "customers");
    return customer;
  }

  findByPhone(query: OrgQuery & { phone: string }): Customer[] {
    const normalized = normalizePhone(query.phone);
    if (!normalized) return [];
    return this.list(query).filter((c) => phonesMatch(c.phone, normalized));
  }
}

export const localCustomerRepository = new LocalCustomerRepository();
