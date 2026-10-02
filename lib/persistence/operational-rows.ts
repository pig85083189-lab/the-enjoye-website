import type { PackageLedgerType, PackageServiceEntitlement } from "@/lib/packages/domain";
import type { StoredValueAccountStatus, StoredValueLedgerType } from "@/lib/stored-value/domain";
import type { CustomerPackageStatus } from "@/lib/packages/domain";

export interface DbPackageDefinition {
  id: string;
  organization_id: string;
  app_id: string;
  name: string;
  description: string | null;
  included_services: PackageServiceEntitlement[];
  session_count: number;
  price_minor: number;
  currency: string;
  validity_days: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbCustomerPackage {
  id: string;
  organization_id: string;
  customer_id: string;
  package_definition_id: string;
  purchase_transaction_id: string | null;
  app_id: string;
  name_snapshot: string;
  session_count_snapshot: number;
  price_snapshot_minor: number;
  included_service_ids_snapshot: string[];
  purchased_at: string;
  activated_at: string | null;
  expires_at: string | null;
  status: CustomerPackageStatus;
  created_at: string;
  updated_at: string;
}

export interface DbPackageLedgerEntry {
  id: string;
  organization_id: string;
  customer_package_id: string;
  customer_id: string;
  app_id: string;
  type: PackageLedgerType;
  session_delta: number;
  service_id: string | null;
  appointment_id: string | null;
  treatment_id: string | null;
  transaction_id: string | null;
  location_id: string | null;
  reason: string | null;
  effect_key: string | null;
  reverses_entry_id: string | null;
  created_by_staff_id: string;
  created_at: string;
}

export interface DbStoredValueAccount {
  id: string;
  organization_id: string;
  customer_id: string;
  app_id: string;
  currency: string;
  status: StoredValueAccountStatus;
  created_at: string;
  updated_at: string;
}

export interface DbStoredValueLedgerEntry {
  id: string;
  organization_id: string;
  account_id: string;
  customer_id: string;
  app_id: string;
  type: StoredValueLedgerType;
  amount_delta_minor: number;
  transaction_id: string | null;
  appointment_id: string | null;
  location_id: string | null;
  reason: string | null;
  effect_key: string | null;
  reverses_entry_id: string | null;
  created_by_staff_id: string;
  created_at: string;
}

export interface PackageTableStore {
  insertDefinition(row: DbPackageDefinition): void;
  listDefinitions(organizationDbId: string): DbPackageDefinition[];
  getDefinition(organizationDbId: string, dbId: string): DbPackageDefinition | undefined;
  insertCustomerPackage(row: DbCustomerPackage): void;
  listCustomerPackages(organizationDbId: string, customerDbId?: string): DbCustomerPackage[];
  getCustomerPackage(organizationDbId: string, dbId: string): DbCustomerPackage | undefined;
  updateCustomerPackageStatus(
    organizationDbId: string,
    dbId: string,
    status: CustomerPackageStatus,
    updatedAt: string,
  ): void;
  insertPackageLedger(row: DbPackageLedgerEntry): void;
  listPackageLedger(
    organizationDbId: string,
    opts?: { customerPackageDbId?: string; customerDbId?: string },
  ): DbPackageLedgerEntry[];
  findPackageLedgerByEffectKey(
    organizationDbId: string,
    effectKey: string,
  ): DbPackageLedgerEntry | undefined;
  getPackageLedger(organizationDbId: string, dbId: string): DbPackageLedgerEntry | undefined;
}

export interface StoredValueTableStore {
  insertAccount(row: DbStoredValueAccount): void;
  listAccounts(organizationDbId: string, customerDbId?: string): DbStoredValueAccount[];
  getAccount(organizationDbId: string, dbId: string): DbStoredValueAccount | undefined;
  insertStoredValueLedger(row: DbStoredValueLedgerEntry): void;
  listStoredValueLedger(
    organizationDbId: string,
    opts?: { accountDbId?: string; customerDbId?: string },
  ): DbStoredValueLedgerEntry[];
  findStoredValueLedgerByEffectKey(
    organizationDbId: string,
    effectKey: string,
  ): DbStoredValueLedgerEntry | undefined;
  getStoredValueLedger(
    organizationDbId: string,
    dbId: string,
  ): DbStoredValueLedgerEntry | undefined;
}

export type RemoteCustomerStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";

export interface DbCustomer {
  id: string;
  organization_id: string;
  app_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  gender: string | null;
  line_user_id: string | null;
  source: string | null;
  membership_tier: string | null;
  is_vip: boolean;
  primary_staff_id: string | null;
  status: RemoteCustomerStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbAppointment {
  id: string;
  organization_id: string;
  location_id: string | null;
  customer_id: string;
  service_id: string;
  staff_id: string | null;
  app_id: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number | null;
  status: string;
  customer_note: string | null;
  internal_note: string | null;
  customer_name_snapshot: string | null;
  service_name_snapshot: string | null;
  staff_name_snapshot: string | null;
  status_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type MaybePromise<T> = T | Promise<T>;

export interface CustomerTableStore {
  insertCustomer(row: DbCustomer): MaybePromise<void>;
  updateCustomer(row: DbCustomer): MaybePromise<void>;
  listCustomers(organizationDbId: string): MaybePromise<DbCustomer[]>;
  getCustomerByAppId(organizationDbId: string, appId: string): MaybePromise<DbCustomer | undefined>;
  getCustomerByDbId(dbId: string): MaybePromise<DbCustomer | undefined>;
  findCustomersByPhone(organizationDbId: string, phone: string): MaybePromise<DbCustomer[]>;
}

export interface AppointmentTableStore {
  insertAppointment(row: DbAppointment): void;
  listAppointments(organizationDbId: string): DbAppointment[];
  getAppointmentByAppId(organizationDbId: string, appId: string): DbAppointment | undefined;
  getAppointmentByDbId(dbId: string): DbAppointment | undefined;
}

export type RemoteServiceType =
  | "BREAST"
  | "BODY_SCULPTING"
  | "FACIAL"
  | "WOMB_CARE"
  | "DETOX"
  | "NAVEL_CANDLE"
  | "EXFOLIATION"
  | "WAXING"
  | "OTHER";

export interface DbService {
  id: string;
  organization_id: string;
  app_id: string;
  name: string;
  service_type: RemoteServiceType;
  duration_minutes: number;
  price_minor: number | null;
  currency: string;
  category: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServiceTableStore {
  insertService(row: DbService): MaybePromise<void>;
  updateService(row: DbService): MaybePromise<void>;
  listServices(organizationDbId: string): MaybePromise<DbService[]>;
  getServiceByAppId(organizationDbId: string, appId: string): MaybePromise<DbService | undefined>;
  getServiceByDbId(dbId: string): MaybePromise<DbService | undefined>;
}
