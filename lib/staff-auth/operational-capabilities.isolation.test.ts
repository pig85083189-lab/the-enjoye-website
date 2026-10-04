import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppointment, transitionAppointmentStatus } from "@/lib/appointments/store";
import { createCheckoutFromAppointment, createEmptyCheckoutDraft } from "@/lib/commerce/checkout-store";
import { canManageStaff } from "@/lib/staff/staff-onboarding-derived";
import {
  resolveStaffManagementAccess,
  staffManagementForbiddenHref,
} from "@/lib/staff/staff-management-access";
import {
  canCancelAppointment,
  canCheckout,
  canCreateAppointment,
  canManageStaffCapability,
  canOpenOrder,
  canReadTreatment,
  canWriteTreatment,
  resolveCheckoutAccess,
} from "@/lib/staff-auth/operational-capabilities";
import {
  hydrateRemoteMemberships,
  resetHydratedRemoteMembershipsForTests,
} from "@/lib/staff-auth/membership-query";
import { getVisibleNavigationItems } from "@/lib/navigation/resolve";
import {
  LOC_ENJOYE_PRIMARY_ID,
  MEMBERSHIP_ENJOYE_OWNER_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import type { StaffMembership, StaffRole } from "@/types/saas";

const OPERATIONAL: StaffRole[] = ["OWNER", "MANAGER", "STAFF", "RECEPTIONIST"];

function actor(role: StaffRole, isActive = true) {
  return { role, isActive };
}

function membership(over: Partial<StaffMembership> = {}): StaffMembership {
  return {
    id: MEMBERSHIP_ENJOYE_OWNER_ID,
    organizationId: ORG_ENJOYE_ID,
    userId: "staff-001",
    locationIds: [LOC_ENJOYE_PRIMARY_ID],
    role: "OWNER",
    displayName: "測試帳號",
    isActive: true,
    createdAt: "2025-01-01T00:00:00+08:00",
    authUserId: "cd037b07-d6fe-49a3-91eb-9735ec65665c",
    email: "owner@example.com",
    ...over,
  };
}

function eligibleAppointment(staffId = "staff-001") {
  const start = new Date(2026, 8, 21, 14, 0).toISOString();
  const end = new Date(2026, 8, 21, 15, 30).toISOString();
  const apt = createAppointment(ORG_ENJOYE_ID, {
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "demo-001",
    serviceId: "svc-breast",
    staffId,
    startAt: start,
    endAt: end,
    allowConflict: true,
  });
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "CONFIRMED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "ARRIVED");
  transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "IN_SERVICE");
  return apt;
}

beforeEach(() => {
  localStorage.clear();
  resetHydratedRemoteMembershipsForTests();
});

afterEach(() => {
  localStorage.clear();
  resetHydratedRemoteMembershipsForTests();
});

describe("Phase 1C-6D.2D operational capabilities", () => {
  it("grants Appointment Create and Checkout to operational salon roles only", () => {
    for (const role of OPERATIONAL) {
      expect(canCreateAppointment(actor(role))).toBe(true);
      expect(canCheckout(actor(role))).toBe(true);
      expect(canOpenOrder(actor(role))).toBe(true);
    }
    expect(canCreateAppointment(actor("ACCOUNTANT"))).toBe(false);
    expect(canCheckout(actor("ACCOUNTANT"))).toBe(false);
    expect(canOpenOrder(actor("ACCOUNTANT"))).toBe(false);
    expect(canCreateAppointment(actor("STAFF", false))).toBe(false);
    expect(canCheckout(undefined)).toBe(false);
    expect(canManageStaffCapability(actor("OWNER"))).toBe(true);
    expect(canManageStaffCapability(actor("MANAGER"))).toBe(false);
  });

  it("grants Treatment read/write to operational salon roles and denies ACCOUNTANT", () => {
    for (const role of OPERATIONAL) {
      expect(canReadTreatment(actor(role))).toBe(true);
      expect(canWriteTreatment(actor(role))).toBe(true);
    }
    expect(canReadTreatment(actor("ACCOUNTANT"))).toBe(false);
    expect(canWriteTreatment(actor("ACCOUNTANT"))).toBe(false);
    expect(canReadTreatment(actor("STAFF", false))).toBe(false);
    expect(canWriteTreatment(undefined)).toBe(false);
  });

  it("grants Cancel to operational salon roles and denies ACCOUNTANT", () => {
    for (const role of OPERATIONAL) {
      expect(canCancelAppointment(actor(role))).toBe(true);
    }
    expect(canCancelAppointment(actor("ACCOUNTANT"))).toBe(false);
    expect(canCancelAppointment(actor("STAFF", false))).toBe(false);
    expect(canCancelAppointment(undefined)).toBe(false);
  });

  it("keeps Staff management OWNER-only", () => {
    expect(canManageStaff("OWNER")).toBe(true);
    expect(getVisibleNavigationItems("OWNER").map((item) => item.id)).toContain("staff");
    for (const role of ["MANAGER", "STAFF", "RECEPTIONIST", "ACCOUNTANT"] as const) {
      expect(canManageStaff(role)).toBe(false);
      expect(getVisibleNavigationItems(role).map((item) => item.id)).not.toContain("staff");
      expect(
        resolveStaffManagementAccess({ authenticated: true, role, isActive: true }),
      ).toBe("forbidden");
    }
    expect(staffManagementForbiddenHref()).toBe("/staff/today");
  });
});

describe("Phase 1C-6D.2D checkout / 開單 attribution", () => {
  it("lets a remote STAFF actor open checkout and records their operational staff id", () => {
    hydrateRemoteMemberships([
      membership(),
      membership({
        id: "mem-staff-020",
        userId: "staff-020",
        role: "STAFF",
        displayName: "櫃台小瑜",
        authUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        email: "staff020@example.com",
      }),
    ]);
    const apt = eligibleAppointment("staff-001");
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-020",
    });
    expect(draft.createdByStaffId).toBe("staff-020");
    expect(draft.createdByStaffId).not.toBe(apt.staffId);
    expect(draft.appointmentId).toBe(apt.id);
  });

  it("denies ACCOUNTANT, inactive, unauthenticated, cross-org, and Auth UUID actors", () => {
    hydrateRemoteMemberships([
      membership(),
      membership({
        id: "mem-acc",
        userId: "staff-030",
        role: "ACCOUNTANT",
        displayName: "會計",
        authUserId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      }),
      membership({
        id: "mem-off",
        userId: "staff-031",
        role: "STAFF",
        displayName: "停用",
        isActive: false,
        authUserId: "cccccccc-dddd-4eee-8fff-000000000000",
      }),
    ]);
    const apt = eligibleAppointment();
    expect(() =>
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-030",
      }),
    ).toThrow(/沒有權限結帳/);
    expect(() =>
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "staff-031",
      }),
    ).toThrow(/does not belong/);
    expect(() =>
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "",
      }),
    ).toThrow(/請先登入/);
    expect(() =>
      createEmptyCheckoutDraft(ORG_LUMIERE_ID, {
        locationId: LOC_ENJOYE_PRIMARY_ID,
        customerId: "demo-001",
        createdByStaffId: "staff-001",
      }),
    ).toThrow();
    expect(() =>
      createCheckoutFromAppointment(ORG_ENJOYE_ID, {
        appointmentId: apt.id,
        createdByStaffId: "cd037b07-d6fe-49a3-91eb-9735ec65665c",
      }),
    ).toThrow(/auth UUID/);
    expect(
      resolveCheckoutAccess({ authenticated: false }),
    ).toBe("login");
    expect(
      resolveCheckoutAccess({ authenticated: true, role: "ACCOUNTANT", isActive: true }),
    ).toBe("forbidden");
    expect(
      resolveCheckoutAccess({ authenticated: true, role: "RECEPTIONIST", isActive: true }),
    ).toBe("ok");
  });
});
