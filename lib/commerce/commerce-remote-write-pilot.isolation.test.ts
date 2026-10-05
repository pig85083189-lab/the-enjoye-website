import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FUTURE_QA_APPOINTMENT } from "@/lib/appointments/remote-readiness";
import { COMMERCE_REMOTE_READ_PILOT_ENV } from "./commerce-remote-read-flag";
import { COMMERCE_REMOTE_WRITE_PILOT_ENV } from "./commerce-remote-write-flag";
import {
  COMMERCE_HYDRATE_RPC,
  COMMERCE_SAVE_RPC,
  COMMERCE_SETTLE_RPC,
  type CommerceEngineSnapshot,
  hydrateCheckoutFromTreatment,
  saveCheckoutDraft,
  settleCheckoutDraft,
} from "./commerce-remote-engine";
import {
  COMMERCE_MISSING_SERVICE_PRICE_MESSAGE,
  COMMERCE_PAYMENT_MISMATCH_MESSAGE,
  COMMERCE_PAYMENT_UNAVAILABLE_MESSAGE,
  COMMERCE_TREATMENT_NOT_COMPLETED_MESSAGE,
  COMMERCE_WRITE_FORBIDDEN_MESSAGE,
  COMMERCE_WRITE_PILOT_OFF_MESSAGE,
  CommerceWritePilotDeniedError,
} from "./commerce-remote-write-errors";
import {
  assertCommerceWriteRole,
  isCommerceRemoteWritePilotEnabled,
  runAuthenticatedCommerceHydrate,
  runAuthenticatedCommerceListTransactions,
  runAuthenticatedCommerceSettle,
  type CommerceWriteClient,
} from "./commerce-remote-write-pilot";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
} from "@/lib/persistence/authenticated-identity-catalog";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import { COMMERCE_REMOTE_SETTLEMENT_MIGRATION_FILE } from "@/lib/persistence/schema-contract";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const APT_APP_ID = "apt-muqrindw-yt0l5z";
const APT_DB_ID = "b92c54a1-000e-4cf1-bbd3-837ce3312559";
const TRT_APP_ID = "trt-muqident-yyyyyy";
const TRT_DB_ID = "d1c0a111-2222-4333-8444-555555555555";
const WRITE_ON = {
  [COMMERCE_REMOTE_READ_PILOT_ENV]: "1",
  [COMMERCE_REMOTE_WRITE_PILOT_ENV]: "1",
};

type Row = Record<string, unknown>;

class FakeQuery implements IdentityQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly filters: Array<{ column: string; value: string }> = [],
  ) {}

  eq(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value }]);
  }
  in(): IdentityQueryBuilder {
    return this;
  }
  gte(): IdentityQueryBuilder {
    return this;
  }
  lte(): IdentityQueryBuilder {
    return this;
  }
  gt(): IdentityQueryBuilder {
    return this;
  }
  lt(): IdentityQueryBuilder {
    return this;
  }

  then<TResult1 = IdentityQueryResult, TResult2 = never>(
    onfulfilled?: ((value: IdentityQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const data = this.rows.filter((row) =>
      this.filters.every((filter) => String(row[filter.column]) === String(filter.value)),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function baseSnapshot(overrides: Partial<CommerceEngineSnapshot> = {}): CommerceEngineSnapshot {
  return {
    now: new Date("2026-10-05T04:00:00.000Z"),
    actor: {
      authUserId: AUTH_UUID,
      organizationAppId: FUTURE_QA_APPOINTMENT.organizationAppId,
      organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
      operationalStaffId: FUTURE_QA_APPOINTMENT.staffAppId,
      role: "OWNER",
      isActive: true,
      allowedLocationAppIds: null,
    },
    appointment: {
      appId: APT_APP_ID,
      dbId: APT_DB_ID,
      organizationAppId: FUTURE_QA_APPOINTMENT.organizationAppId,
      organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
      locationAppId: FUTURE_QA_APPOINTMENT.locationAppId,
      locationDbId: FUTURE_QA_APPOINTMENT.locationDbId,
      customerAppId: FUTURE_QA_APPOINTMENT.customerAppId,
      customerDbId: FUTURE_QA_APPOINTMENT.customerDbId,
      serviceAppId: FUTURE_QA_APPOINTMENT.serviceAppId,
      serviceDbId: FUTURE_QA_APPOINTMENT.serviceDbId,
      status: "COMPLETED",
    },
    treatment: {
      appId: TRT_APP_ID,
      dbId: TRT_DB_ID,
      organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
      locationDbId: FUTURE_QA_APPOINTMENT.locationDbId,
      appointmentDbId: APT_DB_ID,
      customerDbId: FUTURE_QA_APPOINTMENT.customerDbId,
      serviceDbId: FUTURE_QA_APPOINTMENT.serviceDbId,
      status: "COMPLETED",
    },
    service: {
      appId: FUTURE_QA_APPOINTMENT.serviceAppId,
      dbId: FUTURE_QA_APPOINTMENT.serviceDbId,
      organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
      name: FUTURE_QA_APPOINTMENT.serviceName,
      priceMinor: 2800,
    },
    drafts: [],
    transactions: [],
    ...overrides,
  };
}

function identityTables(role = "OWNER"): Record<string, Row[]> {
  return {
    staff_auth_memberships: [
      {
        id: "mem-enjoye-owner",
        user_id: FUTURE_QA_APPOINTMENT.staffAppId,
        auth_user_id: AUTH_UUID,
        organization_id: FUTURE_QA_APPOINTMENT.organizationAppId,
        role,
        is_active: true,
        display_name: FUTURE_QA_APPOINTMENT.staffName,
      },
    ],
    organizations: [
      {
        id: FUTURE_QA_APPOINTMENT.organizationDbId,
        app_id: FUTURE_QA_APPOINTMENT.organizationAppId,
      },
    ],
    locations: [
      {
        id: FUTURE_QA_APPOINTMENT.locationDbId,
        app_id: FUTURE_QA_APPOINTMENT.locationAppId,
        organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
      },
    ],
    customers: [
      {
        id: FUTURE_QA_APPOINTMENT.customerDbId,
        app_id: FUTURE_QA_APPOINTMENT.customerAppId,
        organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
        full_name: FUTURE_QA_APPOINTMENT.customerName,
        phone: "0911000001",
      },
    ],
    services: [
      {
        id: FUTURE_QA_APPOINTMENT.serviceDbId,
        app_id: FUTURE_QA_APPOINTMENT.serviceAppId,
        organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
      },
    ],
  };
}

function writeClient(
  snapshot: CommerceEngineSnapshot,
  role = "OWNER",
): CommerceWriteClient {
  const tables = identityTables(role);
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: AUTH_UUID } }, error: null };
      },
    },
    from(table: string) {
      return {
        select() {
          return new FakeQuery(tables[table] ?? []);
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      try {
        if (fn === COMMERCE_HYDRATE_RPC) {
          return { data: hydrateCheckoutFromTreatment(snapshot), error: null };
        }
        if (fn === COMMERCE_SAVE_RPC) {
          return {
            data: saveCheckoutDraft(snapshot, {
              draftId: String(args.p_checkout_app_id),
              expectedUpdatedAt: String(args.p_expected_updated_at),
              payments: (args.p_payments as never) ?? [],
              discounts: (args.p_discounts as never) ?? [],
            }),
            error: null,
          };
        }
        if (fn === COMMERCE_SETTLE_RPC) {
          return {
            data: settleCheckoutDraft(snapshot, {
              draftId: String(args.p_checkout_app_id),
              expectedUpdatedAt: String(args.p_expected_updated_at),
            }),
            error: null,
          };
        }
        if (fn === "commerce_list_transactions") {
          return { data: snapshot.transactions, error: null };
        }
        return { data: null, error: { message: `unknown rpc ${fn}` } };
      } catch (error) {
        return {
          data: null,
          error: { message: error instanceof Error ? error.message : "checkout_failed" },
        };
      }
    },
  };
}

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("Phase 1C-6H.2 commerce remote write / settle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps WRITE off unless READ is on; Production needs the same explicit env", () => {
    expect(isCommerceRemoteWritePilotEnabled({})).toBe(false);
    expect(
      isCommerceRemoteWritePilotEnabled({ [COMMERCE_REMOTE_WRITE_PILOT_ENV]: "1" }),
    ).toBe(false);
    expect(isCommerceRemoteWritePilotEnabled(WRITE_ON)).toBe(true);
    expect(
      isCommerceRemoteWritePilotEnabled({ ...WRITE_ON, VERCEL_ENV: "production" }),
    ).toBe(true);
    expect(getPersistenceDriver(WRITE_ON)).toBe("local");
  });

  it("creates an OPEN CheckoutDraft from a COMPLETED Treatment using canonical service price", async () => {
    const snapshot = baseSnapshot();
    const created = await runAuthenticatedCommerceHydrate(
      writeClient(snapshot, "STAFF"),
      { appointmentId: APT_APP_ID, treatmentId: TRT_APP_ID },
      WRITE_ON,
    );
    expect(created.draft.status).toBe("OPEN");
    expect(created.draft.appointmentId).toBe(APT_APP_ID);
    expect(created.draft.treatmentId).toBe(TRT_APP_ID);
    expect(created.draft.customerId).toBe(FUTURE_QA_APPOINTMENT.customerAppId);
    expect(created.draft.createdByStaffId).toBe(FUTURE_QA_APPOINTMENT.staffAppId);
    expect(created.draft.items).toHaveLength(1);
    expect(created.draft.items[0]?.referenceId).toBe(FUTURE_QA_APPOINTMENT.serviceAppId);
    expect(created.draft.items[0]?.unitPrice).toBe(2800);
    expect(created.draft.total).toBe(2800);
    expect(created.draft.createdByStaffId).not.toBe(AUTH_UUID);
  });

  it("denies DRAFT Treatment, CANCELLED appointment, and NO_SHOW", async () => {
    await expect(
      runAuthenticatedCommerceHydrate(
        writeClient(baseSnapshot({ treatment: { ...baseSnapshot().treatment, status: "DRAFT" } })),
        { appointmentId: APT_APP_ID, treatmentId: TRT_APP_ID },
        WRITE_ON,
      ),
    ).rejects.toThrow(COMMERCE_TREATMENT_NOT_COMPLETED_MESSAGE);

    await expect(
      runAuthenticatedCommerceHydrate(
        writeClient(
          baseSnapshot({
            appointment: { ...baseSnapshot().appointment, status: "CANCELLED" },
          }),
        ),
        { appointmentId: APT_APP_ID, treatmentId: TRT_APP_ID },
        WRITE_ON,
      ),
    ).rejects.toThrow(/無法結帳/);

    await expect(
      runAuthenticatedCommerceHydrate(
        writeClient(
          baseSnapshot({
            appointment: { ...baseSnapshot().appointment, status: "NO_SHOW" },
          }),
        ),
        { appointmentId: APT_APP_ID, treatmentId: TRT_APP_ID },
        WRITE_ON,
      ),
    ).rejects.toThrow(/無法結帳/);
  });

  it("fails closed when canonical service price is missing", async () => {
    await expect(
      runAuthenticatedCommerceHydrate(
        writeClient(baseSnapshot({ service: { ...baseSnapshot().service, priceMinor: null } })),
        { appointmentId: APT_APP_ID, treatmentId: TRT_APP_ID },
        WRITE_ON,
      ),
    ).rejects.toThrow(COMMERCE_MISSING_SERVICE_PRICE_MESSAGE);
  });

  it("hydrates the same remote draft and does not duplicate", async () => {
    const snapshot = baseSnapshot();
    const first = await runAuthenticatedCommerceHydrate(
      writeClient(snapshot),
      { appointmentId: APT_APP_ID, treatmentId: TRT_APP_ID },
      WRITE_ON,
    );
    const second = await runAuthenticatedCommerceHydrate(
      writeClient(snapshot),
      { appointmentId: APT_APP_ID, treatmentId: TRT_APP_ID },
      WRITE_ON,
    );
    expect(second.draft.id).toBe(first.draft.id);
    expect(snapshot.drafts.filter((row) => row.status === "OPEN")).toHaveLength(1);
  });

  it("accepts mixed CASH + CARD and denies payment mismatch / stored value", async () => {
    const snapshot = baseSnapshot();
    const hydrated = hydrateCheckoutFromTreatment(snapshot);
    const mixed = saveCheckoutDraft(snapshot, {
      draftId: hydrated.draft.id,
      expectedUpdatedAt: hydrated.draft.updatedAt,
      payments: [
        { id: "pay-cash", method: "CASH", amount: 1000 },
        { id: "pay-card", method: "CARD", amount: 1800 },
      ],
      discounts: [],
    });
    expect(mixed.draft.payments).toHaveLength(2);
    expect(mixed.draft.payments.map((row) => row.method)).toEqual(["CASH", "CARD"]);

    expect(() =>
      saveCheckoutDraft(snapshot, {
        draftId: mixed.draft.id,
        expectedUpdatedAt: mixed.draft.updatedAt,
        payments: [{ id: "pay-sv", method: "STORED_VALUE", amount: 2800 }],
        discounts: [],
      }),
    ).toThrow(COMMERCE_PAYMENT_UNAVAILABLE_MESSAGE);

    const mismatch = saveCheckoutDraft(snapshot, {
      draftId: mixed.draft.id,
      expectedUpdatedAt: mixed.draft.updatedAt,
      payments: [{ id: "pay-cash-2", method: "CASH", amount: 1000 }],
      discounts: [],
    });
    expect(() =>
      settleCheckoutDraft(snapshot, {
        draftId: mismatch.draft.id,
        expectedUpdatedAt: mismatch.draft.updatedAt,
      }),
    ).toThrow(COMMERCE_PAYMENT_MISMATCH_MESSAGE);
  });

  it("allows STAFF / RECEPTIONIST and denies ACCOUNTANT, cross-org, and cross-location", async () => {
    for (const role of ["STAFF", "RECEPTIONIST"] as const) {
      expect(() => assertCommerceWriteRole({ role, isActive: true })).not.toThrow();
      const created = await runAuthenticatedCommerceHydrate(
        writeClient(baseSnapshot(), role),
        { appointmentId: APT_APP_ID, treatmentId: TRT_APP_ID },
        WRITE_ON,
      );
      expect(created.draft.status).toBe("OPEN");
    }
    expect(() =>
      assertCommerceWriteRole({ role: "ACCOUNTANT", isActive: true }),
    ).toThrow(CommerceWritePilotDeniedError);

    await expect(
      runAuthenticatedCommerceHydrate(
        writeClient(baseSnapshot(), "ACCOUNTANT"),
        { appointmentId: APT_APP_ID, treatmentId: TRT_APP_ID },
        WRITE_ON,
      ),
    ).rejects.toThrow(COMMERCE_WRITE_FORBIDDEN_MESSAGE);

    expect(() =>
      hydrateCheckoutFromTreatment(
        baseSnapshot({
          actor: {
            ...baseSnapshot().actor,
            organizationDbId: "00000000-0000-4000-8000-000000000099",
          },
        }),
      ),
    ).toThrow(COMMERCE_WRITE_FORBIDDEN_MESSAGE);

    expect(() =>
      hydrateCheckoutFromTreatment(
        baseSnapshot({
          actor: {
            ...baseSnapshot().actor,
            allowedLocationAppIds: ["loc-other"],
          },
        }),
      ),
    ).toThrow(COMMERCE_WRITE_FORBIDDEN_MESSAGE);
  });

  it("never uses an Auth UUID as created_by_staff_id", () => {
    expect(() =>
      hydrateCheckoutFromTreatment(
        baseSnapshot({
          actor: { ...baseSnapshot().actor, operationalStaffId: AUTH_UUID },
        }),
      ),
    ).toThrow(/結帳人員身分無效/);
  });

  it("double-click settle is idempotent and rollback leaves no transaction", async () => {
    const snapshot = baseSnapshot();
    const hydrated = hydrateCheckoutFromTreatment(snapshot);
    const paid = saveCheckoutDraft(snapshot, {
      draftId: hydrated.draft.id,
      expectedUpdatedAt: hydrated.draft.updatedAt,
      payments: [{ id: "pay-1", method: "CASH", amount: 2800 }],
      discounts: [],
    });
    const first = await runAuthenticatedCommerceSettle(
      writeClient(snapshot),
      { draftId: paid.draft.id, expectedUpdatedAt: paid.draft.updatedAt },
      WRITE_ON,
    );
    const second = await runAuthenticatedCommerceSettle(
      writeClient(snapshot),
      { draftId: first.draft.id, expectedUpdatedAt: first.draft.updatedAt },
      WRITE_ON,
    );
    expect(second.transaction?.id).toBe(first.transaction?.id);
    expect(snapshot.transactions).toHaveLength(1);
    expect(first.transaction?.transactionNumber).toMatch(/^TX-\d{8}-\d{4}$/);

    const failing = baseSnapshot({ failSettleAfterLock: true });
    const ready = saveCheckoutDraft(failing, {
      draftId: hydrateCheckoutFromTreatment(failing).draft.id,
      expectedUpdatedAt: failing.drafts[0]!.updatedAt,
      payments: [{ id: "pay-2", method: "CARD", amount: 2800 }],
      discounts: [],
    });
    expect(() =>
      settleCheckoutDraft(failing, {
        draftId: ready.draft.id,
        expectedUpdatedAt: ready.draft.updatedAt,
      }),
    ).toThrow(/forced_failure/);
    expect(failing.transactions).toHaveLength(0);
    expect(failing.drafts[0]?.status).toBe("OPEN");
  });

  it("lists the completed remote transaction and stays off local stores", async () => {
    const snapshot = baseSnapshot();
    const hydrated = hydrateCheckoutFromTreatment(snapshot);
    const paid = saveCheckoutDraft(snapshot, {
      draftId: hydrated.draft.id,
      expectedUpdatedAt: hydrated.draft.updatedAt,
      payments: [{ id: "pay-3", method: "TRANSFER", amount: 2800 }],
      discounts: [],
    });
    await runAuthenticatedCommerceSettle(
      writeClient(snapshot),
      { draftId: paid.draft.id, expectedUpdatedAt: paid.draft.updatedAt },
      WRITE_ON,
    );
    const listed = await runAuthenticatedCommerceListTransactions(
      writeClient(snapshot),
      ORG_ENJOYE_ID,
      WRITE_ON,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.total).toBe(2800);
    expect(listed[0]?.payments[0]?.method).toBe("TRANSFER");
    expect(localStorage.getItem("beauty-os:transactions")).toBeNull();
    expect(localStorage.getItem(`beauty-os:${ORG_ENJOYE_ID}:checkout-drafts`)).toBeNull();
  });

  it("does not write localStorage or use mocks / service-role on the remote path", () => {
    const files = [
      "lib/commerce/commerce-remote-write-pilot.ts",
      "lib/commerce/commerce-remote-engine.ts",
      "lib/persistence/authenticated-commerce-store.ts",
      "features/checkout/use-commerce-remote-write.ts",
      "features/checkout/CheckoutPageClient.tsx",
      "features/transactions/TransactionsPageClient.tsx",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
      expect(source).not.toMatch(/getCustomerById\(|getServiceById\(|getScheduleAppointment\(/);
      expect(source).not.toMatch(/DEFAULT_SERVICE_PRICE_MINOR/);
    }
    expect(read("lib/commerce/commerce-remote-write-pilot.ts")).not.toMatch(
      /writeDrafts|writeTransactions|localStorage/,
    );
    expect(read("features/checkout/CheckoutPageClient.tsx")).toMatch(/commerceRemoteReadPilot/);
    expect(read("features/checkout/CheckoutPageClient.tsx")).toMatch(/if \(commerceRemoteReadPilot\) return;/);
    expect(read("lib/commerce/commerce-remote-write-flag.ts")).toMatch(
      /isCommerceRemoteReadPilotEnabled/,
    );
  });

  it("keeps hydrate off when the WRITE pilot is absent", async () => {
    await expect(
      runAuthenticatedCommerceHydrate(
        writeClient(baseSnapshot()),
        { appointmentId: APT_APP_ID, treatmentId: TRT_APP_ID },
      ),
    ).rejects.toThrow(COMMERCE_WRITE_PILOT_OFF_MESSAGE);
  });

  it("keeps the settlement migration additive and atomic", () => {
    const sql = read(COMMERCE_REMOTE_SETTLEMENT_MIGRATION_FILE);
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/\btruncate\s+table\b/i);
    expect(sql).toMatch(/create or replace function public\.settle_checkout_draft/);
    expect(sql).toMatch(/create or replace function public\.hydrate_checkout_from_treatment/);
    expect(sql).toMatch(/for update/);
    expect(sql).toMatch(/staff_role_can_checkout/);
    expect(sql).toMatch(/current_operational_staff_id/);
    expect(sql).toMatch(/next_transaction_number/);
    expect(sql).toMatch(/TX-.*YYYYMMDD/);
    expect(sql).toMatch(/服務價格尚未設定，無法結帳/);
    expect(sql).toMatch(/此付款方式目前尚未開放/);
    expect(sql).toMatch(/grant execute on function public\.settle_checkout_draft/);
    expect(sql).not.toMatch(/service_role/);
    expect(sql).toMatch(/transaction_number_sequences/);
  });

  it("does not enable the WRITE pilot in env files", () => {
    for (const file of [".env", ".env.local", ".env.preview", "vercel.json", ".cursor/environment.json"]) {
      if (!existsSync(path.join(process.cwd(), file))) continue;
      expect(read(file)).not.toMatch(/BEAUTY_OS_COMMERCE_REMOTE_WRITE_PILOT/);
    }
  });
});
