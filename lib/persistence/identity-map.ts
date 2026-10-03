/**
 * Canonical ID mapper. Session/request scoped cache only.
 * uuid + app_id in the catalog is mapping truth — the cache is not a second SoT.
 */

import { isAuthUuid } from "@/lib/staff-auth/staff-id";
import type { IdentityCatalog } from "./identity-catalog";
import { UnmappedIdentityError } from "./identity-errors";

type CacheKey = string;

export class CanonicalIdMapper {
  private readonly cache = new Map<CacheKey, string>();

  constructor(private readonly catalog: IdentityCatalog) {}

  clearCache(): void {
    this.cache.clear();
  }

  resolveOrganizationDbId(organizationAppId: string): string {
    return this.cached(`org:${organizationAppId}`, () => {
      const row = this.catalog.findOrganizationByAppId(organizationAppId);
      if (!row) throw new UnmappedIdentityError("organization", undefined, organizationAppId);
      this.cache.set(`orgDb:${row.dbId}`, row.appId);
      return row.dbId;
    });
  }

  toOrganizationAppId(organizationDbId: string): string {
    return this.cached(`orgDb:${organizationDbId}`, () => {
      const row = this.catalog.findOrganizationByDbId(organizationDbId);
      if (!row) throw new UnmappedIdentityError("organization", undefined, organizationDbId);
      this.cache.set(`org:${row.appId}`, row.dbId);
      return row.appId;
    });
  }

  resolveLocationDbId(organizationAppId: string, locationAppId: string): string {
    const orgDbId = this.resolveOrganizationDbId(organizationAppId);
    return this.cached(`loc:${orgDbId}:${locationAppId}`, () => {
      const row = this.catalog.findLocationByAppId(orgDbId, locationAppId);
      if (!row) throw new UnmappedIdentityError("location", organizationAppId, locationAppId);
      return row.dbId;
    });
  }

  toLocationAppId(locationDbId: string): string {
    return this.cached(`locDb:${locationDbId}`, () => {
      const row = this.catalog.findLocationByDbId(locationDbId);
      if (!row) throw new UnmappedIdentityError("location", undefined, locationDbId);
      return row.appId;
    });
  }

  resolveCustomerDbId(organizationAppId: string, customerAppId: string): string {
    const orgDbId = this.resolveOrganizationDbId(organizationAppId);
    return this.cached(`cust:${orgDbId}:${customerAppId}`, () => {
      const row = this.catalog.findCustomerByAppId(orgDbId, customerAppId);
      if (!row) throw new UnmappedIdentityError("customer", organizationAppId, customerAppId);
      return row.dbId;
    });
  }

  toCustomerAppId(customerDbId: string): string {
    return this.cached(`custDb:${customerDbId}`, () => {
      const row = this.catalog.findCustomerByDbId(customerDbId);
      if (!row) throw new UnmappedIdentityError("customer", undefined, customerDbId);
      return row.appId;
    });
  }

  resolveServiceDbId(organizationAppId: string, serviceAppId: string): string {
    const orgDbId = this.resolveOrganizationDbId(organizationAppId);
    return this.cached(`svc:${orgDbId}:${serviceAppId}`, () => {
      const row = this.catalog.findServiceByAppId(orgDbId, serviceAppId);
      if (!row) throw new UnmappedIdentityError("service", organizationAppId, serviceAppId);
      return row.dbId;
    });
  }

  toServiceAppId(serviceDbId: string): string {
    return this.cached(`svcDb:${serviceDbId}`, () => {
      const row = this.catalog.findServiceByDbId(serviceDbId);
      if (!row) throw new UnmappedIdentityError("service", undefined, serviceDbId);
      return row.appId;
    });
  }

  /**
   * Auth profile lookup only (profiles.id).
   * Never write this value into Appointment.staffId or created_by_staff_id.
   */
  resolveStaffProfileDbId(organizationAppId: string, staffAppId: string): string {
    const profileDbId = this.resolveStaff(organizationAppId, staffAppId).profileDbId;
    if (!profileDbId) {
      throw new UnmappedIdentityError("staff_profile", organizationAppId, staffAppId);
    }
    if (profileDbId === staffAppId) {
      throw new UnmappedIdentityError("staff_profile_collision", organizationAppId, staffAppId);
    }
    return profileDbId;
  }

  resolveStaffMembershipDbId(organizationAppId: string, staffAppId: string): string {
    return this.resolveStaff(organizationAppId, staffAppId).membershipDbId;
  }

  /**
   * Operational staff-* identity for domain / ledger columns.
   * Rejects auth UUIDs. Does not rewrite staff-001 to a profile uuid.
   */
  requireOperationalStaffId(organizationAppId: string, staffAppId: string): string {
    if (isAuthUuid(staffAppId)) {
      throw new UnmappedIdentityError("operational_staff_auth_uuid", organizationAppId, staffAppId);
    }
    const row = this.resolveStaff(organizationAppId, staffAppId);
    if (row.staffAppId !== staffAppId) {
      throw new UnmappedIdentityError("staff", organizationAppId, staffAppId);
    }
    if (row.profileDbId === staffAppId || row.authUserId === staffAppId) {
      throw new UnmappedIdentityError("staff_profile_collision", organizationAppId, staffAppId);
    }
    return row.staffAppId;
  }

  /** Reverse map from a stored operational staff-* column. */
  toOperationalStaffId(organizationAppId: string, storedStaffId: string): string {
    return this.requireOperationalStaffId(organizationAppId, storedStaffId);
  }

  /**
   * Auth UUID → operational staff-* via membership.auth_user_id.
   * Never returns the Auth UUID. Fails closed if unmapped or colliding.
   */
  resolveOperationalStaffFromAuth(
    organizationAppId: string,
    authUserId: string,
  ): string {
    if (!isAuthUuid(authUserId)) {
      throw new UnmappedIdentityError("auth_user", organizationAppId, authUserId);
    }
    const orgDbId = this.resolveOrganizationDbId(organizationAppId);
    const row = this.catalog.findStaffByAuthUserId(orgDbId, authUserId);
    if (!row) throw new UnmappedIdentityError("staff_auth", organizationAppId, authUserId);
    return this.requireOperationalStaffId(organizationAppId, row.staffAppId);
  }

  /** Reverse map from auth profile uuid → staff-*. Not for operational columns. */
  toStaffAppId(organizationAppId: string, profileDbId: string): string {
    const orgDbId = this.resolveOrganizationDbId(organizationAppId);
    return this.cached(`staffProf:${orgDbId}:${profileDbId}`, () => {
      const row = this.catalog.findStaffByProfileDbId(orgDbId, profileDbId);
      if (!row) throw new UnmappedIdentityError("staff_profile", organizationAppId, profileDbId);
      return row.staffAppId;
    });
  }

  resolvePackageDefinitionDbId(organizationAppId: string, definitionAppId: string): string {
    const orgDbId = this.resolveOrganizationDbId(organizationAppId);
    return this.cached(`pkgdef:${orgDbId}:${definitionAppId}`, () => {
      const row = this.catalog.findPackageDefinitionByAppId(orgDbId, definitionAppId);
      if (!row) {
        throw new UnmappedIdentityError("package_definition", organizationAppId, definitionAppId);
      }
      return row.dbId;
    });
  }

  toPackageDefinitionAppId(dbId: string): string {
    return this.cached(`pkgdefDb:${dbId}`, () => {
      const row = this.catalog.findPackageDefinitionByDbId(dbId);
      if (!row) throw new UnmappedIdentityError("package_definition", undefined, dbId);
      return row.appId;
    });
  }

  resolveCustomerPackageDbId(organizationAppId: string, packageAppId: string): string {
    const orgDbId = this.resolveOrganizationDbId(organizationAppId);
    return this.cached(`cpkg:${orgDbId}:${packageAppId}`, () => {
      const row = this.catalog.findCustomerPackageByAppId(orgDbId, packageAppId);
      if (!row) {
        throw new UnmappedIdentityError("customer_package", organizationAppId, packageAppId);
      }
      return row.dbId;
    });
  }

  toCustomerPackageAppId(dbId: string): string {
    return this.cached(`cpkgDb:${dbId}`, () => {
      const row = this.catalog.findCustomerPackageByDbId(dbId);
      if (!row) throw new UnmappedIdentityError("customer_package", undefined, dbId);
      return row.appId;
    });
  }

  resolveStoredValueAccountDbId(organizationAppId: string, accountAppId: string): string {
    const orgDbId = this.resolveOrganizationDbId(organizationAppId);
    return this.cached(`sva:${orgDbId}:${accountAppId}`, () => {
      const row = this.catalog.findStoredValueAccountByAppId(orgDbId, accountAppId);
      if (!row) {
        throw new UnmappedIdentityError("stored_value_account", organizationAppId, accountAppId);
      }
      return row.dbId;
    });
  }

  toStoredValueAccountAppId(dbId: string): string {
    return this.cached(`svaDb:${dbId}`, () => {
      const row = this.catalog.findStoredValueAccountByDbId(dbId);
      if (!row) throw new UnmappedIdentityError("stored_value_account", undefined, dbId);
      return row.appId;
    });
  }

  toPackageLedgerAppId(dbId: string): string {
    return this.cached(`plgDb:${dbId}`, () => {
      const row = this.catalog.findPackageLedgerByDbId(dbId);
      if (!row) throw new UnmappedIdentityError("package_ledger_entry", undefined, dbId);
      return row.appId;
    });
  }

  resolvePackageLedgerDbId(organizationAppId: string, ledgerAppId: string): string {
    const orgDbId = this.resolveOrganizationDbId(organizationAppId);
    return this.cached(`plg:${orgDbId}:${ledgerAppId}`, () => {
      const row = this.catalog.findPackageLedgerByAppId(orgDbId, ledgerAppId);
      if (!row) {
        throw new UnmappedIdentityError("package_ledger_entry", organizationAppId, ledgerAppId);
      }
      return row.dbId;
    });
  }

  toStoredValueLedgerAppId(dbId: string): string {
    return this.cached(`svlDb:${dbId}`, () => {
      const row = this.catalog.findStoredValueLedgerByDbId(dbId);
      if (!row) throw new UnmappedIdentityError("stored_value_ledger_entry", undefined, dbId);
      return row.appId;
    });
  }

  resolveStoredValueLedgerDbId(organizationAppId: string, ledgerAppId: string): string {
    const orgDbId = this.resolveOrganizationDbId(organizationAppId);
    return this.cached(`svl:${orgDbId}:${ledgerAppId}`, () => {
      const row = this.catalog.findStoredValueLedgerByAppId(orgDbId, ledgerAppId);
      if (!row) {
        throw new UnmappedIdentityError("stored_value_ledger_entry", organizationAppId, ledgerAppId);
      }
      return row.dbId;
    });
  }

  rememberCustomer(organizationDbId: string, appId: string, dbId: string): void {
    this.cache.set(`cust:${organizationDbId}:${appId}`, dbId);
    this.cache.set(`custDb:${dbId}`, appId);
  }

  rememberService(organizationDbId: string, appId: string, dbId: string): void {
    this.cache.set(`svc:${organizationDbId}:${appId}`, dbId);
    this.cache.set(`svcDb:${dbId}`, appId);
  }

  rememberAppointment(organizationDbId: string, appId: string, dbId: string): void {
    this.cache.set(`apt:${organizationDbId}:${appId}`, dbId);
    this.cache.set(`aptDb:${dbId}`, appId);
  }

  rememberPackageDefinition(organizationDbId: string, appId: string, dbId: string): void {
    this.cache.set(`pkgdef:${organizationDbId}:${appId}`, dbId);
    this.cache.set(`pkgdefDb:${dbId}`, appId);
  }

  rememberCustomerPackage(organizationDbId: string, appId: string, dbId: string): void {
    this.cache.set(`cpkg:${organizationDbId}:${appId}`, dbId);
    this.cache.set(`cpkgDb:${dbId}`, appId);
  }

  rememberStoredValueAccount(organizationDbId: string, appId: string, dbId: string): void {
    this.cache.set(`sva:${organizationDbId}:${appId}`, dbId);
    this.cache.set(`svaDb:${dbId}`, appId);
  }

  rememberPackageLedger(organizationDbId: string, appId: string, dbId: string): void {
    this.cache.set(`plg:${organizationDbId}:${appId}`, dbId);
    this.cache.set(`plgDb:${dbId}`, appId);
  }

  rememberStoredValueLedger(organizationDbId: string, appId: string, dbId: string): void {
    this.cache.set(`svl:${organizationDbId}:${appId}`, dbId);
    this.cache.set(`svlDb:${dbId}`, appId);
  }

  private resolveStaff(organizationAppId: string, staffAppId: string) {
    const orgDbId = this.resolveOrganizationDbId(organizationAppId);
    const cachedStaff = this.cache.get(`staffApp:${orgDbId}:${staffAppId}`);
    const cachedMembership = this.cache.get(`staffMemApp:${orgDbId}:${staffAppId}`);
    if (cachedStaff && cachedMembership) {
      const cachedProfile = this.cache.get(`staffProfApp:${orgDbId}:${staffAppId}`) ?? null;
      const cachedAuth = this.cache.get(`staffAuthApp:${orgDbId}:${staffAppId}`) ?? null;
      return {
        staffAppId: cachedStaff,
        membershipDbId: cachedMembership,
        profileDbId: cachedProfile,
        authUserId: cachedAuth,
      };
    }
    const row = this.catalog.findStaffByAppId(orgDbId, staffAppId);
    if (!row) throw new UnmappedIdentityError("staff", organizationAppId, staffAppId);
    if (isAuthUuid(row.staffAppId) || row.staffAppId !== staffAppId) {
      throw new UnmappedIdentityError("staff_profile_collision", organizationAppId, staffAppId);
    }
    if (row.profileDbId && row.profileDbId === staffAppId) {
      throw new UnmappedIdentityError("staff_profile_collision", organizationAppId, staffAppId);
    }
    this.cache.set(`staffApp:${orgDbId}:${staffAppId}`, row.staffAppId);
    this.cache.set(`staffMemApp:${orgDbId}:${staffAppId}`, row.membershipDbId);
    if (row.profileDbId) {
      this.cache.set(`staffProfApp:${orgDbId}:${staffAppId}`, row.profileDbId);
      this.cache.set(`staffProf:${orgDbId}:${row.profileDbId}`, row.staffAppId);
    }
    if (row.authUserId) {
      this.cache.set(`staffAuthApp:${orgDbId}:${staffAppId}`, row.authUserId);
    }
    return row;
  }

  private cached(key: CacheKey, compute: () => string): string {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const value = compute();
    this.cache.set(key, value);
    return value;
  }
}
