/**
 * In-memory IdentityCatalog snapshot.
 * Built from authenticated reads or test fixtures. Not a second SoT.
 */

import { IdentityCatalogError } from "./identity-errors";
import type {
  IdentityCatalog,
  MappedOrganization,
  MappedOrgScoped,
  MappedStaff,
} from "./identity-catalog";

function uniqueOrThrow<T>(
  rows: T[],
  kind: string,
  key: string,
): T | undefined {
  if (rows.length === 0) return undefined;
  if (rows.length > 1) {
    throw new IdentityCatalogError(
      "ambiguous_mapping",
      `Ambiguous ${kind} mapping for ${JSON.stringify(key)}`,
    );
  }
  return rows[0];
}

export class SnapshotIdentityCatalog implements IdentityCatalog {
  constructor(
    private readonly organizations: MappedOrganization[] = [],
    private readonly locations: MappedOrgScoped[] = [],
    private readonly customers: MappedOrgScoped[] = [],
    private readonly services: MappedOrgScoped[] = [],
    private readonly staff: MappedStaff[] = [],
    private readonly packageDefinitions: MappedOrgScoped[] = [],
    private readonly customerPackages: MappedOrgScoped[] = [],
    private readonly storedValueAccounts: MappedOrgScoped[] = [],
    private readonly packageLedger: MappedOrgScoped[] = [],
    private readonly storedValueLedger: MappedOrgScoped[] = [],
  ) {}

  findOrganizationByAppId(appId: string) {
    return uniqueOrThrow(
      this.organizations.filter((r) => r.appId === appId),
      "organization",
      appId,
    );
  }
  findOrganizationByDbId(dbId: string) {
    return uniqueOrThrow(
      this.organizations.filter((r) => r.dbId === dbId),
      "organization",
      dbId,
    );
  }

  findLocationByAppId(organizationDbId: string, appId: string) {
    return uniqueOrThrow(
      this.locations.filter(
        (r) => r.organizationDbId === organizationDbId && r.appId === appId,
      ),
      "location",
      appId,
    );
  }
  findLocationByDbId(dbId: string) {
    return uniqueOrThrow(
      this.locations.filter((r) => r.dbId === dbId),
      "location",
      dbId,
    );
  }

  findCustomerByAppId(organizationDbId: string, appId: string) {
    return uniqueOrThrow(
      this.customers.filter(
        (r) => r.organizationDbId === organizationDbId && r.appId === appId,
      ),
      "customer",
      appId,
    );
  }
  findCustomerByDbId(dbId: string) {
    return uniqueOrThrow(
      this.customers.filter((r) => r.dbId === dbId),
      "customer",
      dbId,
    );
  }

  findServiceByAppId(organizationDbId: string, appId: string) {
    return uniqueOrThrow(
      this.services.filter(
        (r) => r.organizationDbId === organizationDbId && r.appId === appId,
      ),
      "service",
      appId,
    );
  }
  findServiceByDbId(dbId: string) {
    return uniqueOrThrow(
      this.services.filter((r) => r.dbId === dbId),
      "service",
      dbId,
    );
  }

  findStaffByAppId(organizationDbId: string, staffAppId: string) {
    return uniqueOrThrow(
      this.staff.filter(
        (r) => r.organizationDbId === organizationDbId && r.staffAppId === staffAppId,
      ),
      "staff",
      staffAppId,
    );
  }
  findStaffByProfileDbId(organizationDbId: string, profileDbId: string) {
    return uniqueOrThrow(
      this.staff.filter(
        (r) => r.organizationDbId === organizationDbId && r.profileDbId === profileDbId,
      ),
      "staff_profile",
      profileDbId,
    );
  }
  findStaffByAuthUserId(organizationDbId: string, authUserId: string) {
    return uniqueOrThrow(
      this.staff.filter(
        (r) => r.organizationDbId === organizationDbId && r.authUserId === authUserId,
      ),
      "staff_auth",
      authUserId,
    );
  }

  findPackageDefinitionByAppId(organizationDbId: string, appId: string) {
    return uniqueOrThrow(
      this.packageDefinitions.filter(
        (r) => r.organizationDbId === organizationDbId && r.appId === appId,
      ),
      "package_definition",
      appId,
    );
  }
  findPackageDefinitionByDbId(dbId: string) {
    return uniqueOrThrow(
      this.packageDefinitions.filter((r) => r.dbId === dbId),
      "package_definition",
      dbId,
    );
  }
  findCustomerPackageByAppId(organizationDbId: string, appId: string) {
    return uniqueOrThrow(
      this.customerPackages.filter(
        (r) => r.organizationDbId === organizationDbId && r.appId === appId,
      ),
      "customer_package",
      appId,
    );
  }
  findCustomerPackageByDbId(dbId: string) {
    return uniqueOrThrow(
      this.customerPackages.filter((r) => r.dbId === dbId),
      "customer_package",
      dbId,
    );
  }
  findStoredValueAccountByAppId(organizationDbId: string, appId: string) {
    return uniqueOrThrow(
      this.storedValueAccounts.filter(
        (r) => r.organizationDbId === organizationDbId && r.appId === appId,
      ),
      "stored_value_account",
      appId,
    );
  }
  findStoredValueAccountByDbId(dbId: string) {
    return uniqueOrThrow(
      this.storedValueAccounts.filter((r) => r.dbId === dbId),
      "stored_value_account",
      dbId,
    );
  }
  findPackageLedgerByAppId(organizationDbId: string, appId: string) {
    return uniqueOrThrow(
      this.packageLedger.filter(
        (r) => r.organizationDbId === organizationDbId && r.appId === appId,
      ),
      "package_ledger_entry",
      appId,
    );
  }
  findPackageLedgerByDbId(dbId: string) {
    return uniqueOrThrow(
      this.packageLedger.filter((r) => r.dbId === dbId),
      "package_ledger_entry",
      dbId,
    );
  }
  findStoredValueLedgerByAppId(organizationDbId: string, appId: string) {
    return uniqueOrThrow(
      this.storedValueLedger.filter(
        (r) => r.organizationDbId === organizationDbId && r.appId === appId,
      ),
      "stored_value_ledger_entry",
      appId,
    );
  }
  findStoredValueLedgerByDbId(dbId: string) {
    return uniqueOrThrow(
      this.storedValueLedger.filter((r) => r.dbId === dbId),
      "stored_value_ledger_entry",
      dbId,
    );
  }
}
