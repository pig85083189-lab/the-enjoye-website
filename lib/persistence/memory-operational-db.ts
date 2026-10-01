/**
 * In-memory replica of the Phase 5A-1 operational tables.
 * Used only because no 100% non-production Supabase target exists in this environment.
 * Unique (organization_id, effect_key), no remaining/balance columns, org-scoped lookups.
 */

import type { IdentityCatalog, MappedOrgScoped, MappedOrganization, MappedStaff } from "./identity-catalog";
import { UniqueEffectKeyError } from "./identity-errors";
import type {
  DbAppointment,
  DbCustomer,
  DbCustomerPackage,
  DbPackageDefinition,
  DbPackageLedgerEntry,
  DbStoredValueAccount,
  DbStoredValueLedgerEntry,
  AppointmentTableStore,
  CustomerTableStore,
  PackageTableStore,
  StoredValueTableStore,
} from "./operational-rows";
import type { CustomerPackageStatus } from "@/lib/packages/domain";

function uuid(): string {
  return crypto.randomUUID();
}

interface OrgRow extends MappedOrganization {
  name: string;
}
interface ScopedRow extends MappedOrgScoped {
  name?: string;
}

export class MemoryOperationalDb
  implements IdentityCatalog, PackageTableStore, StoredValueTableStore, CustomerTableStore, AppointmentTableStore
{
  readonly organizations: OrgRow[] = [];
  readonly locations: ScopedRow[] = [];
  readonly customers: DbCustomer[] = [];
  readonly services: ScopedRow[] = [];
  readonly staff: MappedStaff[] = [];
  readonly appointments: DbAppointment[] = [];
  readonly packageDefinitions: DbPackageDefinition[] = [];
  readonly customerPackages: DbCustomerPackage[] = [];
  readonly packageLedger: DbPackageLedgerEntry[] = [];
  readonly storedValueAccounts: DbStoredValueAccount[] = [];
  readonly storedValueLedger: DbStoredValueLedgerEntry[] = [];

  seedOrganization(appId: string, name: string): OrgRow {
    const row = { dbId: uuid(), appId, name };
    this.organizations.push(row);
    return row;
  }

  seedLocation(organizationDbId: string, appId: string, name: string): ScopedRow {
    const row = { dbId: uuid(), appId, organizationDbId, name };
    this.locations.push(row);
    return row;
  }

  seedCustomer(organizationDbId: string, appId: string, name: string): MappedOrgScoped {
    const stamp = new Date().toISOString();
    const row: DbCustomer = {
      id: uuid(),
      organization_id: organizationDbId,
      app_id: appId,
      full_name: name,
      phone: null,
      email: null,
      birthday: null,
      gender: null,
      line_user_id: null,
      source: null,
      membership_tier: null,
      is_vip: false,
      primary_staff_id: null,
      status: "ACTIVE",
      notes: null,
      created_at: stamp,
      updated_at: stamp,
    };
    this.customers.push(row);
    return { dbId: row.id, appId: row.app_id, organizationDbId: row.organization_id };
  }

  seedService(organizationDbId: string, appId: string, name: string): ScopedRow {
    const row = { dbId: uuid(), appId, organizationDbId, name };
    this.services.push(row);
    return row;
  }

  /** Auth uuid is generated and must not equal operational staff app_id. */
  seedStaff(organizationDbId: string, staffAppId: string, role = "STAFF"): MappedStaff {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(staffAppId)) {
      throw new Error("operational staff app_id must not be an auth UUID");
    }
    const authUserId = uuid();
    if (authUserId === staffAppId) {
      throw new Error("generated auth uuid collided with staff app_id");
    }
    const row: MappedStaff = {
      membershipDbId: uuid(),
      profileDbId: authUserId,
      authUserId,
      staffAppId,
      organizationDbId,
      role,
    };
    this.staff.push(row);
    return row;
  }

  expireCustomerPackage(dbId: string, expiresAt: string): void {
    const row = this.customerPackages.find((p) => p.id === dbId);
    if (!row) throw new Error("customer package not found");
    row.expires_at = expiresAt;
    row.updated_at = expiresAt;
  }

  findOrganizationByAppId(appId: string) {
    return this.organizations.find((r) => r.appId === appId);
  }
  findOrganizationByDbId(dbId: string) {
    return this.organizations.find((r) => r.dbId === dbId);
  }
  findLocationByAppId(organizationDbId: string, appId: string) {
    return this.locations.find((r) => r.organizationDbId === organizationDbId && r.appId === appId);
  }
  findLocationByDbId(dbId: string) {
    return this.locations.find((r) => r.dbId === dbId);
  }
  findCustomerByAppId(organizationDbId: string, appId: string) {
    return this.toScoped(
      this.customers.find((r) => r.organization_id === organizationDbId && r.app_id === appId),
    );
  }
  findCustomerByDbId(dbId: string) {
    return this.toScoped(this.customers.find((r) => r.id === dbId));
  }
  findServiceByAppId(organizationDbId: string, appId: string) {
    return this.services.find((r) => r.organizationDbId === organizationDbId && r.appId === appId);
  }
  findServiceByDbId(dbId: string) {
    return this.services.find((r) => r.dbId === dbId);
  }
  findStaffByAppId(organizationDbId: string, staffAppId: string) {
    return this.staff.find((r) => r.organizationDbId === organizationDbId && r.staffAppId === staffAppId);
  }
  findStaffByProfileDbId(organizationDbId: string, profileDbId: string) {
    return this.staff.find(
      (r) => r.organizationDbId === organizationDbId && r.profileDbId === profileDbId,
    );
  }
  findStaffByAuthUserId(organizationDbId: string, authUserId: string) {
    return this.staff.find(
      (r) => r.organizationDbId === organizationDbId && r.authUserId === authUserId,
    );
  }

  findPackageDefinitionByAppId(organizationDbId: string, appId: string) {
    return this.toScoped(this.packageDefinitions.find((r) => r.organization_id === organizationDbId && r.app_id === appId));
  }
  findPackageDefinitionByDbId(dbId: string) {
    return this.toScoped(this.packageDefinitions.find((r) => r.id === dbId));
  }
  findCustomerPackageByAppId(organizationDbId: string, appId: string) {
    return this.toScoped(this.customerPackages.find((r) => r.organization_id === organizationDbId && r.app_id === appId));
  }
  findCustomerPackageByDbId(dbId: string) {
    return this.toScoped(this.customerPackages.find((r) => r.id === dbId));
  }
  findStoredValueAccountByAppId(organizationDbId: string, appId: string) {
    return this.toScoped(this.storedValueAccounts.find((r) => r.organization_id === organizationDbId && r.app_id === appId));
  }
  findStoredValueAccountByDbId(dbId: string) {
    return this.toScoped(this.storedValueAccounts.find((r) => r.id === dbId));
  }
  findPackageLedgerByAppId(organizationDbId: string, appId: string) {
    return this.toScoped(this.packageLedger.find((r) => r.organization_id === organizationDbId && r.app_id === appId));
  }
  findPackageLedgerByDbId(dbId: string) {
    return this.toScoped(this.packageLedger.find((r) => r.id === dbId));
  }
  findStoredValueLedgerByAppId(organizationDbId: string, appId: string) {
    return this.toScoped(this.storedValueLedger.find((r) => r.organization_id === organizationDbId && r.app_id === appId));
  }
  findStoredValueLedgerByDbId(dbId: string) {
    return this.toScoped(this.storedValueLedger.find((r) => r.id === dbId));
  }

  insertDefinition(row: DbPackageDefinition): void {
    this.packageDefinitions.push(row);
  }
  listDefinitions(organizationDbId: string) {
    return this.packageDefinitions.filter((r) => r.organization_id === organizationDbId);
  }
  getDefinition(organizationDbId: string, dbId: string) {
    return this.packageDefinitions.find((r) => r.organization_id === organizationDbId && r.id === dbId);
  }
  insertCustomerPackage(row: DbCustomerPackage): void {
    this.customerPackages.push(row);
  }
  listCustomerPackages(organizationDbId: string, customerDbId?: string) {
    return this.customerPackages.filter(
      (r) =>
        r.organization_id === organizationDbId &&
        (customerDbId ? r.customer_id === customerDbId : true),
    );
  }
  getCustomerPackage(organizationDbId: string, dbId: string) {
    return this.customerPackages.find((r) => r.organization_id === organizationDbId && r.id === dbId);
  }
  updateCustomerPackageStatus(
    organizationDbId: string,
    dbId: string,
    status: CustomerPackageStatus,
    updatedAt: string,
  ): void {
    const row = this.getCustomerPackage(organizationDbId, dbId);
    if (!row) throw new Error("Customer package not found");
    row.status = status;
    row.updated_at = updatedAt;
  }
  insertPackageLedger(row: DbPackageLedgerEntry): void {
    this.assertEffectKey(row.organization_id, row.effect_key, "package");
    this.packageLedger.push(row);
  }
  listPackageLedger(
    organizationDbId: string,
    opts?: { customerPackageDbId?: string; customerDbId?: string },
  ) {
    return this.packageLedger
      .filter((r) => r.organization_id === organizationDbId)
      .filter((r) => (opts?.customerPackageDbId ? r.customer_package_id === opts.customerPackageDbId : true))
      .filter((r) => (opts?.customerDbId ? r.customer_id === opts.customerDbId : true))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  findPackageLedgerByEffectKey(organizationDbId: string, effectKey: string) {
    return this.packageLedger.find(
      (r) => r.organization_id === organizationDbId && r.effect_key === effectKey,
    );
  }
  getPackageLedger(organizationDbId: string, dbId: string) {
    return this.packageLedger.find((r) => r.organization_id === organizationDbId && r.id === dbId);
  }

  insertAccount(row: DbStoredValueAccount): void {
    this.storedValueAccounts.push(row);
  }
  listAccounts(organizationDbId: string, customerDbId?: string) {
    return this.storedValueAccounts.filter(
      (r) =>
        r.organization_id === organizationDbId &&
        (customerDbId ? r.customer_id === customerDbId : true),
    );
  }
  getAccount(organizationDbId: string, dbId: string) {
    return this.storedValueAccounts.find((r) => r.organization_id === organizationDbId && r.id === dbId);
  }
  insertStoredValueLedger(row: DbStoredValueLedgerEntry): void {
    this.assertEffectKey(row.organization_id, row.effect_key, "stored_value");
    this.storedValueLedger.push(row);
  }
  listStoredValueLedger(
    organizationDbId: string,
    opts?: { accountDbId?: string; customerDbId?: string },
  ) {
    return this.storedValueLedger
      .filter((r) => r.organization_id === organizationDbId)
      .filter((r) => (opts?.accountDbId ? r.account_id === opts.accountDbId : true))
      .filter((r) => (opts?.customerDbId ? r.customer_id === opts.customerDbId : true))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  findStoredValueLedgerByEffectKey(organizationDbId: string, effectKey: string) {
    return this.storedValueLedger.find(
      (r) => r.organization_id === organizationDbId && r.effect_key === effectKey,
    );
  }
  getStoredValueLedger(organizationDbId: string, dbId: string) {
    return this.storedValueLedger.find((r) => r.organization_id === organizationDbId && r.id === dbId);
  }

  insertCustomer(row: DbCustomer): void {
    this.customers.push(row);
  }
  updateCustomer(row: DbCustomer): void {
    const idx = this.customers.findIndex((r) => r.id === row.id);
    if (idx < 0) throw new Error("customer not found");
    this.customers[idx] = row;
  }
  listCustomers(organizationDbId: string) {
    return this.customers.filter((r) => r.organization_id === organizationDbId);
  }
  getCustomerByAppId(organizationDbId: string, appId: string) {
    return this.customers.find((r) => r.organization_id === organizationDbId && r.app_id === appId);
  }
  getCustomerByDbId(dbId: string) {
    return this.customers.find((r) => r.id === dbId);
  }
  findCustomersByPhone(organizationDbId: string, phone: string) {
    return this.customers.filter(
      (r) => r.organization_id === organizationDbId && r.phone === phone,
    );
  }

  insertAppointment(row: DbAppointment): void {
    this.appointments.push(row);
  }
  listAppointments(organizationDbId: string) {
    return this.appointments.filter((r) => r.organization_id === organizationDbId);
  }
  getAppointmentByAppId(organizationDbId: string, appId: string) {
    return this.appointments.find(
      (r) => r.organization_id === organizationDbId && r.app_id === appId,
    );
  }
  getAppointmentByDbId(dbId: string) {
    return this.appointments.find((r) => r.id === dbId);
  }

  private assertEffectKey(organizationDbId: string, effectKey: string | null, kind: string): void {
    if (!effectKey) return;
    const exists =
      kind === "package"
        ? this.findPackageLedgerByEffectKey(organizationDbId, effectKey)
        : this.findStoredValueLedgerByEffectKey(organizationDbId, effectKey);
    if (exists) throw new UniqueEffectKeyError();
  }

  private toScoped(
    row:
      | { id: string; app_id: string; organization_id: string }
      | undefined,
  ): MappedOrgScoped | undefined {
    if (!row) return undefined;
    return { dbId: row.id, appId: row.app_id, organizationDbId: row.organization_id };
  }
}
