/**
 * Remote service adapter. Not enabled in live UI.
 * Explicit create/upsert only — never called from appointment insert.
 */

import { assertNonNegativeMoney } from "@/lib/commerce/money";
import { newId } from "@/lib/repositories/storage";
import type { CreateServiceInput } from "@/lib/services/store";
import type { Service } from "@/types";
import { assertRemoteServiceAllowed } from "./demo-firewall";
import { UnmappedIdentityError } from "./identity-errors";
import type { CanonicalIdMapper } from "./identity-map";
import type { DbService, ServiceTableStore } from "./operational-rows";
import {
  remoteServicePayload,
  serviceFromRemoteRow,
  toRemoteServiceType,
} from "./service-mapping";

function assertName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("service name required");
  return trimmed;
}

function assertDuration(durationMinutes: number): number {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error("durationMinutes must be an integer > 0");
  }
  return durationMinutes;
}

export class ServiceRemoteAdapter {
  constructor(
    private readonly mapper: CanonicalIdMapper,
    private readonly store: ServiceTableStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(organizationId: string, opts?: { activeOnly?: boolean }): Promise<Service[]> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationId);
    let rows = this.store.listServices(orgDbId).map((row) => serviceFromRemoteRow(organizationId, row));
    if (opts?.activeOnly) rows = rows.filter((row) => row.isActive !== false);
    return rows;
  }

  async getById(organizationId: string, serviceId: string): Promise<Service | undefined> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationId);
    const row = this.store.getServiceByAppId(orgDbId, serviceId);
    if (!row) return undefined;
    return serviceFromRemoteRow(organizationId, row);
  }

  async create(organizationId: string, input: CreateServiceInput): Promise<Service> {
    this.mapper.requireOperationalStaffId(organizationId, input.createdByStaffId);
    const service: Service = {
      id: newId("svc"),
      organizationId,
      name: assertName(input.name),
      durationMinutes: assertDuration(input.durationMinutes),
      category: input.category?.trim() ?? "",
      serviceType: input.serviceType ?? "GENERIC",
      priceMinor: assertNonNegativeMoney(input.priceMinor, "priceMinor"),
      isActive: input.isActive !== false,
    };
    return this.upsert(organizationId, service, input.createdByStaffId);
  }

  async upsert(organizationId: string, service: Service, actorStaffId: string): Promise<Service> {
    if (service.organizationId !== organizationId) {
      throw new UnmappedIdentityError("organization", organizationId, service.organizationId);
    }
    assertRemoteServiceAllowed(service);
    this.mapper.requireOperationalStaffId(organizationId, actorStaffId);
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationId);
    const existing = this.store.getServiceByAppId(orgDbId, service.id);
    const stamp = this.now().toISOString();
    const row: DbService = {
      id: existing?.id ?? crypto.randomUUID(),
      organization_id: orgDbId,
      app_id: service.id,
      name: assertName(service.name),
      service_type: toRemoteServiceType(service.serviceType),
      duration_minutes: assertDuration(service.durationMinutes),
      price_minor:
        service.priceMinor === undefined
          ? null
          : assertNonNegativeMoney(service.priceMinor, "priceMinor"),
      currency: existing?.currency ?? "TWD",
      category: service.category?.trim() || null,
      is_active: service.isActive !== false,
      created_at: existing?.created_at ?? stamp,
      updated_at: stamp,
    };
    remoteServicePayload(row);
    if (existing) this.store.updateService(row);
    else this.store.insertService(row);
    this.mapper.rememberService(orgDbId, row.app_id, row.id);
    return serviceFromRemoteRow(organizationId, row);
  }
}
