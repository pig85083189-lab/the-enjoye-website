import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAppointmentWriteFormCatalog } from "@/lib/appointments/appointment-write-form-catalog";
import { APPOINTMENT_REMOTE_MUTATE_PILOT_ENV } from "@/lib/appointments/appointment-remote-mutate-flag";
import { isAppointmentRemoteMutatePilotEnabled } from "@/lib/appointments/appointment-remote-mutate-flag";
import { STORED_VALUE_WRITE_OPEN } from "@/lib/commerce/transaction-tender-presentation";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentityQueryBuilder,
  type IdentityQueryResult,
} from "@/lib/persistence/authenticated-identity-catalog";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { STAFF_OPERATIONAL_CREATE_MIGRATION_FILE } from "@/lib/persistence/schema-contract";
import { STAFF_REMOTE_CREATE_PILOT_ENV } from "@/lib/staff/staff-remote-create-flag";
import { isStaffRemoteCreatePilotEnabled } from "@/lib/staff/staff-remote-create-flag";
import {
  runAuthenticatedStaffWriteCreate,
  listAuthenticatedOrgStaff,
  STAFF_REMOTE_WRITE_PILOT_ENV,
  type StaffWriteClient,
} from "@/lib/staff/staff-remote-write-pilot";
import { isStaffRemoteWritePilotEnabled } from "@/lib/staff/staff-remote-write-flag";
import { STAFF_WRITE_PILOT_OFF_MESSAGE } from "@/lib/staff/staff-write-guard";
import { canCreateOperationalStaff } from "@/lib/staff-auth/operational-capabilities";
import { isAuthUuid } from "@/lib/staff-auth/staff-id";
import { LOC_ENJOYE_PRIMARY_ID, LOC_ENJOYE_SECONDARY_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const AUTH_OWNER = "cd037b07-d6fe-49a3-91eb-9735ec65665c";
const AUTH_MANAGER = "22222222-2222-4222-8222-222222222222";
const AUTH_STAFF = "33333333-3333-4333-8333-333333333333";
const AUTH_RECEPTIONIST = "44444444-4444-4444-8444-444444444444";
const AUTH_ACCOUNTANT = "55555555-5555-4555-8555-555555555555";
const ORG_UUID = "62bd49b6-a4c3-4da1-b53e-4746923685f1";
const LOC_UUID = "c46b700c-bb42-45ce-be53-4484e217c3f8";
const GONGYI_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const WRITE_ON = {
  [STAFF_REMOTE_WRITE_PILOT_ENV]: "1",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

type Row = Record<string, unknown>;

class FakeQuery implements IdentityQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly filters: Array<{ column: string; value?: string; values?: string[] }> = [],
    private readonly error: { message: string; code?: string } | null = null,
  ) {}

  eq(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value }], this.error);
  }
  in(column: string, values: string[]): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, values }], this.error);
  }
  gte(column: string, value: string): IdentityQueryBuilder {
    return this.eq(column, value);
  }
  lte(column: string, value: string): IdentityQueryBuilder {
    return this.eq(column, value);
  }
  gt(column: string, value: string): IdentityQueryBuilder {
    return this.eq(column, value);
  }
  lt(column: string, value: string): IdentityQueryBuilder {
    return this.eq(column, value);
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
        return current === filter.value;
      }),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function membership(role: string, authUserId: string | null, userId: string): Row {
  return {
    id: `mem-${userId}`,
    user_id: userId,
    auth_user_id: authUserId,
    organization_id: ORG_ENJOYE_ID,
    role,
    is_active: true,
    display_name: role,
  };
}

function validTables(overrides?: Partial<Record<string, Row[]>>): Record<string, Row[]> {
  return {
    staff_auth_memberships: [membership("OWNER", AUTH_OWNER, "staff-001")],
    staff_auth_membership_locations: [
      { membership_id: "mem-staff-001", location_id: LOC_ENJOYE_PRIMARY_ID },
    ],
    organizations: [{ id: ORG_UUID, app_id: ORG_ENJOYE_ID }],
    locations: [
      { id: LOC_UUID, app_id: LOC_ENJOYE_PRIMARY_ID, organization_id: ORG_UUID },
      { id: GONGYI_UUID, app_id: LOC_ENJOYE_SECONDARY_ID, organization_id: ORG_UUID },
    ],
    customers: [],
    services: [],
    appointments: [],
    treatments: [],
    transactions: [],
    checkout_drafts: [],
    auth_users: [],
    ...overrides,
  };
}

function fakeClient(input: {
  userId: string | null;
  tables: Record<string, Row[]>;
  insertError?: { message: string; code?: string };
}): StaffWriteClient {
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
          return new FakeQuery(input.tables[table] ?? []);
        },
        insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
          return {
            select() {
              if (input.insertError) {
                return new FakeQuery([], [], input.insertError);
              }
              const rows = Array.isArray(payload) ? payload : [payload];
              for (const next of rows) {
                if (table === "staff_auth_memberships") {
                  if (next.auth_user_id != null) {
                    return new FakeQuery([], [], { message: "RLS", code: "42501" });
                  }
                  if (typeof next.user_id === "string" && isAuthUuid(next.user_id)) {
                    return new FakeQuery([], [], { message: "RLS", code: "42501" });
                  }
                  if (next.role === "OWNER") {
                    return new FakeQuery([], [], { message: "RLS", code: "42501" });
                  }
                  const existing = (input.tables[table] ?? []).some(
                    (row) =>
                      row.id === next.id ||
                      (row.organization_id === next.organization_id && row.user_id === next.user_id),
                  );
                  if (existing) {
                    return new FakeQuery([], [], { message: "duplicate key", code: "23505" });
                  }
                }
                if (table === "staff_auth_membership_locations") {
                  const existing = (input.tables[table] ?? []).some(
                    (row) =>
                      row.membership_id === next.membership_id &&
                      row.location_id === next.location_id,
                  );
                  if (existing) {
                    return new FakeQuery([], [], { message: "duplicate key", code: "23505" });
                  }
                }
                const row = {
                  ...next,
                  created_at: "2026-10-07T02:00:00.000Z",
                  updated_at: "2026-10-07T02:00:00.000Z",
                };
                input.tables[table] = [...(input.tables[table] ?? []), row];
              }
              return new FakeQuery(rows.map((row) => ({ ...row, created_at: "2026-10-07T02:00:00.000Z" })));
            },
          };
        },
      };
    },
  };
}

function createInput(over: Partial<Parameters<typeof runAuthenticatedStaffWriteCreate>[1]> = {}) {
  return {
    organizationId: ORG_ENJOYE_ID,
    displayName: "預覽新人",
    phone: "0911000111",
    email: "preview.staff@example.com",
    title: "美容師",
    role: "STAFF",
    locationIds: [LOC_ENJOYE_PRIMARY_ID],
    membershipId: "mem-staff-preview1",
    userId: "staff-preview1",
    ...over,
  };
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("staff operational remote write", () => {
  it("stays fail-closed unless the Staff WRITE flag is exactly 1", () => {
    expect(isStaffRemoteWritePilotEnabled({})).toBe(false);
    expect(
      isStaffRemoteWritePilotEnabled({ [STAFF_REMOTE_WRITE_PILOT_ENV]: "1" }),
    ).toBe(false);
    expect(isStaffRemoteWritePilotEnabled(WRITE_ON)).toBe(true);
    expect(isStaffRemoteCreatePilotEnabled(WRITE_ON)).toBe(false);
    expect(STAFF_REMOTE_WRITE_PILOT_ENV).toBe("BEAUTY_OS_STAFF_REMOTE_WRITE_PILOT");
    expect(STAFF_REMOTE_CREATE_PILOT_ENV).toBe("BEAUTY_OS_STAFF_REMOTE_CREATE_PILOT");
    expect(isAppointmentRemoteMutatePilotEnabled(WRITE_ON)).toBe(false);
    expect(STORED_VALUE_WRITE_OPEN).toBe(false);
  });

  it("lets OWNER and MANAGER create operational staff without an Auth user", async () => {
    const ownerTables = validTables();
    const owner = await runAuthenticatedStaffWriteCreate(
      fakeClient({ userId: AUTH_OWNER, tables: ownerTables }),
      createInput(),
      WRITE_ON,
    );
    expect(owner.userId).toBe("staff-preview1");
    expect(owner.userId.startsWith("staff-")).toBe(true);
    expect(isAuthUuid(owner.userId)).toBe(false);
    expect(owner.userId).not.toBe(AUTH_OWNER);
    expect(owner.authUserId).toBeNull();
    expect(owner.displayName).toBe("預覽新人");
    expect(owner.title).toBe("美容師");
    expect(owner.phone).toBe("0911000111");
    expect(owner.role).toBe("STAFF");
    expect(owner.locationIds).toEqual([LOC_ENJOYE_PRIMARY_ID]);
    expect(ownerTables.staff_auth_memberships).toHaveLength(2);
    expect(ownerTables.auth_users).toHaveLength(0);
    expect(ownerTables.customers).toHaveLength(0);
    expect(ownerTables.appointments).toHaveLength(0);
    expect(ownerTables.treatments).toHaveLength(0);
    expect(ownerTables.transactions).toHaveLength(0);
    expect(ownerTables.checkout_drafts).toHaveLength(0);

    const roster = await listAuthenticatedOrgStaff(
      fakeClient({ userId: AUTH_OWNER, tables: ownerTables }),
    );
    expect(roster.some((row) => row.userId === "staff-preview1")).toBe(true);

    const catalog = await loadAppointmentWriteFormCatalog(
      fakeClient({ userId: AUTH_OWNER, tables: ownerTables }),
    );
    expect(catalog.staff.some((row) => row.id === "staff-preview1" && row.name === "預覽新人")).toBe(
      true,
    );

    const identity = await loadAuthenticatedIdentityCatalog(
      fakeClient({ userId: AUTH_OWNER, tables: ownerTables }),
    );
    expect(
      identity.catalog.findStaffByAppId(identity.organizationDbId, "staff-preview1")?.staffAppId,
    ).toBe("staff-preview1");
    expect(identity.authUserId).not.toBe("staff-preview1");

    const managerTables = validTables({
      staff_auth_memberships: [membership("MANAGER", AUTH_MANAGER, "staff-002")],
      staff_auth_membership_locations: [
        { membership_id: "mem-staff-002", location_id: LOC_ENJOYE_PRIMARY_ID },
      ],
    });
    const manager = await runAuthenticatedStaffWriteCreate(
      fakeClient({ userId: AUTH_MANAGER, tables: managerTables }),
      createInput({ membershipId: "mem-staff-preview2", userId: "staff-preview2" }),
      WRITE_ON,
    );
    expect(manager.userId).toBe("staff-preview2");
    expect(manager.authUserId).toBeNull();
    expect(canCreateOperationalStaff({ role: "MANAGER", isActive: true })).toBe(true);
  });

  it("denies STAFF, RECEPTIONIST, ACCOUNTANT, wrong org, and wrong location", async () => {
    await expect(
      runAuthenticatedStaffWriteCreate(
        fakeClient({
          userId: AUTH_STAFF,
          tables: validTables({
            staff_auth_memberships: [membership("STAFF", AUTH_STAFF, "staff-010")],
          }),
        }),
        createInput({ membershipId: "mem-denied-staff", userId: "staff-denied-staff" }),
        WRITE_ON,
      ),
    ).rejects.toThrow(/沒有權限新增員工/);
    await expect(
      runAuthenticatedStaffWriteCreate(
        fakeClient({
          userId: AUTH_RECEPTIONIST,
          tables: validTables({
            staff_auth_memberships: [membership("RECEPTIONIST", AUTH_RECEPTIONIST, "staff-011")],
          }),
        }),
        createInput({ membershipId: "mem-denied-rec", userId: "staff-denied-rec" }),
        WRITE_ON,
      ),
    ).rejects.toThrow(/沒有權限新增員工/);
    await expect(
      runAuthenticatedStaffWriteCreate(
        fakeClient({
          userId: AUTH_ACCOUNTANT,
          tables: validTables({
            staff_auth_memberships: [membership("ACCOUNTANT", AUTH_ACCOUNTANT, "staff-012")],
          }),
        }),
        createInput({ membershipId: "mem-denied-acc", userId: "staff-denied-acc" }),
        WRITE_ON,
      ),
    ).rejects.toThrow(/沒有權限新增員工/);
    await expect(
      runAuthenticatedStaffWriteCreate(
        fakeClient({ userId: AUTH_OWNER, tables: validTables() }),
        createInput({
          organizationId: "org-lumiere",
          membershipId: "mem-denied-org",
          userId: "staff-denied-org",
        }),
        WRITE_ON,
      ),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
    await expect(
      runAuthenticatedStaffWriteCreate(
        fakeClient({ userId: AUTH_OWNER, tables: validTables() }),
        createInput({
          locationIds: [LOC_ENJOYE_SECONDARY_ID],
          membershipId: "mem-denied-loc",
          userId: "staff-denied-loc",
        }),
        WRITE_ON,
      ),
    ).rejects.toThrow(/分店不屬於目前店家或沒有權限/);
  });

  it("rejects Auth UUID as operational staff id and OWNER role", async () => {
    await expect(
      runAuthenticatedStaffWriteCreate(
        fakeClient({ userId: AUTH_OWNER, tables: validTables() }),
        createInput({
          membershipId: "mem-denied-uuid",
          userId: AUTH_OWNER,
        }),
        WRITE_ON,
      ),
    ).rejects.toThrow(/Auth UUID|員工識別/);
    await expect(
      runAuthenticatedStaffWriteCreate(
        fakeClient({ userId: AUTH_OWNER, tables: validTables() }),
        createInput({
          role: "OWNER",
          membershipId: "mem-denied-owner",
          userId: "staff-denied-owner",
        }),
        WRITE_ON,
      ),
    ).rejects.toThrow(/無法透過此表單建立店主/);
    await expect(
      runAuthenticatedStaffWriteCreate(
        fakeClient({ userId: AUTH_OWNER, tables: validTables() }),
        createInput(),
        {},
      ),
    ).rejects.toThrow(STAFF_WRITE_PILOT_OFF_MESSAGE);
  });

  it("does not create a second staff on retry with the same ids", async () => {
    const tables = validTables();
    const client = fakeClient({ userId: AUTH_OWNER, tables });
    const first = await runAuthenticatedStaffWriteCreate(client, createInput(), WRITE_ON);
    const second = await runAuthenticatedStaffWriteCreate(client, createInput(), WRITE_ON);
    expect(first.userId).toBe(second.userId);
    expect(first.id).toBe(second.id);
    expect(tables.staff_auth_memberships.filter((row) => row.user_id === "staff-preview1")).toHaveLength(
      1,
    );
    await expect(
      runAuthenticatedStaffWriteCreate(
        fakeClient({ userId: AUTH_OWNER, tables }),
        createInput({ membershipId: "mem-staff-preview-dup", userId: "staff-preview1" }),
        WRITE_ON,
      ),
    ).rejects.toThrow(/員工識別已存在/);
  });

  it("keeps Auth provisioning, Appointment MUTATE, and Stored Value WRITE closed", () => {
    expect(source("lib/staff/staff-remote-write-pilot.ts")).not.toMatch(
      /createServiceRoleClient|admin\.createUser|inviteUserByEmail/,
    );
    expect(source("lib/persistence/authenticated-staff-write-store.ts")).not.toMatch(
      /createServiceRoleClient|auth\.admin/,
    );
    expect(source("features/staff/StaffOnboardingDialog.tsx")).toMatch(/建立員工/);
    expect(source("features/staff/StaffOnboardingDialog.tsx")).toMatch(/不會建立登入帳號/);
    expect(source("features/staff/StaffOnboardingDialog.tsx")).not.toMatch(
      /data-staff-invite|邀請登入<\/button>/,
    );
    expect(source("features/staff/use-staff-remote-write.ts")).toMatch(/createBrowserClientOrNull/);
    expect(source("app/staff/(app)/staff/page.tsx")).toMatch(/isStaffRemoteWritePilotEnabled/);
    expect(source("app/staff/(app)/staff/page.tsx")).not.toMatch(/staff-remote-write-pilot/);
    expect(APPOINTMENT_REMOTE_MUTATE_PILOT_ENV).toBe("BEAUTY_OS_APPOINTMENT_REMOTE_MUTATE_PILOT");
    expect(STORED_VALUE_WRITE_OPEN).toBe(false);
  });

  it("adds additive INSERT RLS without rewriting published staff identity migrations", () => {
    const sql = source(STAFF_OPERATIONAL_CREATE_MIGRATION_FILE);
    expect(sql).toMatch(/staff_auth_memberships_insert_operational/);
    expect(sql).toMatch(/auth_user_id is null/);
    expect(sql).toMatch(/staff_role_is_managerial/);
    expect(sql).toMatch(/user_operational_staff_id/);
    expect(sql).toMatch(/grant select, insert on public\.staff_auth_memberships/);
    expect(sql).not.toMatch(/grant update|grant delete|admin\.createUser/);
    expect(source("supabase/migrations/20260928112950_staff_auth_memberships.sql")).not.toMatch(
      /staff_auth_memberships_insert_operational/,
    );
    expect(source("lib/staff/staff-remote-write-flag.ts")).not.toMatch(
      /REMOTE_WRITE_ALL|STAFF_AND_AUTH_WRITE/,
    );
    expect(source("lib/staff/staff-remote-write-flag.ts")).toMatch(
      /Independent of BEAUTY_OS_PERSISTENCE/,
    );
  });
});
