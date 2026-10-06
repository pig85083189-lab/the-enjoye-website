/**
 * Async service application boundary for explicit real-service create.
 * Live Service Catalog UI still uses lib/services/store this phase.
 */

import { assertNonNegativeMoney } from "@/lib/commerce/money";
import {
  assertRemoteServiceAllowed,
  isBlockedRemoteServiceName,
  isGeneratedServiceAppId,
  REMOTE_DEMO_SERVICE_MESSAGE,
} from "@/lib/persistence/demo-firewall";
import {
  getOperationalPersistence,
  type ServicePersistence,
} from "@/lib/persistence";
import type { CreateServiceInput } from "@/lib/services/store";
import type { Service } from "@/types";
import type { TreatmentServiceType } from "@/types/treatment-template";

export type ServicePersistenceHost = { services: ServicePersistence } | ServicePersistence;

export interface RealServiceCreateInput {
  organizationId: string;
  name: string;
  durationMinutes: number;
  priceMinor: number;
  serviceType: TreatmentServiceType;
  createdByStaffId: string;
  category?: string;
  isActive?: boolean;
}

function servicesOf(
  persistence: ServicePersistenceHost,
): ServicePersistence {
  return "services" in persistence ? persistence.services : persistence;
}

export async function listPersistedServices(
  organizationId: string,
  opts?: { activeOnly?: boolean },
  persistence: ServicePersistenceHost = getOperationalPersistence(),
): Promise<Service[]> {
  return servicesOf(persistence).list(organizationId, opts);
}

export async function getPersistedService(
  organizationId: string,
  serviceId: string,
  persistence: ServicePersistenceHost = getOperationalPersistence(),
): Promise<Service | undefined> {
  return servicesOf(persistence).getById(organizationId, serviceId);
}

export function toCreateServiceInput(input: RealServiceCreateInput): CreateServiceInput {
  const name = input.name.trim();
  if (!name) throw new Error("service name required");
  if (!input.organizationId) throw new Error("organizationId is required");
  if (!input.serviceType) throw new Error("serviceType is required");
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new Error("durationMinutes must be an integer > 0");
  }
  assertNonNegativeMoney(input.priceMinor, "priceMinor");
  if (isBlockedRemoteServiceName(name)) {
    throw new Error(REMOTE_DEMO_SERVICE_MESSAGE);
  }
  return {
    name,
    category: input.category,
    durationMinutes: input.durationMinutes,
    priceMinor: input.priceMinor,
    isActive: input.isActive,
    serviceType: input.serviceType,
    createdByStaffId: input.createdByStaffId,
  };
}

export async function createServiceRecord(
  input: RealServiceCreateInput,
  persistence: ServicePersistenceHost = getOperationalPersistence(),
): Promise<Service> {
  const created = await servicesOf(persistence).create(
    input.organizationId,
    toCreateServiceInput(input),
  );
  if (!isGeneratedServiceAppId(created.id)) {
    throw new Error("Service app id must be generated via newId(\"svc\")");
  }
  assertRemoteServiceAllowed(created);
  return created;
}
