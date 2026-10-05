import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FUTURE_QA_APPOINTMENT, futureQaAppointmentUtcRange } from "@/lib/appointments/remote-readiness";
import {
  COMMERCE_CHECKOUT_FORBIDDEN_MESSAGE,
} from "./commerce-remote-identity";
import {
  COMMERCE_REMOTE_READ_PILOT_ENV,
  isCommerceRemoteReadPilotEnabled,
} from "./commerce-remote-read-flag";
import {
  COMMERCE_REMOTE_READ_PILOT_OFF_MESSAGE,
  getRemoteCommerceCheckoutCandidate,
  listRemoteCommerceCheckoutCandidates,
} from "./commerce-remote-read-pilot";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
  IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { listAppointments } from "@/lib/appointments/store";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const APT_APP_ID = "apt-muqrindw-yt0l5z";
const APT_DB_ID = "b92c54a1-000e-4cf1-bbd3-837ce3312559";
const TRT_APP_ID = "trt-muqident-yyyyyy";
const TRT_DB_ID = "d1c0a111-2222-4333-8444-555555555555";
const PILOT_ON = { [COMMERCE_REMOTE_READ_PILOT_ENV]: "1" };
const OWNER = { role: "OWNER" as const, isActive: true };

type Row = Record<string, unknown>;
type FilterOp = "eq" | "in" | "gte" | "lte" | "gt" | "lt";

class FakeQuery implements IdentityQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly filters: Array<{
      column: string;
      value?: string;
      values?: string[];
      op?: FilterOp;
    }> = [],
    private readonly error: { message: string } | null = null,
  ) {}

  eq(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "eq" }], this.error);
  }

  in(column: string, values: string[]): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, values, op: "in" }], this.error);
  }

  gte(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "gte" }], this.error);
  }

  lte(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "lte" }], this.error);
  }

  gt(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "gt" }], this.error);
  }

  lt(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value, op: "lt" }], this.error);
  }

  then<TResult1 = IdentityQueryResult, TResult2 = never>(
    onfulfilled?: ((value: IdentityQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.error) {
      return Promise.resolve({ data: null, error: this.error }).then(onfulfilled, onrejected);
    }
    const data = this.rows.filter((row) =>
      this.filters.every((filter) => {
        const current = row[filter.column];
        if (filter.values) return filter.values.includes(String(current));
        return String(current) === String(filter.value);
      }),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function fakeClient(input: {
  userId: string | null;
  tables: Record<string, Row[]>;
  errors?: Record<string, string>;
}): IdentitySupabaseClient {
  return {
    auth: {
      async getUser() {
        return {
          data: { user: input.userId ? { id: input.userId } : null },
          error: null,
        };
      },
    },
    from(table: string) {
      return {
        select() {
          const message = input.errors?.[table];
          return new FakeQuery(input.tables[table] ?? [], [], message ? { message } : null);
        },
      };
    },
  };
}

function qaAppointmentRow(overrides: Row = {}): Row {
  const { startAt, endAt } = futureQaAppointmentUtcRange();
  return {
    id: APT_DB_ID,
    organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
    location_id: FUTURE_QA_APPOINTMENT.locationDbId,
    customer_id: FUTURE_QA_APPOINTMENT.customerDbId,
    service_id: FUTURE_QA_APPOINTMENT.serviceDbId,
    staff_id: FUTURE_QA_APPOINTMENT.staffAppId,
    app_id: APT_APP_ID,
    starts_at: startAt,
    ends_at: endAt,
    duration_minutes: FUTURE_QA_APPOINTMENT.durationMinutes,
    status: "COMPLETED",
    customer_note: null,
    internal_note: null,
    customer_name_snapshot: FUTURE_QA_APPOINTMENT.customerName,
    service_name_snapshot: FUTURE_QA_APPOINTMENT.serviceName,
    staff_name_snapshot: FUTURE_QA_APPOINTMENT.staffName,
    status_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    created_by: FUTURE_QA_APPOINTMENT.staffAppId,
    updated_by: null,
    created_at: "2026-10-02T09:30:20.517Z",
    updated_at: "2026-10-02T09:30:20.517Z",
    ...overrides,
  };
}

function qaCustomerRow(overrides: Row = {}): Row {
  return {
    id: FUTURE_QA_APPOINTMENT.customerDbId,
    organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
    app_id: FUTURE_QA_APPOINTMENT.customerAppId,
    full_name: FUTURE_QA_APPOINTMENT.customerName,
    phone: "0911000001",
    email: null,
    birthday: null,
    gender: null,
    line_user_id: null,
    source: null,
    membership_tier: "new",
    is_vip: false,
    primary_staff_id: FUTURE_QA_APPOINTMENT.staffAppId,
    status: "ACTIVE",
    notes: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function qaServiceRow(overrides: Row = {}): Row {
  return {
    id: FUTURE_QA_APPOINTMENT.serviceDbId,
    organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
    app_id: FUTURE_QA_APPOINTMENT.serviceAppId,
    name: FUTURE_QA_APPOINTMENT.serviceName,
    service_type: "BREAST",
    duration_minutes: 100,
    price_minor: 3200,
    currency: "TWD",
    category: "美胸",
    is_active: true,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function qaTreatmentRow(overrides: Row = {}): Row {
  return {
    id: TRT_DB_ID,
    organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
    location_id: FUTURE_QA_APPOINTMENT.locationDbId,
    appointment_id: APT_DB_ID,
    customer_id: FUTURE_QA_APPOINTMENT.customerDbId,
    service_id: FUTURE_QA_APPOINTMENT.serviceDbId,
    staff_id: FUTURE_QA_APPOINTMENT.staffAppId,
    app_id: TRT_APP_ID,
    mode: "STANDARD",
    template_type: "BREAST",
    assessment: {},
    body_markers: [],
    operations: [],
    products: [],
    professional_note: null,
    client_feeling: null,
    follow_up: {},
    skipped_steps: [],
    started_at: "2026-10-09T02:00:00.000Z",
    completed_at: "2026-10-09T03:40:00.000Z",
    status: "COMPLETED",
    body_map_note: null,
    discomfort_note: null,
    furthest_step: "complete",
    current_step: "complete",
    created_by: FUTURE_QA_APPOINTMENT.staffAppId,
    updated_by: FUTURE_QA_APPOINTMENT.staffAppId,
    suggested_tracking_areas: [],
    selected_quick_phrases: [],
    note_manually_edited: false,
    quick_record_applied_at: null,
    photo_meta: [],
    created_at: "2026-10-09T02:00:00.000Z",
    updated_at: "2026-10-09T03:40:00.000Z",
    ...overrides,
  };
}

function validTables(overrides?: Partial<Record<string, Row[]>>): Record<string, Row[]> {
  return {
    staff_auth_memberships: [
      {
        id: "mem-enjoye-owner",
        user_id: FUTURE_QA_APPOINTMENT.staffAppId,
        auth_user_id: AUTH_UUID,
        organization_id: FUTURE_QA_APPOINTMENT.organizationAppId,
        role: "OWNER",
        is_active: true,
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
    customers: [qaCustomerRow()],
    services: [qaServiceRow()],
    appointments: [qaAppointmentRow()],
    treatments: [qaTreatmentRow()],
    ...overrides,
  };
}

function ownerClient(overrides?: Partial<Record<string, Row[]>>, errors?: Record<string, string>) {
  return fakeClient({
    userId: AUTH_UUID,
    tables: validTables(overrides),
    errors,
  });
}

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("Phase 1C-6H.1 commerce remote read pilot", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stays off by default, in production, and independent of global persistence", () => {
    expect(isCommerceRemoteReadPilotEnabled({})).toBe(false);
    expect(isCommerceRemoteReadPilotEnabled(PILOT_ON)).toBe(true);
    expect(
      isCommerceRemoteReadPilotEnabled({ ...PILOT_ON, VERCEL_ENV: "production" }),
    ).toBe(true);
    expect(
      isCommerceRemoteReadPilotEnabled({ ...PILOT_ON, VERCEL_TARGET_ENV: "production" }),
    ).toBe(true);
    expect(
      isCommerceRemoteReadPilotEnabled({
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
        BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT: "1",
        BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT: "1",
        BEAUTY_OS_TREATMENT_REMOTE_READ_PILOT: "1",
      }),
    ).toBe(false);
    expect(getPersistenceDriver(PILOT_ON)).toBe("local");
  });

  it("joins remote Customer / Appointment / Treatment / public.services", async () => {
    const rows = await listRemoteCommerceCheckoutCandidates(
      ORG_ENJOYE_ID,
      { actor: OWNER },
      ownerClient(),
      PILOT_ON,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      identity: {
        organizationId: ORG_ENJOYE_ID,
        customerId: FUTURE_QA_APPOINTMENT.customerAppId,
        appointmentId: APT_APP_ID,
        treatmentId: TRT_APP_ID,
        serviceId: FUTURE_QA_APPOINTMENT.serviceAppId,
        staffId: FUTURE_QA_APPOINTMENT.staffAppId,
        locationId: FUTURE_QA_APPOINTMENT.locationAppId,
      },
      customerName: FUTURE_QA_APPOINTMENT.customerName,
      serviceName: FUTURE_QA_APPOINTMENT.serviceName,
      staffName: FUTURE_QA_APPOINTMENT.staffName,
      customerPhone: "0911000001",
    });
    expect(rows[0]?.identity.customerId).not.toBe(FUTURE_QA_APPOINTMENT.customerDbId);
    expect(rows[0]?.identity.appointmentId).not.toBe(APT_DB_ID);
    expect(rows[0]?.identity.treatmentId).not.toBe(TRT_DB_ID);
    expect(rows[0]?.identity.serviceId).not.toBe(FUTURE_QA_APPOINTMENT.serviceDbId);
    expect(
      listAppointments({ organizationId: ORG_ENJOYE_ID }).some((row) => row.id === APT_APP_ID),
    ).toBe(false);
    expect(
      localCustomerRepository
        .list({ organizationId: ORG_ENJOYE_ID })
        .some((row) => row.id === FUTURE_QA_APPOINTMENT.customerAppId),
    ).toBe(false);
  });

  it("get-by-id uses the same canonical join and skips DRAFT / muted", async () => {
    const found = await getRemoteCommerceCheckoutCandidate(
      ORG_ENJOYE_ID,
      APT_APP_ID,
      { actor: OWNER, treatmentId: TRT_APP_ID },
      ownerClient(),
      PILOT_ON,
    );
    expect(found?.identity.treatmentId).toBe(TRT_APP_ID);
    const draft = await getRemoteCommerceCheckoutCandidate(
      ORG_ENJOYE_ID,
      APT_APP_ID,
      { actor: OWNER },
      ownerClient({ treatments: [qaTreatmentRow({ status: "DRAFT" })] }),
      PILOT_ON,
    );
    expect(draft).toBeUndefined();
    const cancelled = await listRemoteCommerceCheckoutCandidates(
      ORG_ENJOYE_ID,
      { actor: OWNER },
      ownerClient({ appointments: [qaAppointmentRow({ status: "CANCELLED" })] }),
      PILOT_ON,
    );
    expect(cancelled).toEqual([]);
    const noShow = await listRemoteCommerceCheckoutCandidates(
      ORG_ENJOYE_ID,
      { actor: OWNER },
      ownerClient({ appointments: [qaAppointmentRow({ status: "NO_SHOW" })] }),
      PILOT_ON,
    );
    expect(noShow).toEqual([]);
  });

  it("fails closed for cross-org, ACCOUNTANT, and pilot off", async () => {
    await expect(
      listRemoteCommerceCheckoutCandidates(
        "org-unrelated",
        { actor: OWNER },
        ownerClient(),
        PILOT_ON,
      ),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
    await expect(
      listRemoteCommerceCheckoutCandidates(
        ORG_ENJOYE_ID,
        { actor: { role: "ACCOUNTANT", isActive: true } },
        ownerClient(),
        PILOT_ON,
      ),
    ).rejects.toThrow(COMMERCE_CHECKOUT_FORBIDDEN_MESSAGE);
    await expect(
      listRemoteCommerceCheckoutCandidates(
        ORG_ENJOYE_ID,
        { actor: OWNER },
        ownerClient(),
        {},
      ),
    ).rejects.toThrow(COMMERCE_REMOTE_READ_PILOT_OFF_MESSAGE);
    for (const role of ["OWNER", "MANAGER", "STAFF", "RECEPTIONIST"] as const) {
      const rows = await listRemoteCommerceCheckoutCandidates(
        ORG_ENJOYE_ID,
        { actor: { role, isActive: true } },
        ownerClient(),
        PILOT_ON,
      );
      expect(rows).toHaveLength(1);
    }
  });

  it("does not fallback to local stores or write commerce / identity", () => {
    const files = [
      "lib/commerce/commerce-remote-read-pilot.ts",
      "lib/commerce/commerce-remote-identity.ts",
      "features/checkout/use-commerce-remote-read.ts",
      "features/checkout/CheckoutPageClient.tsx",
      "features/checkout/CommerceIdentityPanel.tsx",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/getScheduleAppointment|getCustomerById|getServiceById|loadDraft\(/);
      expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
      expect(source).not.toMatch(/completeCheckout|redeemPackage|debitStoredValue|insertTransaction/);
      expect(source).not.toMatch(/localCustomerRepository\.(upsert|create|save)/);
      expect(source).not.toMatch(/createAppointment\(|saveDraft\(|saveCompletedTreatment\(/);
    }
    const page = read("features/checkout/CheckoutPageClient.tsx");
    expect(page).toMatch(/commerceRemoteReadPilot/);
    expect(page).toMatch(/useCommerceRemoteCheckoutCandidates/);
    expect(page).toMatch(/buildRemoteCommerceWorkspaceItems|buildRemoteCommerceCheckoutItems/);
    expect(page).toMatch(/CommerceIdentityPanel/);
    expect(page).toMatch(/commerceRemoteReadPilot\s*\?\s*\(\[\] as Customer\[\]\)/);
    expect(page).toMatch(/if \(commerceRemoteReadPilot\) return;/);
    expect(page).not.toMatch(/createCheckoutFromAppointment[\s\S]{0,80}commerceRemoteReadPilot/);
    const complete = read("features/treatments/steps/CompleteStep.tsx");
    expect(complete).toMatch(/buildCommerceCheckoutHref/);
    expect(complete).toMatch(/if \(commerceRemoteRead\)/);
    expect(complete).not.toMatch(/createServiceRoleClient/);
    const today = read("lib/today/today-actions.ts");
    expect(today).toMatch(/commerceRemoteRead/);
    expect(today).toMatch(/resolveCommerceCheckoutEligibility/);
    expect(today).not.toMatch(/hasCompletedTransactionForAppointment/);
  });

  it("keeps RSC pages on the flag file and does not enable the pilot", () => {
    for (const file of [
      "app/staff/(app)/checkout/page.tsx",
      "app/staff/(app)/today/page.tsx",
      "app/staff/(app)/calendar/page.tsx",
      "app/staff/(app)/treatments/new/page.tsx",
    ]) {
      const source = read(file);
      expect(source).toMatch(/isCommerceRemoteReadPilotEnabled/);
      expect(source).not.toMatch(/commerce-remote-read-pilot|createAuthenticatedCommerceReadPersistence/);
      expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
    const flag = read("lib/commerce/commerce-remote-read-flag.ts");
    expect(flag).not.toMatch(/AppointmentRemoteAdapter|TreatmentRemoteAdapter|IdentitySupabaseClient/);
    expect(flag).toMatch(/Independent of BEAUTY_OS_PERSISTENCE/);
    const envFiles = [
      ".env",
      ".env.local",
      ".env.preview",
      "vercel.json",
      ".cursor/environment.json",
    ];
    for (const file of envFiles) {
      if (!existsSync(path.join(process.cwd(), file))) continue;
      expect(read(file)).not.toMatch(/BEAUTY_OS_COMMERCE_REMOTE_READ_PILOT/);
      expect(read(file)).not.toMatch(/BEAUTY_OS_COMMERCE_REMOTE_WRITE_PILOT/);
    }
  });
});
