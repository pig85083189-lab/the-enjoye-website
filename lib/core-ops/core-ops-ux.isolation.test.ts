/**
 * Phase 4.11B — Core Ops UX: treatments list, customer edit, Today checkout CTA, nav.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import {
  createAppointment,
  transitionAppointmentStatus,
} from "@/lib/appointments/store";
import { resolveAppointmentCheckoutNav } from "@/lib/commerce/appointment-checkout-nav";
import {
  completeCheckout,
  createCheckoutFromAppointment,
  setCheckoutPayments,
} from "@/lib/commerce/checkout-store";
import { voidTransaction } from "@/lib/commerce/void-transaction";
import { NAVIGATION_ITEMS } from "@/lib/navigation/config";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { listCompletedTreatmentsForOrganization } from "@/lib/repositories/local-treatment-repository";
import {
  createEmptyDraft,
  listOpenTreatmentDrafts,
  listStoredCompletedTreatments,
  saveCompletedTreatment,
  saveDraft,
} from "@/lib/treatment-draft";

function wipe() {
  localStorage.clear();
}

beforeEach(() => wipe());

function makeInServiceAppointment(orgId = ORG_ENJOYE_ID) {
  const start = new Date(2026, 8, 25, 14, 0).toISOString();
  const end = new Date(2026, 8, 25, 15, 30).toISOString();
  const apt = createAppointment(orgId, {
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "demo-001",
    serviceId: "svc-breast",
    staffId: "staff-001",
    startAt: start,
    endAt: end,
    allowConflict: true,
  });
  transitionAppointmentStatus(orgId, apt.id, "CONFIRMED");
  transitionAppointmentStatus(orgId, apt.id, "ARRIVED");
  transitionAppointmentStatus(orgId, apt.id, "IN_SERVICE");
  return apt;
}

describe("treatment draft inbox / list", () => {
  it("draft appears in open list and resume route uses appointment", () => {
    const apt = makeInServiceAppointment();
    const draft = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      appointmentId: apt.id,
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: "svc-breast",
    });
    draft.assessment.clientFocus = "繼續療程測試";
    draft.currentStep = "assessment";
    saveDraft(draft);

    const open = listOpenTreatmentDrafts(ORG_ENJOYE_ID);
    expect(open.some((d) => d.appointmentId === apt.id)).toBe(true);
    const found = open.find((d) => d.appointmentId === apt.id)!;
    expect(found.status).toBe("draft");
    const resume = `/staff/treatments/new?customer=${found.customerId}&appointment=${found.appointmentId}`;
    expect(resume).toContain(`appointment=${apt.id}`);
  });

  it("completed treatment appears in completed list", () => {
    const apt = makeInServiceAppointment();
    const draft = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      appointmentId: apt.id,
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: "svc-breast",
    });
    draft.assessment.concerns = ["外擴"];
    saveCompletedTreatment(draft);

    const completed = listStoredCompletedTreatments(ORG_ENJOYE_ID);
    expect(completed.some((t) => t.appointmentId === apt.id)).toBe(true);
    expect(listOpenTreatmentDrafts(ORG_ENJOYE_ID).some((d) => d.appointmentId === apt.id)).toBe(
      false,
    );
    const merged = listCompletedTreatmentsForOrganization(ORG_ENJOYE_ID);
    expect(merged.some((t) => t.appointmentId === apt.id)).toBe(true);
  });

  it("cross-org treatment drafts are hidden", () => {
    const apt = makeInServiceAppointment(ORG_ENJOYE_ID);
    const draft = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      appointmentId: apt.id,
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: "svc-breast",
    });
    saveDraft(draft);

    expect(listOpenTreatmentDrafts(ORG_LUMIERE_ID)).toHaveLength(0);
    expect(
      listOpenTreatmentDrafts(ORG_ENJOYE_ID).some((d) => d.appointmentId === apt.id),
    ).toBe(true);
  });

  it("same-id cross-org isolation for completed treatments", () => {
    const sharedId = "treatment-shared-id-test";
    const enjoye = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      appointmentId: "apt-enjoye-shared",
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: "svc-breast",
    });
    enjoye.id = sharedId;
    saveCompletedTreatment(enjoye);

    const lumiere = createEmptyDraft({
      organizationId: ORG_LUMIERE_ID,
      appointmentId: "apt-lumiere-shared",
      customerId: "lumiere-001",
      staffId: "staff-lumiere",
      serviceId: "svc-facial",
    });
    lumiere.id = sharedId;
    saveCompletedTreatment(lumiere);

    const a = listStoredCompletedTreatments(ORG_ENJOYE_ID).filter((t) => t.id === sharedId);
    const b = listStoredCompletedTreatments(ORG_LUMIERE_ID).filter((t) => t.id === sharedId);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].organizationId).toBe(ORG_ENJOYE_ID);
    expect(b[0].organizationId).toBe(ORG_LUMIERE_ID);
    expect(a[0].appointmentId).not.toBe(b[0].appointmentId);
  });
});

describe("customer edit", () => {
  it("updates editable fields successfully", () => {
    const created = localCustomerRepository.upsert({
      id: "cust-edit-001",
      organizationId: ORG_ENJOYE_ID,
      name: "編輯前",
      phone: "0911111111",
      birthday: "1990/01/01",
      age: 36,
      membership: "new",
      lastVisit: "",
      totalVisits: 0,
      packages: [],
      lastServiceNotes: [],
      trackingFocus: [],
      alerts: [],
      tags: [],
      joinedAt: "2026/01/01",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const updated = localCustomerRepository.updateProfile(
      ORG_ENJOYE_ID,
      created.id,
      {
        name: "編輯後",
        phone: "0922222222",
        email: "after@example.com",
      },
    );
    expect(updated.name).toBe("編輯後");
    expect(updated.phone).toContain("922");
    expect(updated.email).toBe("after@example.com");
    expect(updated.id).toBe(created.id);
    expect(updated.organizationId).toBe(ORG_ENJOYE_ID);

    const again = localCustomerRepository.getById({
      organizationId: ORG_ENJOYE_ID,
      id: created.id,
    });
    expect(again?.name).toBe("編輯後");
  });

  it("rejects cross-org edit", () => {
    localCustomerRepository.upsert({
      id: "cust-edit-002",
      organizationId: ORG_ENJOYE_ID,
      name: "僅 Enjoye",
      phone: "0933333333",
      birthday: "",
      age: 0,
      membership: "regular",
      lastVisit: "",
      totalVisits: 0,
      packages: [],
      lastServiceNotes: [],
      trackingFocus: [],
      alerts: [],
      tags: [],
      joinedAt: "2026/01/01",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(() =>
      localCustomerRepository.updateProfile(ORG_LUMIERE_ID, "cust-edit-002", {
        name: "hack",
      }),
    ).toThrow(/not found/i);
  });

  it("rejects id / organizationId mutation", () => {
    localCustomerRepository.upsert({
      id: "cust-edit-003",
      organizationId: ORG_ENJOYE_ID,
      name: "不可變",
      phone: "0944444444",
      birthday: "",
      age: 0,
      membership: "regular",
      lastVisit: "",
      totalVisits: 0,
      packages: [],
      lastServiceNotes: [],
      trackingFocus: [],
      alerts: [],
      tags: [],
      joinedAt: "2026/01/01",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(() =>
      localCustomerRepository.updateProfile(ORG_ENJOYE_ID, "cust-edit-003", {
        id: "other-id",
        name: "x",
      }),
    ).toThrow(/immutable/i);

    expect(() =>
      localCustomerRepository.updateProfile(ORG_ENJOYE_ID, "cust-edit-003", {
        organizationId: ORG_LUMIERE_ID,
        name: "x",
      }),
    ).toThrow(/immutable/i);
  });
});

describe("Today checkout CTA semantics", () => {
  it("shows checkout for IN_SERVICE / COMPLETED without COMPLETED TX", () => {
    const apt = makeInServiceAppointment();
    expect(resolveAppointmentCheckoutNav(ORG_ENJOYE_ID, apt.id, "IN_SERVICE").kind).toBe(
      "checkout",
    );
    transitionAppointmentStatus(ORG_ENJOYE_ID, apt.id, "COMPLETED");
    expect(resolveAppointmentCheckoutNav(ORG_ENJOYE_ID, apt.id, "COMPLETED").kind).toBe(
      "checkout",
    );
    expect(resolveAppointmentCheckoutNav(ORG_ENJOYE_ID, apt.id, "BOOKED").kind).toBe(
      "none",
    );
  });

  it("COMPLETED transaction shows view_transaction instead of checkout", () => {
    const apt = makeInServiceAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "CASH", amount: draft.total },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    const nav = resolveAppointmentCheckoutNav(ORG_ENJOYE_ID, apt.id, "COMPLETED");
    expect(nav.kind).toBe("view_transaction");
    if (nav.kind === "view_transaction") {
      expect(nav.href).toContain(tx.id);
      expect(nav.label).toBe("查看交易");
    }
  });

  it("VOIDED transaction restores checkout CTA via hasCompletedTransaction semantics", () => {
    const apt = makeInServiceAppointment();
    const draft = createCheckoutFromAppointment(ORG_ENJOYE_ID, {
      appointmentId: apt.id,
      createdByStaffId: "staff-001",
    });
    setCheckoutPayments(ORG_ENJOYE_ID, draft.id, [
      { method: "CASH", amount: draft.total },
    ]);
    const tx = completeCheckout(ORG_ENJOYE_ID, draft.id);
    expect(resolveAppointmentCheckoutNav(ORG_ENJOYE_ID, apt.id, "IN_SERVICE").kind).toBe(
      "view_transaction",
    );

    voidTransaction(ORG_ENJOYE_ID, tx.id, {
      actorStaffId: "staff-001",
      reason: "重結測試",
    });
    expect(resolveAppointmentCheckoutNav(ORG_ENJOYE_ID, apt.id, "IN_SERVICE").kind).toBe(
      "checkout",
    );
  });
});

describe("navigation Staff / Treatments ready", () => {
  it("Staff is ready (not placeholder) with schedule description", () => {
    const staff = NAVIGATION_ITEMS.find((i) => i.id === "staff")!;
    expect(staff.status).toBe("ready");
    expect(staff.description).toMatch(/排班/);
    expect(staff.label).toBe("員工");
  });

  it("Treatments list is ready (not placeholder)", () => {
    const treatments = NAVIGATION_ITEMS.find((i) => i.id === "treatments")!;
    expect(treatments.status).toBe("ready");
    expect(treatments.description).toMatch(/草稿/);
  });
});
