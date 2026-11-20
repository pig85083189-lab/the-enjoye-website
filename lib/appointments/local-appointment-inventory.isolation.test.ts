import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchAppointmentInventoryDirectory } from "@/lib/appointments/appointment-inventory-directory";
import {
  buildLocalAppointmentInventory,
  planAuthorizedAppointmentMigration,
  readPersistedInventoryAppointments,
  type InventoryIdentityDirectory,
} from "@/lib/appointments/local-appointment-inventory";
import { classifyProductionStaffAccess } from "@/lib/staff-auth/production-write-access";
import { getScheduleAppointmentsKey } from "@/lib/tenant/storage-keys";

const ORG = "org-the-enjoye";
const NOW = new Date("2026-11-20T00:00:00.000Z");

function staff(userId: string, authUserId: string | null, role: string) {
  const access = classifyProductionStaffAccess({
    userId,
    authUserId,
    role,
    isActive: true,
  });
  return { userId, authUserId, role, isActive: true, access };
}

function directory(overrides: Partial<InventoryIdentityDirectory> = {}): InventoryIdentityDirectory {
  return {
    remoteCheck: "checked",
    organizationAppId: ORG,
    locationAppIds: ["loc-enjoye-main"],
    customerAppIds: ["cust-line-1"],
    serviceAppIds: ["svc-upup"],
    staff: [
      staff("staff-owner", "auth-owner", "OWNER"),
      staff("staff-002", null, "STAFF"),
      staff("staff-003", null, "RECEPTIONIST"),
      staff("staff-004", null, "MANAGER"),
    ],
    remoteAppointments: [],
    ...overrides,
  };
}

function local(overrides: Record<string, string> = {}) {
  return {
    id: "apt-local-future",
    organizationId: ORG,
    locationId: "loc-enjoye-main",
    customerId: "cust-line-1",
    serviceId: "svc-upup",
    staffId: "staff-002",
    startAt: "2026-11-21T02:00:00.000Z",
    endAt: "2026-11-21T03:00:00.000Z",
    status: "BOOKED",
    ...overrides,
  };
}

describe("production staff access", () => {
  it("keeps staff with an empty auth user id as valid operational staff", () => {
    const unbound = classifyProductionStaffAccess({
      userId: "staff-002",
      authUserId: null,
      role: "STAFF",
      isActive: true,
    });
    expect(unbound.operationalIdentityValid).toBe(true);
    expect(unbound.canBeAppointmentStaff).toBe(true);
    expect(unbound.authenticatedSessionBound).toBe(false);
    expect(unbound.canWriteAppointments).toBe(false);
    expect(unbound.canWriteTreatments).toBe(false);
  });

  it("allows only a bound operational role to write appointments and treatments", () => {
    for (const role of ["OWNER", "MANAGER", "STAFF", "RECEPTIONIST"]) {
      const access = classifyProductionStaffAccess({
        userId: "staff-writer",
        authUserId: "auth-writer",
        role,
        isActive: true,
      });
      expect(access.canWriteAppointments).toBe(true);
      expect(access.canWriteTreatments).toBe(true);
    }
    const accountant = classifyProductionStaffAccess({
      userId: "staff-finance",
      authUserId: "auth-finance",
      role: "ACCOUNTANT",
      isActive: true,
    });
    expect(accountant.authenticatedSessionBound).toBe(true);
    expect(accountant.canWriteAppointments).toBe(false);
    expect(accountant.canWriteTreatments).toBe(false);
  });
});

describe("read-only local appointment inventory", () => {
  it("lists a future appointment that is absent from the formal database", () => {
    const report = buildLocalAppointmentInventory({
      organizationId: ORG,
      now: NOW,
      localAppointments: [local()],
      directory: directory(),
    });
    expect(report.writesPerformed).toBe(false);
    expect(report.rows[0]?.disposition).toBe("pending_review");
    expect(report.counts.pending_review).toBe(1);
  });

  it("does not infer a customer from another row and ignores stored names", () => {
    const report = buildLocalAppointmentInventory({
      organizationId: ORG,
      now: NOW,
      localAppointments: [local({ customerId: "cust-unknown" })],
      directory: directory(),
    });
    expect(report.rows[0]?.disposition).toBe("identity_unresolved");
    expect(report.rows[0]?.unresolved).toContain("customer");
    const key = getScheduleAppointmentsKey(ORG);
    localStorage.setItem(key, JSON.stringify([{
      ...local(),
      customerName: "不應用來配對",
      guestContactPhone: "0900000000",
    }]));
    const before = localStorage.getItem(key);
    const read = readPersistedInventoryAppointments(ORG);
    expect(read[0]).not.toHaveProperty("customerName");
    expect(read[0]?.customerId).toBe("cust-line-1");
    expect(localStorage.getItem(key)).toBe(before);
  });

  it("keeps an unbound staff member eligible and skips past or cancelled rows", () => {
    const report = buildLocalAppointmentInventory({
      organizationId: ORG,
      now: NOW,
      localAppointments: [
        local({ id: "apt-unbound", staffId: "staff-002" }),
        local({ id: "apt-past", startAt: "2026-11-19T02:00:00.000Z", endAt: "2026-11-19T03:00:00.000Z" }),
        local({ id: "apt-cancelled", status: "CANCELLED" }),
      ],
      directory: directory(),
    });
    expect(report.rows.find((row) => row.id === "apt-unbound")?.disposition).toBe("pending_review");
    expect(report.rows.find((row) => row.id === "apt-past")?.disposition).toBe("not_future_active");
    expect(report.rows.find((row) => row.id === "apt-cancelled")?.disposition).toBe("not_future_active");
  });

  it("does not call a stored appointment pending when the formal read is unavailable or the id already exists", () => {
    const unavailable = buildLocalAppointmentInventory({
      organizationId: ORG,
      now: NOW,
      localAppointments: [local()],
      directory: directory({ remoteCheck: "unavailable", remoteAppointments: [] }),
    });
    expect(unavailable.rows[0]?.disposition).toBe("remote_not_checked");
    const present = buildLocalAppointmentInventory({
      organizationId: ORG,
      now: NOW,
      localAppointments: [local()],
      directory: directory({
        remoteAppointments: [{
          id: "apt-local-future",
          staffId: "staff-002",
          startAt: "2026-11-21T02:00:00.000Z",
          endAt: "2026-11-21T03:00:00.000Z",
          status: "BOOKED",
        }],
      }),
    });
    expect(present.rows[0]?.disposition).toBe("already_remote");
  });

  it("plans an authorized migration without writing and stops on a formal overlap", () => {
    const report = buildLocalAppointmentInventory({
      organizationId: ORG,
      now: NOW,
      localAppointments: [local(), local({
        id: "apt-overlap",
        startAt: "2026-11-22T02:00:00.000Z",
        endAt: "2026-11-22T03:00:00.000Z",
      })],
      directory: directory({
        remoteAppointments: [{
          id: "apt-remote",
          staffId: "staff-002",
          startAt: "2026-11-22T02:30:00.000Z",
          endAt: "2026-11-22T03:30:00.000Z",
          status: "BOOKED",
        }],
      }),
    });
    expect(planAuthorizedAppointmentMigration({
      explicitAuthorization: false,
      report,
      remoteAppointments: report.remoteCheck === "checked" ? directory().remoteAppointments : [],
    }).authorized).toBe(false);
    const planned = planAuthorizedAppointmentMigration({
      explicitAuthorization: true,
      report,
      remoteAppointments: [{
        id: "apt-remote",
        staffId: "staff-002",
        startAt: "2026-11-22T02:30:00.000Z",
        endAt: "2026-11-22T03:30:00.000Z",
        status: "BOOKED",
      }],
    });
    expect(planned.writesPerformed).toBe(false);
    expect(planned.readyIds).toEqual(["apt-local-future"]);
    expect(planned.blocked).toEqual([{ id: "apt-overlap", reason: "remote_overlap" }]);
    expect(readFileSync("lib/appointments/local-appointment-inventory.ts", "utf8"))
      .not.toMatch(/\.insert\(|localStorage\.setItem|upsert\(/);
  });
});

describe("formal directory read", () => {
  it("reads identity ids and does not upload customers", async () => {
    const calls: string[] = [];
    const rows: Record<string, unknown[]> = {
      organizations: [{ id: "org-uuid", app_id: ORG }],
      locations: [{ app_id: "loc-enjoye-main", organization_id: "org-uuid" }],
      customers: [{ app_id: "cust-line-1", organization_id: "org-uuid" }],
      services: [{ app_id: "svc-upup", organization_id: "org-uuid" }],
      staff_auth_memberships: [
        { user_id: "staff-owner", auth_user_id: "auth-owner", role: "OWNER", is_active: true, organization_id: ORG },
        { user_id: "staff-002", auth_user_id: null, role: "STAFF", is_active: true, organization_id: ORG },
      ],
      appointments: [
        { id: "db-1", app_id: "", staff_id: "staff-002", start_at: "2026-11-22T02:00:00.000Z", end_at: "2026-11-22T03:00:00.000Z", status: "BOOKED" },
      ],
    };
    const client = {
      from(table: string) {
        return {
          select(columns: string) {
            return {
              eq(column: string, value: string) {
                calls.push(`${table}:${columns}:${column}=${value}`);
                return Promise.resolve({ data: rows[table] ?? [], error: null });
              },
            };
          },
        };
      },
    };
    const directory = await fetchAppointmentInventoryDirectory(client, ORG);
    expect(directory.remoteCheck).toBe("checked");
    if (directory.remoteCheck !== "checked") return;
    expect(directory.customerAppIds).toEqual(["cust-line-1"]);
    expect(directory.staff.find((item) => item.userId === "staff-002")?.access.operationalIdentityValid).toBe(true);
    expect(directory.remoteAppointments[0]?.id).toBe("db-1");
    expect(calls.some((call) => call.startsWith("customers:"))).toBe(true);
    expect(calls.join("\n")).not.toMatch(/insert|upsert|update|delete/);
    expect(readFileSync("app/staff/(app)/appointment-inventory/page.tsx", "utf8")).not.toMatch(/<button|insert\(/);
    expect(readFileSync("lib/navigation/config.ts", "utf8")).not.toContain("appointment-inventory");
  });
});
