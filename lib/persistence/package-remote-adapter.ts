import { DEFAULT_CURRENCY } from "@/lib/commerce/domain";
import { assertNonNegativeMoney } from "@/lib/commerce/money";
import {
  deriveCustomerPackageStatus,
  type CustomerPackage,
  type CustomerPackageStatus,
  type PackageDefinition,
  type PackageLedgerEntry,
  type PackageServiceEntitlement,
} from "@/lib/packages/domain";
import { newId } from "@/lib/repositories/storage";
import { assertNotDemoResiduePayload } from "./demo-firewall";
import type { CanonicalIdMapper } from "./identity-map";
import type {
  DbCustomerPackage,
  DbPackageDefinition,
  DbPackageLedgerEntry,
  PackageTableStore,
} from "./operational-rows";

export interface CreateRemotePackageDefinitionInput {
  name: string;
  description?: string;
  includedServiceIds: string[];
  sessionCount: number;
  priceMinor: number;
  validityDays?: number;
  createdByStaffId: string;
}

export interface CreateRemotePurchasedPackageInput {
  customerId: string;
  packageDefinitionId: string;
  purchaseTransactionId: string;
  locationId: string;
  createdByStaffId: string;
  effectKey: string;
}

export interface RedeemRemotePackageInput {
  customerPackageId: string;
  customerId: string;
  serviceId: string;
  locationId: string;
  appointmentId?: string;
  treatmentId?: string;
  transactionId: string;
  createdByStaffId: string;
  effectKey: string;
}

export class PackageRemoteAdapter {
  constructor(
    private readonly mapper: CanonicalIdMapper,
    private readonly store: PackageTableStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listDefinitions(organizationAppId: string): Promise<PackageDefinition[]> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    return this.store.listDefinitions(orgDbId).map((row) => this.toDefinition(organizationAppId, row));
  }

  async createDefinition(
    organizationAppId: string,
    input: CreateRemotePackageDefinitionInput,
  ): Promise<PackageDefinition> {
    assertNotDemoResiduePayload(input);
    this.mapper.requireOperationalStaffId(organizationAppId, input.createdByStaffId);
    if (!input.name.trim()) throw new Error("package name required");
    if (!Number.isInteger(input.sessionCount) || input.sessionCount < 1) {
      throw new Error("sessionCount must be integer >= 1");
    }
    assertNonNegativeMoney(input.priceMinor, "priceMinor");
    if (input.includedServiceIds.length === 0) {
      throw new Error("package requires at least one service");
    }
    const includedServices: PackageServiceEntitlement[] = input.includedServiceIds.map((serviceId) => {
      this.mapper.resolveServiceDbId(organizationAppId, serviceId);
      return { serviceId, sessionsPerRedemption: 1 as const };
    });
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const stamp = this.now().toISOString();
    const appId = newId("pkgdef");
    const row: DbPackageDefinition = {
      id: crypto.randomUUID(),
      organization_id: orgDbId,
      app_id: appId,
      name: input.name.trim(),
      description: input.description ?? null,
      included_services: includedServices,
      session_count: input.sessionCount,
      price_minor: input.priceMinor,
      currency: DEFAULT_CURRENCY,
      validity_days: input.validityDays ?? null,
      is_active: true,
      created_at: stamp,
      updated_at: stamp,
    };
    this.store.insertDefinition(row);
    this.mapper.rememberPackageDefinition(orgDbId, appId, row.id);
    return this.toDefinition(organizationAppId, row);
  }

  async listCustomerPackages(
    organizationAppId: string,
    opts?: { customerId?: string },
  ): Promise<CustomerPackage[]> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const customerDbId = opts?.customerId
      ? this.mapper.resolveCustomerDbId(organizationAppId, opts.customerId)
      : undefined;
    return this.store
      .listCustomerPackages(orgDbId, customerDbId)
      .map((row) => this.toCustomerPackage(organizationAppId, row));
  }

  async createPurchasedPackage(
    organizationAppId: string,
    input: CreateRemotePurchasedPackageInput,
  ): Promise<{ customerPackage: CustomerPackage; entry: PackageLedgerEntry }> {
    assertNotDemoResiduePayload(input);
    this.mapper.requireOperationalStaffId(organizationAppId, input.createdByStaffId);
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const customerDbId = this.mapper.resolveCustomerDbId(organizationAppId, input.customerId);
    const locationDbId = this.mapper.resolveLocationDbId(organizationAppId, input.locationId);
    const definitionDbId = this.mapper.resolvePackageDefinitionDbId(
      organizationAppId,
      input.packageDefinitionId,
    );
    const def = this.store.getDefinition(orgDbId, definitionDbId);
    if (!def || !def.is_active) throw new Error("Package definition not found or inactive");

    const existing = this.store.findPackageLedgerByEffectKey(orgDbId, input.effectKey);
    if (existing) {
      const pkg = this.store.getCustomerPackage(orgDbId, existing.customer_package_id);
      if (!pkg) throw new Error("Customer package missing for existing purchase");
      return {
        customerPackage: this.toCustomerPackage(organizationAppId, pkg),
        entry: this.toLedger(organizationAppId, existing),
      };
    }

    const stamp = this.now();
    const expiresAt =
      def.validity_days != null
        ? new Date(stamp.getTime() + def.validity_days * 86_400_000).toISOString()
        : null;
    const appId = newId("cpkg");
    const pkgRow: DbCustomerPackage = {
      id: crypto.randomUUID(),
      organization_id: orgDbId,
      customer_id: customerDbId,
      package_definition_id: def.id,
      purchase_transaction_id: input.purchaseTransactionId,
      app_id: appId,
      name_snapshot: def.name,
      session_count_snapshot: def.session_count,
      price_snapshot_minor: def.price_minor,
      included_service_ids_snapshot: def.included_services.map((s) => s.serviceId),
      purchased_at: stamp.toISOString(),
      activated_at: stamp.toISOString(),
      expires_at: expiresAt,
      status: "ACTIVE",
      created_at: stamp.toISOString(),
      updated_at: stamp.toISOString(),
    };
    this.store.insertCustomerPackage(pkgRow);
    this.mapper.rememberCustomerPackage(orgDbId, appId, pkgRow.id);

    const entry = this.insertLedger(organizationAppId, orgDbId, {
      customerPackageDbId: pkgRow.id,
      customerDbId,
      type: "PURCHASE",
      sessionDelta: def.session_count,
      locationDbId,
      transactionId: input.purchaseTransactionId,
      effectKey: input.effectKey,
      createdByStaffId: input.createdByStaffId,
    });
    return {
      customerPackage: this.toCustomerPackage(organizationAppId, pkgRow),
      entry,
    };
  }

  async ledgerBalance(organizationAppId: string, customerPackageAppId: string): Promise<number> {
    const rows = await this.listLedger(organizationAppId, {
      customerPackageId: customerPackageAppId,
    });
    return rows.reduce((sum, e) => sum + e.sessionDelta, 0);
  }

  async listLedger(
    organizationAppId: string,
    opts?: { customerPackageId?: string; customerId?: string },
  ): Promise<PackageLedgerEntry[]> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const customerPackageDbId = opts?.customerPackageId
      ? this.mapper.resolveCustomerPackageDbId(organizationAppId, opts.customerPackageId)
      : undefined;
    const customerDbId = opts?.customerId
      ? this.mapper.resolveCustomerDbId(organizationAppId, opts.customerId)
      : undefined;
    return this.store
      .listPackageLedger(orgDbId, { customerPackageDbId, customerDbId })
      .map((row) => this.toLedger(organizationAppId, row));
  }

  async usableBalance(
    organizationAppId: string,
    customerPackageAppId: string,
  ): Promise<{ ledgerBalance: number; usableBalance: number; status: CustomerPackageStatus }> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const pkgDbId = this.mapper.resolveCustomerPackageDbId(organizationAppId, customerPackageAppId);
    const pkg = this.store.getCustomerPackage(orgDbId, pkgDbId);
    if (!pkg) throw new Error("Customer package not found");
    const ledgerBalance = await this.ledgerBalance(organizationAppId, customerPackageAppId);
    const domainPkg = this.toCustomerPackage(organizationAppId, pkg);
    const status = deriveCustomerPackageStatus(domainPkg, ledgerBalance, this.now().getTime());
    const usableBalance = status === "ACTIVE" && ledgerBalance > 0 ? ledgerBalance : 0;
    return { ledgerBalance, usableBalance, status };
  }

  async redeemSession(
    organizationAppId: string,
    input: RedeemRemotePackageInput,
  ): Promise<PackageLedgerEntry> {
    assertNotDemoResiduePayload(input);
    this.mapper.requireOperationalStaffId(organizationAppId, input.createdByStaffId);
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const existing = this.store.findPackageLedgerByEffectKey(orgDbId, input.effectKey);
    if (existing) return this.toLedger(organizationAppId, existing);

    const customerDbId = this.mapper.resolveCustomerDbId(organizationAppId, input.customerId);
    const locationDbId = this.mapper.resolveLocationDbId(organizationAppId, input.locationId);
    this.mapper.resolveServiceDbId(organizationAppId, input.serviceId);
    const pkgDbId = this.mapper.resolveCustomerPackageDbId(organizationAppId, input.customerPackageId);
    const pkg = this.store.getCustomerPackage(orgDbId, pkgDbId);
    if (!pkg) throw new Error("Customer package not found");
    if (pkg.customer_id !== customerDbId) throw new Error("Package customer mismatch");

    const { usableBalance, status } = await this.usableBalance(
      organizationAppId,
      input.customerPackageId,
    );
    if (status === "EXPIRED") throw new Error("Package expired");
    if (status === "VOIDED") throw new Error("Package voided");
    if (usableBalance < 1) throw new Error("insufficient package sessions");
    if (!pkg.included_service_ids_snapshot.includes(input.serviceId)) {
      throw new Error("Service not eligible for this package");
    }

    const entry = this.insertLedger(organizationAppId, orgDbId, {
      customerPackageDbId: pkg.id,
      customerDbId,
      type: "REDEMPTION",
      sessionDelta: -1,
      serviceAppId: input.serviceId,
      locationDbId,
      appointmentId: input.appointmentId,
      treatmentId: input.treatmentId,
      transactionId: input.transactionId,
      effectKey: input.effectKey,
      createdByStaffId: input.createdByStaffId,
    });
    await this.syncStatus(organizationAppId, input.customerPackageId);
    return entry;
  }

  async reverseLedgerEntry(
    organizationAppId: string,
    entryAppId: string,
    actorStaffId: string,
    reason?: string,
  ): Promise<PackageLedgerEntry> {
    this.mapper.requireOperationalStaffId(organizationAppId, actorStaffId);
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const originalDbId = this.mapper.resolvePackageLedgerDbId(organizationAppId, entryAppId);
    const original = this.store.getPackageLedger(orgDbId, originalDbId);
    if (!original) throw new Error("Ledger entry not found");
    if (original.type === "REVERSAL") throw new Error("cannot reverse a reversal entry");

    const already = this.store
      .listPackageLedger(orgDbId, { customerPackageDbId: original.customer_package_id })
      .find((e) => e.type === "REVERSAL" && e.reverses_entry_id === original.id);
    if (already) return this.toLedger(organizationAppId, already);

    const effectKey = `REV:PKG:${entryAppId}`;
    const existing = this.store.findPackageLedgerByEffectKey(orgDbId, effectKey);
    if (existing) return this.toLedger(organizationAppId, existing);

    const pkgAppId = this.mapper.toCustomerPackageAppId(original.customer_package_id);
    const balance = await this.ledgerBalance(organizationAppId, pkgAppId);
    if (balance + -original.session_delta < 0) {
      throw new Error("package reversal would make balance negative");
    }

    const entry = this.insertLedger(organizationAppId, orgDbId, {
      customerPackageDbId: original.customer_package_id,
      customerDbId: original.customer_id,
      type: "REVERSAL",
      sessionDelta: -original.session_delta,
      serviceDbId: original.service_id,
      locationDbId: original.location_id,
      appointmentId: original.appointment_id ?? undefined,
      treatmentId: original.treatment_id ?? undefined,
      transactionId: original.transaction_id ?? undefined,
      effectKey,
      reversesEntryDbId: original.id,
      reason: reason ?? `Reversal of ${entryAppId}`,
      createdByStaffId: actorStaffId,
    });
    await this.syncStatus(organizationAppId, pkgAppId);
    return entry;
  }

  private async syncStatus(organizationAppId: string, customerPackageAppId: string): Promise<void> {
    const { status } = await this.usableBalance(organizationAppId, customerPackageAppId);
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const pkgDbId = this.mapper.resolveCustomerPackageDbId(organizationAppId, customerPackageAppId);
    const pkg = this.store.getCustomerPackage(orgDbId, pkgDbId);
    if (!pkg || pkg.status === status) return;
    this.store.updateCustomerPackageStatus(orgDbId, pkgDbId, status, this.now().toISOString());
  }

  private insertLedger(
    organizationAppId: string,
    orgDbId: string,
    input: {
      customerPackageDbId: string;
      customerDbId: string;
      type: DbPackageLedgerEntry["type"];
      sessionDelta: number;
      locationDbId: string | null;
      createdByStaffId: string;
      serviceAppId?: string;
      serviceDbId?: string | null;
      appointmentId?: string | null;
      treatmentId?: string | null;
      transactionId?: string | null;
      effectKey: string;
      reversesEntryDbId?: string | null;
      reason?: string | null;
    },
  ): PackageLedgerEntry {
    const appId = newId("plg");
    const row: DbPackageLedgerEntry = {
      id: crypto.randomUUID(),
      organization_id: orgDbId,
      customer_package_id: input.customerPackageDbId,
      customer_id: input.customerDbId,
      app_id: appId,
      type: input.type,
      session_delta: input.sessionDelta,
      service_id: input.serviceDbId ?? (input.serviceAppId
        ? this.mapper.resolveServiceDbId(organizationAppId, input.serviceAppId)
        : null),
      appointment_id: input.appointmentId ?? null,
      treatment_id: input.treatmentId ?? null,
      transaction_id: input.transactionId ?? null,
      location_id: input.locationDbId,
      reason: input.reason ?? null,
      effect_key: input.effectKey,
      reverses_entry_id: input.reversesEntryDbId ?? null,
      created_by_staff_id: this.mapper.requireOperationalStaffId(
        organizationAppId,
        input.createdByStaffId,
      ),
      created_at: this.now().toISOString(),
    };
    this.store.insertPackageLedger(row);
    this.mapper.rememberPackageLedger(orgDbId, appId, row.id);
    return this.toLedger(organizationAppId, row);
  }

  private toDefinition(organizationAppId: string, row: DbPackageDefinition): PackageDefinition {
    return {
      id: row.app_id,
      organizationId: organizationAppId,
      name: row.name,
      description: row.description ?? undefined,
      includedServices: row.included_services,
      sessionCount: row.session_count,
      priceMinor: row.price_minor,
      currency: row.currency,
      validityDays: row.validity_days ?? undefined,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toCustomerPackage(organizationAppId: string, row: DbCustomerPackage): CustomerPackage {
    return {
      id: row.app_id,
      organizationId: organizationAppId,
      customerId: this.mapper.toCustomerAppId(row.customer_id),
      packageDefinitionId: this.mapper.toPackageDefinitionAppId(row.package_definition_id),
      purchaseTransactionId: row.purchase_transaction_id ?? undefined,
      nameSnapshot: row.name_snapshot,
      sessionCountSnapshot: row.session_count_snapshot,
      priceSnapshot: row.price_snapshot_minor,
      includedServiceIdsSnapshot: row.included_service_ids_snapshot,
      purchasedAt: row.purchased_at,
      activatedAt: row.activated_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toLedger(organizationAppId: string, row: DbPackageLedgerEntry): PackageLedgerEntry {
    return {
      id: row.app_id,
      organizationId: organizationAppId,
      customerPackageId: this.mapper.toCustomerPackageAppId(row.customer_package_id),
      customerId: this.mapper.toCustomerAppId(row.customer_id),
      type: row.type,
      sessionDelta: row.session_delta,
      serviceId: row.service_id ? this.mapper.toServiceAppId(row.service_id) : undefined,
      appointmentId: row.appointment_id ?? undefined,
      treatmentId: row.treatment_id ?? undefined,
      transactionId: row.transaction_id ?? undefined,
      locationId: row.location_id ? this.mapper.toLocationAppId(row.location_id) : undefined,
      reason: row.reason ?? undefined,
      effectKey: row.effect_key ?? undefined,
      reversesEntryId: row.reverses_entry_id
        ? this.mapper.toPackageLedgerAppId(row.reverses_entry_id)
        : undefined,
      createdByStaffId: this.mapper.toOperationalStaffId(organizationAppId, row.created_by_staff_id),
      createdAt: row.created_at,
    };
  }
}
