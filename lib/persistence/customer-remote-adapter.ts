/**
 * Remote customer adapter. Not enabled in live UI.
 * Writes go through CanonicalIdMapper + demo firewall. No seed fallback.
 */

import { normalizePhone, phonesMatch } from "@/lib/phone";
import type { Customer } from "@/types";
import type { CustomerProfilePatch, OrgEntityQuery, OrgQuery } from "@/lib/repositories/interfaces";
import {
  assertRemoteCustomerAllowed,
} from "./demo-firewall";
import { UnmappedIdentityError } from "./identity-errors";
import type { CanonicalIdMapper } from "./identity-map";
import {
  birthdayToRemoteDate,
  customerFromRemoteRow,
  emptyToNull,
  remoteCustomerPayload,
  toRemoteCustomerStatus,
  toRemoteMembership,
} from "./customer-mapping";
import type { CustomerTableStore, DbCustomer } from "./operational-rows";

function requireOrgMatch(organizationAppId: string, customer: Pick<Customer, "organizationId" | "id">): void {
  if (!customer.organizationId) {
    throw new UnmappedIdentityError("organization", undefined, "");
  }
  if (customer.organizationId !== organizationAppId) {
    throw new UnmappedIdentityError("organization", organizationAppId, customer.organizationId);
  }
}

export class CustomerRemoteAdapter {
  constructor(
    private readonly mapper: CanonicalIdMapper,
    private readonly store: CustomerTableStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(query: OrgQuery): Promise<Customer[]> {
    const orgDbId = this.mapper.resolveOrganizationDbId(query.organizationId);
    return this.store
      .listCustomers(orgDbId)
      .map((row) => customerFromRemoteRow(query.organizationId, row));
  }

  async getById(query: OrgEntityQuery): Promise<Customer | undefined> {
    const orgDbId = this.mapper.resolveOrganizationDbId(query.organizationId);
    const row = this.store.getCustomerByAppId(orgDbId, query.id);
    if (!row) return undefined;
    return customerFromRemoteRow(query.organizationId, row);
  }

  async findByPhone(query: OrgQuery & { phone: string }): Promise<Customer[]> {
    const normalized = normalizePhone(query.phone);
    if (!normalized) return [];
    const orgDbId = this.mapper.resolveOrganizationDbId(query.organizationId);
    return this.store
      .listCustomers(orgDbId)
      .filter((row) => row.phone != null && phonesMatch(row.phone, normalized))
      .map((row) => customerFromRemoteRow(query.organizationId, row));
  }

  async upsert(customer: Customer): Promise<Customer> {
    assertRemoteCustomerAllowed(customer);
    requireOrgMatch(customer.organizationId, customer);
    const orgDbId = this.mapper.resolveOrganizationDbId(customer.organizationId);
    const existing = this.store.getCustomerByAppId(orgDbId, customer.id);
    const row = this.toRow(customer, orgDbId, existing);
    remoteCustomerPayload(row);
    if (existing) this.store.updateCustomer(row);
    else this.store.insertCustomer(row);
    this.mapper.rememberCustomer(orgDbId, row.app_id, row.id);
    return customerFromRemoteRow(customer.organizationId, row);
  }

  async updateProfile(
    organizationId: string,
    customerId: string,
    patch: CustomerProfilePatch,
  ): Promise<Customer> {
    const existing = await this.getById({ organizationId, id: customerId });
    if (!existing) throw new Error("Customer not found in organization");
    if (patch.id !== undefined && patch.id !== existing.id) {
      throw new Error("Customer id is immutable");
    }
    if (patch.organizationId !== undefined && patch.organizationId !== existing.organizationId) {
      throw new Error("Customer organizationId is immutable");
    }
    const next: Customer = {
      ...existing,
      ...patch,
      id: existing.id,
      organizationId: existing.organizationId,
      name: (patch.name ?? existing.name).trim(),
      phone: patch.phone ? normalizePhone(patch.phone) || patch.phone.trim() : existing.phone,
      updatedAt: this.now().toISOString(),
    };
    if (!next.name) throw new Error("姓名為必填");
    if (!next.phone) throw new Error("電話為必填");
    return this.upsert(next);
  }

  private toRow(customer: Customer, orgDbId: string, existing: DbCustomer | undefined): DbCustomer {
    const stamp = this.now().toISOString();
    const membership = toRemoteMembership(customer.membership);
    const primaryStaffId = customer.primaryStaffId
      ? this.mapper.requireOperationalStaffId(customer.organizationId, customer.primaryStaffId)
      : null;
    return {
      id: existing?.id ?? crypto.randomUUID(),
      organization_id: orgDbId,
      app_id: customer.id,
      full_name: customer.name.trim(),
      phone: emptyToNull(normalizePhone(customer.phone) || customer.phone),
      email: emptyToNull(customer.email),
      birthday: birthdayToRemoteDate(customer.birthday),
      gender: emptyToNull(customer.gender),
      line_user_id: emptyToNull(customer.lineId),
      source: emptyToNull(customer.source),
      membership_tier: membership.membership_tier,
      is_vip: membership.is_vip,
      primary_staff_id: primaryStaffId,
      status: toRemoteCustomerStatus(customer.listStatus),
      notes: null,
      created_at: existing?.created_at ?? customer.createdAt ?? stamp,
      updated_at: stamp,
    };
  }
}
