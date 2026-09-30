/**
 * Identity catalog — the only layer allowed to resolve app_id ↔ uuid.
 * Adapters must not query app_id themselves.
 *
 * Mapping truth is DB uuid + app_id. This is not a business SoT.
 */

export interface MappedOrganization {
  dbId: string;
  appId: string;
}

export interface MappedOrgScoped {
  dbId: string;
  appId: string;
  organizationDbId: string;
}

export interface MappedStaff {
  membershipDbId: string;
  /**
   * Auth profile id (profiles.id = auth.users.id). Never an operational staffId.
   * Null when this membership has no Auth profile row yet.
   */
  profileDbId: string | null;
  /** auth.users.id mapped through membership.auth_user_id */
  authUserId: string | null;
  /** Beauty OS operational identity: staff-001 / staff-* */
  staffAppId: string;
  organizationDbId: string;
  role: string;
}

export interface IdentityCatalog {
  findOrganizationByAppId(appId: string): MappedOrganization | undefined;
  findOrganizationByDbId(dbId: string): MappedOrganization | undefined;

  findLocationByAppId(organizationDbId: string, appId: string): MappedOrgScoped | undefined;
  findLocationByDbId(dbId: string): MappedOrgScoped | undefined;

  findCustomerByAppId(organizationDbId: string, appId: string): MappedOrgScoped | undefined;
  findCustomerByDbId(dbId: string): MappedOrgScoped | undefined;

  findServiceByAppId(organizationDbId: string, appId: string): MappedOrgScoped | undefined;
  findServiceByDbId(dbId: string): MappedOrgScoped | undefined;

  findStaffByAppId(organizationDbId: string, staffAppId: string): MappedStaff | undefined;
  findStaffByProfileDbId(organizationDbId: string, profileDbId: string): MappedStaff | undefined;

  findPackageDefinitionByAppId(organizationDbId: string, appId: string): MappedOrgScoped | undefined;
  findPackageDefinitionByDbId(dbId: string): MappedOrgScoped | undefined;

  findCustomerPackageByAppId(organizationDbId: string, appId: string): MappedOrgScoped | undefined;
  findCustomerPackageByDbId(dbId: string): MappedOrgScoped | undefined;

  findStoredValueAccountByAppId(organizationDbId: string, appId: string): MappedOrgScoped | undefined;
  findStoredValueAccountByDbId(dbId: string): MappedOrgScoped | undefined;

  findPackageLedgerByAppId(organizationDbId: string, appId: string): MappedOrgScoped | undefined;
  findPackageLedgerByDbId(dbId: string): MappedOrgScoped | undefined;

  findStoredValueLedgerByAppId(organizationDbId: string, appId: string): MappedOrgScoped | undefined;
  findStoredValueLedgerByDbId(dbId: string): MappedOrgScoped | undefined;
}
