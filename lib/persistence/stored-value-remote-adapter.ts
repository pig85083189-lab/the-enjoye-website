import { DEFAULT_CURRENCY } from "@/lib/commerce/domain";
import { assertNonNegativeMoney } from "@/lib/commerce/money";
import { newId } from "@/lib/repositories/storage";
import type { StoredValueAccount, StoredValueLedgerEntry } from "@/lib/stored-value/domain";
import { assertNotDemoResiduePayload } from "./demo-firewall";
import type { CanonicalIdMapper } from "./identity-map";
import type { DbStoredValueAccount, DbStoredValueLedgerEntry, StoredValueTableStore } from "./operational-rows";

export interface RemoteStoredValueTopUpInput {
  customerId: string;
  amount: number;
  transactionId: string;
  locationId: string;
  createdByStaffId: string;
  effectKey: string;
}

export interface RemoteStoredValuePaymentInput extends RemoteStoredValueTopUpInput {
  appointmentId?: string;
}

export interface RemoteStoredValueAdjustmentInput {
  customerId: string;
  amountDelta: number;
  reason: string;
  locationId?: string;
  createdByStaffId: string;
  effectKey?: string;
}

export class StoredValueRemoteAdapter {
  constructor(
    private readonly mapper: CanonicalIdMapper,
    private readonly store: StoredValueTableStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getOrCreateAccount(
    organizationAppId: string,
    customerId: string,
    actorStaffId: string,
  ): Promise<StoredValueAccount> {
    this.mapper.requireOperationalStaffId(organizationAppId, actorStaffId);
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const customerDbId = this.mapper.resolveCustomerDbId(organizationAppId, customerId);
    const existing = this.store
      .listAccounts(orgDbId, customerDbId)
      .find((a) => a.status === "ACTIVE");
    if (existing) return this.toAccount(organizationAppId, existing);
    const stamp = this.now().toISOString();
    const appId = newId("sva");
    const row: DbStoredValueAccount = {
      id: crypto.randomUUID(),
      organization_id: orgDbId,
      customer_id: customerDbId,
      app_id: appId,
      currency: DEFAULT_CURRENCY,
      status: "ACTIVE",
      created_at: stamp,
      updated_at: stamp,
    };
    this.store.insertAccount(row);
    this.mapper.rememberStoredValueAccount(orgDbId, appId, row.id);
    return this.toAccount(organizationAppId, row);
  }

  async listLedger(
    organizationAppId: string,
    opts?: { accountId?: string; customerId?: string },
  ): Promise<StoredValueLedgerEntry[]> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const accountDbId = opts?.accountId
      ? this.mapper.resolveStoredValueAccountDbId(organizationAppId, opts.accountId)
      : undefined;
    const customerDbId = opts?.customerId
      ? this.mapper.resolveCustomerDbId(organizationAppId, opts.customerId)
      : undefined;
    return this.store
      .listStoredValueLedger(orgDbId, { accountDbId, customerDbId })
      .map((row) => this.toLedger(organizationAppId, row));
  }

  async customerBalance(organizationAppId: string, customerId: string): Promise<number> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const customerDbId = this.mapper.resolveCustomerDbId(organizationAppId, customerId);
    const account = this.store
      .listAccounts(orgDbId, customerDbId)
      .find((a) => a.status === "ACTIVE");
    if (!account) return 0;
    return this.sumAccount(orgDbId, account.id);
  }

  async postTopUp(
    organizationAppId: string,
    input: RemoteStoredValueTopUpInput,
  ): Promise<StoredValueLedgerEntry> {
    assertNotDemoResiduePayload(input);
    assertNonNegativeMoney(input.amount, "top-up amount");
    if (input.amount === 0) throw new Error("top-up amount cannot be zero");
    return this.appendSigned(organizationAppId, {
      ...input,
      type: "TOP_UP",
      amountDelta: input.amount,
    });
  }

  async postPayment(
    organizationAppId: string,
    input: RemoteStoredValuePaymentInput,
  ): Promise<StoredValueLedgerEntry> {
    assertNotDemoResiduePayload(input);
    assertNonNegativeMoney(input.amount, "payment amount");
    if (input.amount === 0) throw new Error("payment amount cannot be zero");
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const existing = this.store.findStoredValueLedgerByEffectKey(orgDbId, input.effectKey);
    if (existing) return this.toLedger(organizationAppId, existing);
    const balance = await this.customerBalance(organizationAppId, input.customerId);
    if (balance < input.amount) throw new Error("insufficient stored value balance");
    return this.appendSigned(organizationAppId, {
      ...input,
      type: "PAYMENT",
      amountDelta: -input.amount,
    });
  }

  async postAdjustment(
    organizationAppId: string,
    input: RemoteStoredValueAdjustmentInput,
  ): Promise<StoredValueLedgerEntry> {
    assertNotDemoResiduePayload(input);
    this.mapper.requireOperationalStaffId(organizationAppId, input.createdByStaffId);
    if (!input.reason.trim()) throw new Error("adjustment reason required");
    if (!Number.isInteger(input.amountDelta) || input.amountDelta === 0) {
      throw new Error("amountDelta must be non-zero integer");
    }
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    if (input.effectKey) {
      const existing = this.store.findStoredValueLedgerByEffectKey(orgDbId, input.effectKey);
      if (existing) return this.toLedger(organizationAppId, existing);
    }
    const account = await this.getOrCreateAccount(
      organizationAppId,
      input.customerId,
      input.createdByStaffId,
    );
    const locationDbId = input.locationId
      ? this.mapper.resolveLocationDbId(organizationAppId, input.locationId)
      : null;
    return this.insertLedger(organizationAppId, {
      accountAppId: account.id,
      customerId: input.customerId,
      type: "ADJUSTMENT",
      amountDelta: input.amountDelta,
      locationDbId,
      reason: input.reason.trim(),
      effectKey: input.effectKey ?? null,
      createdByStaffId: input.createdByStaffId,
    });
  }

  async reverseLedgerEntry(
    organizationAppId: string,
    entryAppId: string,
    actorStaffId: string,
    reason?: string,
  ): Promise<StoredValueLedgerEntry> {
    this.mapper.requireOperationalStaffId(organizationAppId, actorStaffId);
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const originalDbId = this.mapper.resolveStoredValueLedgerDbId(organizationAppId, entryAppId);
    const originalMapped = this.store.getStoredValueLedger(orgDbId, originalDbId);
    if (!originalMapped) throw new Error("Ledger entry not found");
    if (originalMapped.type === "REVERSAL") throw new Error("cannot reverse a reversal entry");
    const already = this.store
      .listStoredValueLedger(orgDbId)
      .find((e) => e.type === "REVERSAL" && e.reverses_entry_id === originalMapped.id);
    if (already) return this.toLedger(organizationAppId, already);
    const effectKey = `REV:SV:${entryAppId}`;
    const existing = this.store.findStoredValueLedgerByEffectKey(orgDbId, effectKey);
    if (existing) return this.toLedger(organizationAppId, existing);
    return this.insertLedger(organizationAppId, {
      accountDbId: originalMapped.account_id,
      customerDbId: originalMapped.customer_id,
      type: "REVERSAL",
      amountDelta: -originalMapped.amount_delta_minor,
      locationDbId: originalMapped.location_id,
      appointmentId: originalMapped.appointment_id,
      transactionId: originalMapped.transaction_id,
      reason: reason ?? `Reversal of ${entryAppId}`,
      effectKey,
      reversesEntryDbId: originalMapped.id,
      createdByStaffId: actorStaffId,
    });
  }

  private async appendSigned(
    organizationAppId: string,
    input: {
      customerId: string;
      type: "TOP_UP" | "PAYMENT";
      amountDelta: number;
      transactionId: string;
      locationId: string;
      appointmentId?: string;
      createdByStaffId: string;
      effectKey: string;
    },
  ): Promise<StoredValueLedgerEntry> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const existing = this.store.findStoredValueLedgerByEffectKey(orgDbId, input.effectKey);
    if (existing) return this.toLedger(organizationAppId, existing);
    const account = await this.getOrCreateAccount(
      organizationAppId,
      input.customerId,
      input.createdByStaffId,
    );
    const locationDbId = this.mapper.resolveLocationDbId(organizationAppId, input.locationId);
    return this.insertLedger(organizationAppId, {
      accountAppId: account.id,
      customerId: input.customerId,
      type: input.type,
      amountDelta: input.amountDelta,
      locationDbId,
      appointmentId: input.appointmentId ?? null,
      transactionId: input.transactionId,
      effectKey: input.effectKey,
      createdByStaffId: input.createdByStaffId,
    });
  }

  private insertLedger(
    organizationAppId: string,
    input: {
      accountAppId?: string;
      accountDbId?: string;
      customerId?: string;
      customerDbId?: string;
      type: DbStoredValueLedgerEntry["type"];
      amountDelta: number;
      locationDbId: string | null;
      appointmentId?: string | null;
      transactionId?: string | null;
      reason?: string | null;
      effectKey: string | null;
      reversesEntryDbId?: string | null;
      createdByStaffId: string;
    },
  ): StoredValueLedgerEntry {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationAppId);
    const accountDbId =
      input.accountDbId ??
      this.mapper.resolveStoredValueAccountDbId(organizationAppId, input.accountAppId!);
    const customerDbId =
      input.customerDbId ??
      this.mapper.resolveCustomerDbId(organizationAppId, input.customerId!);
    const nextBalance = this.sumAccount(orgDbId, accountDbId) + input.amountDelta;
    if (nextBalance < 0) throw new Error("insufficient stored value balance");
    const appId = newId("svl");
    const row: DbStoredValueLedgerEntry = {
      id: crypto.randomUUID(),
      organization_id: orgDbId,
      account_id: accountDbId,
      customer_id: customerDbId,
      app_id: appId,
      type: input.type,
      amount_delta_minor: input.amountDelta,
      transaction_id: input.transactionId ?? null,
      appointment_id: input.appointmentId ?? null,
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
    this.store.insertStoredValueLedger(row);
    this.mapper.rememberStoredValueLedger(orgDbId, appId, row.id);
    return this.toLedger(organizationAppId, row);
  }

  private sumAccount(organizationDbId: string, accountDbId: string): number {
    return this.store
      .listStoredValueLedger(organizationDbId, { accountDbId })
      .reduce((sum, e) => sum + e.amount_delta_minor, 0);
  }

  private toAccount(organizationAppId: string, row: DbStoredValueAccount): StoredValueAccount {
    return {
      id: row.app_id,
      organizationId: organizationAppId,
      customerId: this.mapper.toCustomerAppId(row.customer_id),
      currency: row.currency,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toLedger(organizationAppId: string, row: DbStoredValueLedgerEntry): StoredValueLedgerEntry {
    return {
      id: row.app_id,
      organizationId: organizationAppId,
      accountId: this.mapper.toStoredValueAccountAppId(row.account_id),
      customerId: this.mapper.toCustomerAppId(row.customer_id),
      type: row.type,
      amountDelta: row.amount_delta_minor,
      transactionId: row.transaction_id ?? undefined,
      appointmentId: row.appointment_id ?? undefined,
      locationId: row.location_id ? this.mapper.toLocationAppId(row.location_id) : undefined,
      reason: row.reason ?? undefined,
      effectKey: row.effect_key ?? undefined,
      reversesEntryId: row.reverses_entry_id
        ? this.mapper.toStoredValueLedgerAppId(row.reverses_entry_id)
        : undefined,
      createdByStaffId: this.mapper.toOperationalStaffId(organizationAppId, row.created_by_staff_id),
      createdAt: row.created_at,
    };
  }
}
