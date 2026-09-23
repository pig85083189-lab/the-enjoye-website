import type { Customer } from "@/types";
import { SEED_CUSTOMERS } from "./seed-crm";
import { SEED_LUMIERE_CUSTOMERS } from "./seed-organizations";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";

/** Seed + SSR fallback. Client prefers LocalCustomerRepository. */
export const mockCustomers: Customer[] = SEED_CUSTOMERS;

function seedByOrg(organizationId: string): Customer[] {
  if (organizationId === ORG_ENJOYE_ID) return SEED_CUSTOMERS;
  if (organizationId === ORG_LUMIERE_ID) return SEED_LUMIERE_CUSTOMERS;
  return [];
}

/** Tenant-scoped customer lookup. organizationId is required — no active-org fallback. */
export function getCustomerById(
  id: string,
  organizationId: string,
): Customer | undefined {
  if (typeof window !== "undefined") {
    return localCustomerRepository.getById({ organizationId, id });
  }
  return seedByOrg(organizationId).find((customer) => customer.id === id);
}
