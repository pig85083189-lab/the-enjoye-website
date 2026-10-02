/**
 * Async customer application boundary.
 * One Customer domain — delegates to OperationalPersistence.customers.
 * Default persistence remains local. Phase 1C-3 list/detail may pass an
 * authenticated CustomerRemoteAdapter through the Phase 1C-3 read pilot.
 * Other live surfaces stay on localCustomerRepository.
 */

import { normalizePhone } from "@/lib/phone";
import { newId } from "@/lib/repositories/storage";
import type { CustomerProfilePatch } from "@/lib/repositories/interfaces";
import {
  assertRemoteCustomerAllowed,
  isGeneratedCustomerAppId,
} from "@/lib/persistence/demo-firewall";
import { birthdayToRemoteDate } from "@/lib/persistence/customer-mapping";
import {
  getOperationalPersistence,
  type CustomerPersistence,
} from "@/lib/persistence";
import type { Customer, MembershipTier } from "@/types";

export type CustomerPersistenceHost = { customers: CustomerPersistence } | CustomerPersistence;

export interface RealCustomerCreateInput {
  organizationId: string;
  name: string;
  phone: string;
  primaryStaffId: string;
  email?: string;
  lineId?: string;
  birthday?: string;
  gender?: Customer["gender"];
  source?: Customer["source"];
  membership?: MembershipTier;
}

function customersOf(
  persistence: CustomerPersistenceHost,
): CustomerPersistence {
  return "customers" in persistence ? persistence.customers : persistence;
}

export async function listCustomers(
  organizationId: string,
  persistence: CustomerPersistenceHost = getOperationalPersistence(),
): Promise<Customer[]> {
  return customersOf(persistence).list({ organizationId });
}

export async function getCustomer(
  organizationId: string,
  customerId: string,
  persistence: CustomerPersistenceHost = getOperationalPersistence(),
): Promise<Customer | undefined> {
  return customersOf(persistence).getById({ organizationId, id: customerId });
}

export async function findCustomersByPhone(
  organizationId: string,
  phone: string,
  persistence: CustomerPersistenceHost = getOperationalPersistence(),
): Promise<Customer[]> {
  return customersOf(persistence).findByPhone({ organizationId, phone });
}

export function buildRealCustomerCreate(input: RealCustomerCreateInput): Customer {
  const name = input.name.trim();
  const phone = normalizePhone(input.phone) || input.phone.trim();
  if (!name) throw new Error("姓名為必填");
  if (!phone) throw new Error("電話為必填");
  if (!input.organizationId) throw new Error("organizationId is required");
  if (!input.primaryStaffId) throw new Error("primaryStaffId is required");
  birthdayToRemoteDate(input.birthday);
  const id = newId("cust");
  if (!isGeneratedCustomerAppId(id)) {
    throw new Error("Customer app id must be generated via newId(\"cust\")");
  }
  const now = new Date().toISOString();
  const customer: Customer = {
    id,
    organizationId: input.organizationId,
    name,
    phone,
    birthday: input.birthday?.trim() ?? "",
    age: 0,
    membership: input.membership ?? "new",
    lastVisit: "",
    totalVisits: 0,
    packages: [],
    lastServiceNotes: [],
    trackingFocus: [],
    alerts: [],
    tags: [],
    email: input.email?.trim() || undefined,
    lineId: input.lineId?.trim() || undefined,
    gender: input.gender,
    source: input.source,
    primaryStaffId: input.primaryStaffId,
    joinedAt: now.slice(0, 10).replace(/-/g, "/"),
    listStatus: "normal",
    createdAt: now,
    updatedAt: now,
  };
  assertRemoteCustomerAllowed(customer);
  return customer;
}

export async function createCustomer(
  input: RealCustomerCreateInput,
  persistence: CustomerPersistenceHost = getOperationalPersistence(),
): Promise<Customer> {
  const port = customersOf(persistence);
  const customer = buildRealCustomerCreate(input);
  const existing = await port.getById({
    organizationId: customer.organizationId,
    id: customer.id,
  });
  if (existing) throw new Error("Customer id collision");
  return port.upsert(customer);
}

export async function updateCustomer(
  organizationId: string,
  customerId: string,
  patch: CustomerProfilePatch,
  persistence: CustomerPersistenceHost = getOperationalPersistence(),
): Promise<Customer> {
  if (patch.id && !isGeneratedCustomerAppId(patch.id) && patch.id.startsWith("demo-")) {
    throw new Error("Demo customer ids cannot be written");
  }
  return customersOf(persistence).updateProfile(organizationId, customerId, patch);
}
